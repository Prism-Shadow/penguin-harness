/**
 * Project-scoped Penguin Go key authorization.
 *
 * The Web App presents this like any other provider's "authorize a key" action. Penguin Go's
 * wire protocol is different from OAuth/PKCE, though: the server registers a device secret,
 * polls the one-time delivery, validates its API key and model catalog, then adds newly
 * advertised models while writing the key across the provider group. Account and balance
 * metadata remain outside PenguinHarness.
 */
import { randomBytes } from "node:crypto";
import { Interface, Module, Provide, Use } from "@prismshadow/penguin-core/kernel";
import { PENGUIN_GO_PROVIDER_ID } from "@prismshadow/penguin-core/model-catalog";
import { HttpError } from "../http/errors.js";
import { Config } from "../hmr/capabilities.js";
import type { ProjectConfigStore } from "../mechanisms/projects.js";
import type { PlatformAuthFlowStatusResponse } from "../api/types.js";
import {
  PLATFORM_CLIENT_ID,
  type PlatformCatalogPricing,
  type PlatformModelApplyResult,
  type PlatformModelCatalog,
} from "./platform-auth-types.js";

const FLOW_TTL_MS = 10 * 60 * 1000;
const MAX_FLOWS_PER_OWNER = 8;
const MAX_RESPONSE_BYTES = 512 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_API_KEY_LENGTH = 1024;
const MAX_CATALOG_MODELS = 512;
const MAX_MODEL_ID_LENGTH = 256;
const MAX_DISPLAY_NAME_LENGTH = 256;
const MAX_ENDPOINT_LENGTH = 2048;
const DEFAULT_RETRY_AFTER_MS = 1_000;
const MAX_RETRY_AFTER_MS = 60_000;

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
  error?: PlatformAuthFlowStatusResponse["error"];
  applied?: number;
  apiKey?: string;
  catalog?: PlatformModelCatalog;
  polling?: Promise<void>;
  retryPollAt?: number;
  changed?: boolean;
}

export type PlatformAuthStatusResult = PlatformAuthFlowStatusResponse & { changed?: true };

interface PlatformAuthDeps {
  origin: string;
  getKey: (projectId: string) => Promise<string | undefined>;
  applyCatalog: (
    projectId: string,
    catalog: PlatformModelCatalog,
    apiKey: string,
    applyKeyToExisting: boolean,
  ) => Promise<PlatformModelApplyResult>;
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
        await reader.cancel("Platform response is too large.");
        throw new Error("Platform response is too large.");
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
    throw new Error(`The platform returned an invalid ${label}.`);
  }
  return value;
}

function platformEndpoint(value: unknown): string {
  const raw = requiredString(value, MAX_ENDPOINT_LENGTH, "endpoint");
  const parsed = new URL(raw);
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error("The platform returned an invalid endpoint.");
  }
  return raw.replace(/\/+$/, "");
}

function platformPrice(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`The platform returned an invalid ${label} price.`);
  }
  return value;
}

function platformPricing(value: unknown, label: string): PlatformCatalogPricing {
  const pricing = asRecord(value);
  if (pricing.unit !== "usd_per_mtok") {
    throw new Error(`The platform returned an unsupported ${label} pricing unit.`);
  }
  return {
    unit: "usd_per_mtok",
    cacheRead: platformPrice(pricing.cacheRead, `${label} cache read`),
    cacheWrite: platformPrice(pricing.cacheWrite, `${label} cache write`),
    output: platformPrice(pricing.output, `${label} output`),
  };
}

/**
 * The promotion a platform model carries, if any: its list price and the fraction off it. The
 * wire sends both or neither, and the billed `pricing` must be that list price less the fraction.
 */
function platformPromotion(
  model: Record<string, unknown>,
  billed: PlatformCatalogPricing,
): { listPricing: PlatformCatalogPricing; discount: number } | undefined {
  const hasListPricing = model.listPricing !== undefined;
  const hasDiscount = model.discount !== undefined;
  if (hasListPricing !== hasDiscount) {
    throw new Error("The platform returned incomplete discount metadata.");
  }
  if (!hasListPricing) return undefined;
  if (
    typeof model.discount !== "number" ||
    !Number.isFinite(model.discount) ||
    model.discount <= 0 ||
    model.discount >= 1
  ) {
    throw new Error("The platform returned an invalid discount.");
  }
  const discount = model.discount;
  const listPricing = platformPricing(model.listPricing, "list");
  const close = (actual: number, list: number): boolean =>
    Math.abs(actual - list * (1 - discount)) <= 1e-9 * Math.max(1, Math.abs(actual));
  if (
    !close(billed.cacheRead, listPricing.cacheRead) ||
    !close(billed.cacheWrite, listPricing.cacheWrite) ||
    !close(billed.output, listPricing.output)
  ) {
    throw new Error("The platform returned inconsistent discount metadata.");
  }
  return { listPricing, discount };
}

