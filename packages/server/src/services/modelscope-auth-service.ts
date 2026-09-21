/**
 * Project-scoped ModelScope key authorization, through the harness's own bridge.
 *
 * ModelScope's OAuth cannot run inside the App: the code exchange needs a client secret the
 * desktop App must not hold, and ModelScope returns that code to a redirect URI the App does
 * not own. The bridge at `config.modelscopeBridgeUrl` keeps the secret and runs the exchange.
 * The App speaks only the device-style start/poll pair below to the bridge, and receives
 * exactly once an api-inference token delivery, which it then writes across the ModelScope
 * group the same way any other group key is written.
 *
 * Two consequences of that single delivery shape most of this file. A poll that has already
 * succeeded can never be re-polled — the bridge clears its server-side copy on delivery — so a
 * write that fails afterwards keeps the token on the flow for `retryApply` instead of asking
 * the user to authorize again. The refresh token is stored in web.db, never in
 * .project_config.toml; model requests call `ensureFresh` before loading a runtime and again
 * immediately before each upstream request, silently rotating the access token near expiry.
 */
import { randomBytes } from "node:crypto";
import { Interface, Module, Provide, Use } from "@prismshadow/penguin-core/kernel";
import { MODELSCOPE_PROVIDER_ID } from "@prismshadow/penguin-core/model-catalog";
import { HttpError } from "../http/errors.js";
import { Config } from "../hmr/capabilities.js";
import type {
  ModelProviderAuthToken,
  ModelProviderAuthTokens,
  ProjectConfigStore,
} from "../mechanisms/projects.js";
import type { ModelScopeAuthFlowStatusResponse } from "../api/types.js";

/** Recorded by the bridge alongside the flow; it identifies the App but does not gate it. */
export const MODELSCOPE_BRIDGE_CLIENT_ID = "penguin-harness";

const FLOW_TTL_MS = 10 * 60 * 1000;
const MAX_FLOWS_PER_OWNER = 8;
const MAX_RESPONSE_BYTES = 512 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_ACCESS_TOKEN_LENGTH = 4096;
const MAX_REFRESH_TOKEN_LENGTH = 4096;
const MAX_AUTHORIZE_URL_LENGTH = 2048;
const DEFAULT_RETRY_AFTER_MS = 1_000;
const MAX_RETRY_AFTER_MS = 60_000;
const REFRESH_SKEW_MS = 5 * 60 * 1000;
const MAX_CONSECUTIVE_REFRESH_FAILURES = 3;
const REFRESH_FAILURE_BACKOFF_MS = 30_000;

type FlowStatus = "pending" | "applying" | "completed" | "cancelled" | "apply_failed" | "error";

interface Flow {
  flowId: string;
  projectId: string;
  userId: string;
  code: string | null;
  deviceSecret: string | null;
  authorizeUrl: string;
  expiresAt: number;
  status: FlowStatus;
  error?: ModelScopeAuthFlowStatusResponse["error"];
  applied?: number;
  credential?: ModelScopeCredential;
  polling?: Promise<void>;
  retryPollAt?: number;
  changed?: boolean;
}

export type ModelScopeAuthStatusResult = ModelScopeAuthFlowStatusResponse & { changed?: true };

export interface ModelScopeCredential {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
}

export interface ModelScopeRefreshResult {
  changed: boolean;
}

interface ModelScopeAuthDeps {
  /** Base URL of the bridge, without a trailing slash (config.modelscopeBridgeUrl). */
  bridgeUrl: string;
  /** Writes the delivered credential; resolves to how many rows took the access token. */
  applyCredential: (
    projectId: string,
    credential: ModelScopeCredential,
    options?: { expectedRefreshToken?: string },
  ) => Promise<number>;
  /** Reads the server-side refresh metadata for the group. */
  readStoredCredential?: (projectId: string) => ModelProviderAuthToken | undefined;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function readJsonBounded(response: Response): Promise<unknown> {
  if (response.body === null) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel("Bridge response is too large.");
        throw new Error("Bridge response is too large.");
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = Buffer.concat(chunks).toString("utf8");
  return body === "" ? null : JSON.parse(body);
}

function requiredString(value: unknown, maxLength: number, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    throw new Error(`The bridge returned an invalid ${label}.`);
  }
  return value;
}