function platformCatalog(value: unknown, requireEnvelope: boolean): PlatformModelCatalog {
  const body = asRecord(value);
  if (requireEnvelope && body.schemaVersion !== 1) {
    throw new Error("The platform returned an unsupported model catalog.");
  }
  if (requireEnvelope) requiredString(body.catalogVersion, 128, "catalog version");
  const endpoints = asRecord(body.endpoints);
  const endpointByName = {
    openai: platformEndpoint(endpoints.openai),
    google: platformEndpoint(endpoints.google),
  } as const;
  if (!Array.isArray(body.models) || body.models.length > MAX_CATALOG_MODELS) {
    throw new Error("The platform returned an invalid model catalog.");
  }
  const seen = new Set<string>();
  const models = body.models.map((value) => {
    const model = asRecord(value);
    const modelId = requiredString(model.modelId, MAX_MODEL_ID_LENGTH, "model id");
    if (seen.has(modelId)) throw new Error("The platform returned duplicate model ids.");
    seen.add(modelId);
    const displayName = requiredString(
      model.displayName,
      MAX_DISPLAY_NAME_LENGTH,
      "model display name",
    );
    const contextWindow = model.contextWindow;
    if (!Number.isSafeInteger(contextWindow) || Number(contextWindow) <= 0) {
      throw new Error("The platform returned an invalid context window.");
    }
    const maxOutputTokens = model.maxOutputTokens;
    if (
      maxOutputTokens !== undefined &&
      (!Number.isSafeInteger(maxOutputTokens) || Number(maxOutputTokens) <= 0)
    ) {
      throw new Error("The platform returned an invalid maximum output length.");
    }
    if (typeof model.supportsVision !== "boolean") {
      throw new Error("The platform returned an invalid vision capability.");
    }
    const billed = platformPricing(model.pricing, "effective");
    const promotion = platformPromotion(model, billed);
    const route = asRecord(model.recommendedRoute);
    const provider = model.provider;
    const googleRoute =
      provider === "google" &&
      route.protocol === "google-generative-language" &&
      route.endpoint === "google";
    const deepSeekRoute =
      provider === "deepseek" &&
      route.protocol === "deepseek-responses" &&
      route.endpoint === "openai";
    if (!googleRoute && !deepSeekRoute) {
      throw new Error("The platform returned an unsupported model route.");
    }
    return {
      modelId,
      displayName,
      contextWindow: Number(contextWindow),
      supportsVision: model.supportsVision,
      // A Project stores the list price; the promotion travels apart, as the fraction.
      pricing: promotion?.listPricing ?? billed,
      ...(promotion !== undefined ? { discount: promotion.discount } : {}),
      baseUrl: endpointByName[googleRoute ? "google" : "openai"],
      clientType: googleRoute ? ("gemini-3.8" as const) : ("deepseek-v4" as const),
    };
  });
  return { models };
}