/**
 * The authorize URL is opened in a browser tab, so it is validated as an address rather than
 * merely copied: the bridge generates it, and a value that is not an absolute http(s) URL with
 * no embedded credentials has no business reaching `window.open`.
 */
function authorizeEndpoint(value: unknown): string {
  const raw = requiredString(value, MAX_AUTHORIZE_URL_LENGTH, "authorize URL");
  const parsed = new URL(raw);
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    throw new Error("The bridge returned an invalid authorize URL.");
  }
  return raw;
}

function optionalTokenString(value: unknown, maxLength: number, label: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return requiredString(value, maxLength, label);
}

function optionalIsoDate(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const raw = requiredString(value, 128, label);
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) throw new Error(`The bridge returned an invalid ${label}.`);
  return new Date(ms).toISOString();
}

/** Validates the one-time delivery and extracts the api-inference credential. */
export function modelscopeCredential(
  value: unknown,
  fallbackRefreshToken?: string,
): ModelScopeCredential {
  const body = asRecord(value);
  if (body.status !== "completed") throw new Error("The bridge returned another status.");
  return modelscopeToken(body.token, fallbackRefreshToken);
}

/** Validates POST /oauth/refresh, whose successful envelope is `{ token }` without flow status. */
export function modelscopeRefreshCredential(
  value: unknown,
  fallbackRefreshToken?: string,
): ModelScopeCredential {
  return modelscopeToken(asRecord(value).token, fallbackRefreshToken);
}

function modelscopeToken(value: unknown, fallbackRefreshToken?: string): ModelScopeCredential {
  const token = asRecord(value);
  const refreshToken =
    optionalTokenString(token.refreshToken, MAX_REFRESH_TOKEN_LENGTH, "refresh token") ??
    fallbackRefreshToken;
  const expiresAt = optionalIsoDate(token.expiresAt, "access token expiry");
  return {
    accessToken: requiredString(token.accessToken, MAX_ACCESS_TOKEN_LENGTH, "access token"),
    ...(refreshToken !== undefined ? { refreshToken } : {}),
    ...(expiresAt !== undefined ? { expiresAt } : {}),
  };
}

/** Backward-compatible helper used by older tests and small validators. */
export function modelscopeAccessToken(value: unknown): string {
  return modelscopeCredential(value).accessToken;
}

function retryAfterMs(value: unknown): number {
  const seconds = asRecord(value).retryAfterSeconds;
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) {
    return DEFAULT_RETRY_AFTER_MS;
  }
  return Math.min(MAX_RETRY_AFTER_MS, Math.ceil(seconds * 1000));
}

function retryAfterSeconds(value: unknown): number {
  return Math.ceil(retryAfterMs(value) / 1000);
}

export class ModelScopeAuthService {
  private readonly flows = new Map<string, Flow>();
  private readonly refreshes = new Map<string, Promise<ModelScopeRefreshResult>>();
  private readonly refreshFailures = new Map<
    string,
    { refreshToken: string; count: number; retryAt: number }
  >();
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly deps: ModelScopeAuthDeps) {
    this.fetchImpl = deps.fetchImpl ?? ((...args) => fetch(...args));
    this.now = deps.now ?? (() => Date.now());
  }

  private url(path: string): string {
    return `${this.deps.bridgeUrl}${path}`;
  }

  private isPending(flow: Flow): boolean {
    return (
      this.flows.get(flow.flowId) === flow &&
      flow.status === "pending" &&
      flow.expiresAt > this.now()
    );
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    return this.fetchImpl(this.url(path), {
      ...init,
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  }

  async ensureFresh(input: {
    projectId: string;
    provider: string;
  }): Promise<ModelScopeRefreshResult> {
    if (input.provider !== MODELSCOPE_PROVIDER_ID) return { changed: false };
    const stored = this.deps.readStoredCredential?.(input.projectId);
    const state = this.refreshState(stored);
    if (stored === undefined || state === "fresh") return { changed: false };
    const key = `${input.projectId}:${input.provider}`;
    const recordedFailures = this.refreshFailures.get(key);
    const failures =
      recordedFailures?.refreshToken === stored.refreshToken ? recordedFailures : undefined;
    if (recordedFailures !== undefined && failures === undefined) {
      this.refreshFailures.delete(key);
    }
    if (failures !== undefined) {
      if (failures.count >= MAX_CONSECUTIVE_REFRESH_FAILURES) {
        throw this.reauthorizationRequired();
      }
      if (state === "refresh" && failures.retryAt > this.now()) return { changed: false };
    }
    const existing = this.refreshes.get(key);
    if (existing) return existing;
    const refresh = this.refreshNow(input.projectId, input.provider, stored, state).finally(() => {
      this.refreshes.delete(key);
    });
    this.refreshes.set(key, refresh);
    return refresh;
  }

  async start(input: { projectId: string; userId: string }): Promise<{
    flowId: string;
    authorizeUrl: string;
    expiresAt: string;
  }> {
    this.sweep();
    const flowId = randomBytes(32).toString("base64url");
    const code = randomBytes(32).toString("base64url");
    const deviceSecret = randomBytes(32).toString("base64url");
    let response: Response;
    try {
      response = await this.request("/oauth/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code,
          deviceSecret,
          client: { id: MODELSCOPE_BRIDGE_CLIENT_ID },
        }),
      });
    } catch {
      throw new HttpError(
        502,
        "modelscope_unreachable",
        "The ModelScope bridge could not be reached.",
      );
    }
    if (response.status === 429) {
      let body: unknown = null;
      try {
        body = await readJsonBounded(response);
      } catch {
        // A malformed rate-limit response still gets the bounded default delay.
      }
      const retryAfter = retryAfterSeconds(body);
      throw new HttpError(
        429,
        "modelscope_rate_limited",
        "The ModelScope bridge is receiving too many authorization requests. Try again shortly.",
        retryAfter,
      );
    }
    if (response.status !== 201) {
      throw new HttpError(
        502,
        "modelscope_start_failed",
        "The ModelScope bridge refused the key flow.",
      );
    }
    let body: Record<string, unknown>;
    let authorizeUrl: string;
    try {
      body = asRecord(await readJsonBounded(response));
      authorizeUrl = authorizeEndpoint(body.authorizeUrl);
    } catch {
      throw new HttpError(
        502,
        "modelscope_start_failed",
        "The ModelScope bridge returned an invalid response.",
      );
    }
    const expiresAt = typeof body.expiresAt === "string" ? Date.parse(body.expiresAt) : NaN;
    if (!Number.isFinite(expiresAt) || expiresAt <= this.now()) {
      throw new HttpError(
        502,
        "modelscope_start_failed",
        "The ModelScope bridge returned an invalid expiry.",
      );
    }
    this.evictOldest(input.userId, input.projectId);
    // The bridge builds this URL itself (it is the one that knows the redirect URI and its own
    // public prefix), so it is passed through rather than assembled here.
    const localExpiresAt = Math.min(expiresAt, this.now() + FLOW_TTL_MS);
    this.flows.set(flowId, {
      flowId,
      projectId: input.projectId,
      userId: input.userId,
      code,
      deviceSecret,
      authorizeUrl,
      expiresAt: localExpiresAt,
      status: "pending",
    });
    return { flowId, authorizeUrl, expiresAt: new Date(localExpiresAt).toISOString() };
  }

  async status(input: {
    flowId: string;
    projectId: string;
    userId: string;
  }): Promise<ModelScopeAuthStatusResult> {
    const flow = this.requireFlow(input);
    if (
      flow.status === "pending" &&
      (flow.retryPollAt === undefined || flow.retryPollAt <= this.now())
    ) {
      flow.polling ??= this.pollBridge(flow).finally(() => {
        flow.polling = undefined;
      });
      await flow.polling;
    }
    return this.publicFlow(flow);
  }

  async retryApply(input: {
    flowId: string;
    projectId: string;
    userId: string;
  }): Promise<ModelScopeAuthStatusResult> {
    const flow = this.requireFlow(input);
    if (flow.status !== "apply_failed" || flow.credential === undefined) {
      throw new HttpError(
        409,
        "modelscope_auth_not_retryable",
        "This key cannot be applied again.",
      );
    }
    await this.apply(flow);
    return this.publicFlow(flow);
  }

  cancel(input: { flowId: string; projectId: string; userId: string }): void {
    const flow = this.requireFlow(input);
    if (flow.status === "completed" || flow.status === "applying") {
      throw new HttpError(
        409,
        "modelscope_auth_flow_used",
        "This key flow can no longer be cancelled.",
      );
    }
    flow.status = "cancelled";
    // Best effort: the flow is cancelled locally whatever the bridge answers, and the code and
    // secret are dropped either way so a later poll cannot revive it. The bridge also expires
    // the flow on its own.
    if (flow.code !== null && flow.deviceSecret !== null) {
      const body = JSON.stringify({ code: flow.code, deviceSecret: flow.deviceSecret });
      void this.request("/oauth/cancel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      })
        .then((response) => response.body?.cancel())
        .catch(() => {});
    }
    flow.code = null;
    flow.deviceSecret = null;
    flow.credential = undefined;
  }

  private refreshState(
    stored: ModelProviderAuthToken | undefined,
  ): "fresh" | "refresh" | "expired" {
    if (stored === undefined || stored.accessTokenExpiresAt === undefined) return "fresh";
    const expiresAt = Date.parse(stored.accessTokenExpiresAt);
    if (!Number.isFinite(expiresAt)) return "fresh";
    const now = this.now();
    if (expiresAt <= now) return "expired";
    return expiresAt <= now + REFRESH_SKEW_MS ? "refresh" : "fresh";
  }

  private async refreshNow(
    projectId: string,
    provider: string,
    stored: ModelProviderAuthToken,
    state: "refresh" | "expired",
  ): Promise<ModelScopeRefreshResult> {
    const key = `${projectId}:${provider}`;
    try {
      const response = await this.request("/oauth/refresh", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: stored.refreshToken }),
      });
      if (!response.ok) throw new Error(`Bridge refresh failed: ${response.status}`);
      const credential = modelscopeRefreshCredential(
        await readJsonBounded(response),
        stored.refreshToken,
      );
      const applied = await this.deps.applyCredential(projectId, credential, {
        expectedRefreshToken: stored.refreshToken,
      });
      if (applied === 0) return { changed: false };
      this.refreshFailures.delete(key);
      return { changed: true };
    } catch (error) {
      const previous = this.refreshFailures.get(key);
      const count = (previous?.refreshToken === stored.refreshToken ? previous.count : 0) + 1;
      this.refreshFailures.set(key, {
        refreshToken: stored.refreshToken,
        count,
        retryAt: this.now() + REFRESH_FAILURE_BACKOFF_MS * 2 ** (count - 1),
      });
      if (state === "refresh" && count < MAX_CONSECUTIVE_REFRESH_FAILURES) {
        return { changed: false };
      }
      throw this.reauthorizationRequired();
    }
  }

  private reauthorizationRequired(): HttpError {
    return new HttpError(
      409,
      "modelscope_refresh_failed",
      "ModelScope authorization could not be refreshed after repeated attempts. Authorize ModelScope again on the Models page.",
    );
  }

  private async pollBridge(flow: Flow): Promise<void> {
    if (!this.isPending(flow) || flow.code === null || flow.deviceSecret === null) return;
    let response: Response;
    try {
      response = await this.request("/oauth/poll", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: flow.code, deviceSecret: flow.deviceSecret }),
      });
    } catch {
      if (!this.isPending(flow)) return;
      flow.status = "error";
      flow.error = "unreachable";
      return;
    }
    if (!this.isPending(flow)) return;
    if (response.status === 429) {
      let body: unknown = null;
      try {
        body = await readJsonBounded(response);
      } catch {
        // A malformed rate-limit response still gets a bounded default backoff.
      }
      if (!this.isPending(flow)) return;
      flow.retryPollAt = this.now() + retryAfterMs(body);
      return;
    }
    if (!response.ok) {
      flow.status = "error";
      flow.error = "upstream_failed";
      return;
    }
    flow.retryPollAt = undefined;
    let body: unknown;
    try {
      body = await readJsonBounded(response);
    } catch {
      if (!this.isPending(flow)) return;
      flow.status = "error";
      flow.error = "invalid_key";
      return;
    }
    if (!this.isPending(flow)) return;
    const status = asRecord(body).status;
    if (status === "pending") return;
    if (status === "completed") {
      try {
        flow.credential = modelscopeCredential(body);
      } catch {
        flow.status = "error";
        flow.error = "invalid_key";
        flow.code = null;
        flow.deviceSecret = null;
        return;
      }
      // The token is now in hand and the bridge's copy is gone: nothing may poll again.
      flow.code = null;
      flow.deviceSecret = null;
      await this.apply(flow);
      return;
    }
    flow.status = status === "cancelled" ? "cancelled" : "error";
    flow.error =
      status === "expired"
        ? "expired"
        : status === "locked"
          ? "locked"
          : status === "delivered"
            ? "already_delivered"
            : status === "cancelled"
              ? undefined
              : "upstream_failed";
    flow.code = null;
    flow.deviceSecret = null;
  }

  private async apply(flow: Flow): Promise<void> {
    if (flow.credential === undefined) return;
    flow.status = "applying";
    flow.error = undefined;
    try {
      const applied = await this.deps.applyCredential(flow.projectId, flow.credential);
      // A group with no rows would silently swallow the token, leaving the user authorized
      // with nothing to show for it.
      if (applied === 0) throw new Error("The ModelScope group is empty.");
      this.refreshFailures.delete(`${flow.projectId}:${MODELSCOPE_PROVIDER_ID}`);
      flow.applied = applied;
      flow.credential = undefined;
      flow.status = "completed";
      flow.changed = true;
    } catch {
      // The token stays on the flow: the bridge cannot deliver it a second time, so the only
      // way forward is retrying the write.
      flow.status = "apply_failed";
      flow.error = "apply_failed";
    }
  }

  private publicFlow(flow: Flow): ModelScopeAuthStatusResult {
    const changed = flow.changed === true;
    flow.changed = false;
    return {
      status: flow.status,
      ...(flow.error !== undefined ? { error: flow.error } : {}),
      ...(flow.applied !== undefined ? { applied: flow.applied } : {}),
      ...(changed ? { changed: true as const } : {}),
    };
  }

  private requireFlow(input: { flowId: string; projectId: string; userId: string }): Flow {
    this.sweep();
    const flow = this.flows.get(input.flowId);
    if (
      flow === undefined ||
      flow.projectId !== input.projectId ||
      flow.userId !== input.userId ||
      flow.expiresAt <= this.now()
    ) {
      throw new HttpError(
        404,
        "modelscope_auth_flow_not_found",
        "This key flow has expired or does not exist.",
      );
    }
    return flow;
  }

  private sweep(): void {
    const now = this.now();
    for (const [id, flow] of this.flows) if (flow.expiresAt <= now) this.flows.delete(id);
  }

  private evictOldest(userId: string, projectId: string): void {
    const mine = [...this.flows.values()].filter(
      (flow) => flow.userId === userId && flow.projectId === projectId,
    );
    for (const flow of mine.slice(0, Math.max(0, mine.length - (MAX_FLOWS_PER_OWNER - 1)))) {
      this.flows.delete(flow.flowId);
    }
  }
}