/** Validates the one-time authorization payload and extracts only connection data. */
export function platformConnection(value: unknown): {
  apiKey: string;
  catalog: PlatformModelCatalog;
} {
  const body = asRecord(value);
  const client = asRecord(body.client);
  if (client.id !== PLATFORM_CLIENT_ID) throw new Error("The platform returned another client.");
  const connection = asRecord(body.connection);
  return {
    apiKey: requiredString(connection.apiKey, MAX_API_KEY_LENGTH, "API key"),
    catalog: platformCatalog(connection, false),
  };
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

export class PlatformAuthService {
  private readonly flows = new Map<string, Flow>();
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly deps: PlatformAuthDeps) {
    this.fetchImpl = deps.fetchImpl ?? ((...args) => fetch(...args));
    this.now = deps.now ?? (() => Date.now());
  }

  private url(path: string): string {
    return `${this.deps.origin}${path}`;
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
      response = await this.request("/api/auth/desktop/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, deviceSecret, client: { id: PLATFORM_CLIENT_ID } }),
      });
    } catch {
      throw new HttpError(502, "platform_unreachable", "Penguin Go could not be reached.");
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
        "platform_rate_limited",
        "Penguin Go is receiving too many authorization requests. Try again shortly.",
        retryAfter,
      );
    }
    if (response.status !== 201) {
      throw new HttpError(502, "platform_start_failed", "Penguin Go refused the key flow.");
    }
    let body: Record<string, unknown>;
    try {
      body = asRecord(await readJsonBounded(response));
    } catch {
      throw new HttpError(502, "platform_start_failed", "Penguin Go returned an invalid response.");
    }
    const expiresAt = typeof body.expiresAt === "string" ? Date.parse(body.expiresAt) : NaN;
    if (!Number.isFinite(expiresAt) || expiresAt <= this.now()) {
      throw new HttpError(502, "platform_start_failed", "Penguin Go returned an invalid expiry.");
    }
    this.evictOldest(input.userId, input.projectId);
    const authorizeUrl = `${this.deps.origin}/desktop/authorize?code=${encodeURIComponent(code)}`;
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
  }): Promise<PlatformAuthStatusResult> {
    const flow = this.requireFlow(input);
    if (
      flow.status === "pending" &&
      (flow.retryPollAt === undefined || flow.retryPollAt <= this.now())
    ) {
      flow.polling ??= this.pollPlatform(flow).finally(() => {
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
  }): Promise<PlatformAuthStatusResult> {
    const flow = this.requireFlow(input);
    if (flow.status !== "apply_failed" || flow.apiKey === undefined || flow.catalog === undefined) {
      throw new HttpError(409, "platform_auth_not_retryable", "This key cannot be applied again.");
    }
    await this.apply(flow);
    return this.publicFlow(flow);
  }

  /** Refreshes the platform catalog with the Project's existing key, without a browser login. */
  async sync(projectId: string): Promise<PlatformModelApplyResult> {
    const apiKey = await this.deps.getKey(projectId);
    if (apiKey === undefined) {
      throw new HttpError(
        409,
        "platform_reauthorization_required",
        "Penguin Go authorization is required.",
      );
    }
    let response: Response;
    try {
      response = await this.request("/api/client/models", {
        method: "GET",
        headers: { authorization: `Bearer ${apiKey}` },
      });
    } catch {
      throw new HttpError(502, "platform_unreachable", "Penguin Go could not be reached.");
    }
    if (response.status === 401 || response.status === 403) {
      throw new HttpError(
        409,
        "platform_reauthorization_required",
        "The Penguin Go key is no longer valid. Authorize it again.",
      );
    }
    if (!response.ok) {
      throw new HttpError(502, "platform_sync_failed", "Penguin Go refused model sync.");
    }
    let catalog: PlatformModelCatalog;
    try {
      catalog = platformCatalog(await readJsonBounded(response), true);
    } catch {
      throw new HttpError(
        502,
        "platform_sync_failed",
        "Penguin Go returned an invalid model catalog.",
      );
    }
    return this.deps.applyCatalog(projectId, catalog, apiKey, false);
  }

  cancel(input: { flowId: string; projectId: string; userId: string }): void {
    const flow = this.requireFlow(input);
    if (flow.status === "completed" || flow.status === "applying") {
      throw new HttpError(
        409,
        "platform_auth_flow_used",
        "This key flow can no longer be cancelled.",
      );
    }
    flow.status = "cancelled";
    flow.code = null;
    flow.deviceSecret = null;
    flow.apiKey = undefined;
    flow.catalog = undefined;
  }

  private async pollPlatform(flow: Flow): Promise<void> {
    if (!this.isPending(flow) || flow.code === null || flow.deviceSecret === null) return;
    let response: Response;
    try {
      response = await this.request("/api/auth/desktop/poll", {
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
    if (status === "claimed") {
      try {
        const connection = platformConnection(body);
        flow.apiKey = connection.apiKey;
        flow.catalog = connection.catalog;
      } catch {
        flow.status = "error";
        flow.error = "invalid_key";
        flow.code = null;
        flow.deviceSecret = null;
        return;
      }
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
    if (flow.apiKey === undefined || flow.catalog === undefined) return;
    flow.status = "applying";
    flow.error = undefined;
    try {
      const result = await this.deps.applyCatalog(flow.projectId, flow.catalog, flow.apiKey, true);
      if (result.applied === 0) throw new Error("The Penguin Go catalog is empty.");
      flow.applied = result.applied;
      flow.apiKey = undefined;
      flow.catalog = undefined;
      flow.status = "completed";
      flow.changed = true;
    } catch {
      flow.status = "apply_failed";
      flow.error = "apply_failed";
    }
  }

  private publicFlow(flow: Flow): PlatformAuthStatusResult {
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
        "platform_auth_flow_not_found",
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

/** The per-App key authorization capability consumed by Project model routes. */
export abstract class PlatformAuth extends Interface<
  Pick<PlatformAuthService, "start" | "status" | "retryApply" | "sync" | "cancel">
>() {}

/** Keep in-flight flows on the current platform App, like ModelOAuthService. */
@Module()
export class PlatformAuthProvider {
  @Use() private readonly config!: Config;
  @Use() private readonly projectConfig!: ProjectConfigStore;
  @Provide() auth!: PlatformAuth;

  setup() {
    this.auth = new PlatformAuthService({
      origin: this.config.penguinGoOrigin,
      getKey: (projectId) => this.projectConfig.getGroupApiKey(projectId, PENGUIN_GO_PROVIDER_ID),
      applyCatalog: (projectId, catalog, apiKey, applyKeyToExisting) =>
        this.projectConfig.mergePlatformModels(
          projectId,
          PENGUIN_GO_PROVIDER_ID,
          catalog,
          apiKey,
          applyKeyToExisting,
        ),
    });
  }
}