/** The per-App ModelScope key authorization capability consumed by Project model routes. */
export abstract class ModelScopeAuth extends Interface<
  Pick<ModelScopeAuthService, "start" | "status" | "retryApply" | "cancel" | "ensureFresh">
>() {}

/** Keep in-flight flows on the current bridge, like PlatformAuthProvider keeps them on Penguin Go. */
@Module()
export class ModelScopeAuthProvider {
  @Use() private readonly config!: Config;
  @Use() private readonly projectConfig!: ProjectConfigStore;
  @Use() private readonly providerAuthTokens!: ModelProviderAuthTokens;
  @Provide() auth!: ModelScopeAuth;

  setup() {
    this.auth = new ModelScopeAuthService({
      bridgeUrl: this.config.modelscopeBridgeUrl,
      applyCredential: async (projectId, credential, options) => {
        if (credential.refreshToken !== undefined) {
          return this.projectConfig.setGroupApiKeyWithProviderAuthToken(
            projectId,
            MODELSCOPE_PROVIDER_ID,
            credential.accessToken,
            {
              refreshToken: credential.refreshToken,
              accessTokenExpiresAt: credential.expiresAt,
            },
            options,
          );
        }
        return this.projectConfig.setGroupApiKey(
          projectId,
          MODELSCOPE_PROVIDER_ID,
          credential.accessToken,
        );
      },
      readStoredCredential: (projectId) =>
        this.providerAuthTokens.get(projectId, MODELSCOPE_PROVIDER_ID),
    });
  }
}
