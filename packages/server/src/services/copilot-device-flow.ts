import { randomBytes } from "node:crypto";
import { HttpError } from "../http/errors.js";
import { badRequest } from "../http/validate.js";
import type { ModelOAuthStartResult, ModelOAuthErrorCode } from "./model-oauth-service.js";

type Owner = { projectId: string; userId: string };
type Handle = Owner & { flowId: string };
interface Flow extends Owner {
  controller: AbortController;
  clientId: string;
  deviceCode: string;
  expiresAt: number;
  interval: number;
  nextPoll: number;
  busy: boolean;
  status: "pending" | "done" | "error";
  error?: ModelOAuthErrorCode;
}

/** GitHub OAuth App device authorization. Tokens never pass through the browser.
 * OAuth Apps issue non-expiring tokens; revoked tokens require reconnecting. Expiring
 * GitHub App tokens are deliberately refused until refresh credentials can be stored.
 */
export class CopilotDeviceFlow {
  private readonly flows = new Map<string, Flow>();
  constructor(
    private readonly apply: (
      projectId: string,
      token: string,
      signal: AbortSignal,
    ) => Promise<number>,
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
    private readonly now: () => number = Date.now,
    private readonly clientId: () => string | undefined = () =>
      process.env.PENGUIN_COPILOT_CLIENT_ID,
  ) {}

  private sweep(): void {
    for (const [id, flow] of this.flows)
      if (flow.expiresAt <= this.now()) {
        flow.controller.abort();
        this.flows.delete(id);
      }
  }

  private async request(
    path: string,
    body: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    try {
      const response = await this.fetchImpl(`https://github.com/login/${path}`, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
        redirect: "error",
      });
      if (!response.ok) throw new Error();
      const value: unknown = await response.json();
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
      return value as Record<string, unknown>;
    } catch {
      throw new HttpError(502, "copilot_oauth_failed", "GitHub authorization failed. Try again.");
    }
  }

  async start(owner: Owner): Promise<ModelOAuthStartResult> {
    const clientId = this.clientId()?.trim();
    if (!clientId)
      throw badRequest(
        "Set PENGUIN_COPILOT_CLIENT_ID to your GitHub OAuth App client ID and enable device flow for that app.",
      );
    this.sweep();
    // Reserve before awaiting GitHub: concurrent starts cannot exceed the in-memory bound.
    if (this.flows.size >= 256)
      throw new HttpError(
        429,
        "copilot_oauth_busy",
        "Too many pending authorizations. Try again later.",
      );
    for (const [id, flow] of this.flows) {
      if (flow.projectId === owner.projectId && flow.userId === owner.userId) {
        flow.controller.abort();
        this.flows.delete(id);
      }
    }
    const flowId = randomBytes(32).toString("base64url");
    const flow: Flow = {
      controller: new AbortController(),
      ...owner,
      clientId,
      deviceCode: "",
      expiresAt: this.now() + 15_000,
      interval: 5000,
      nextPoll: Infinity,
      busy: true,
      status: "pending",
    };
    this.flows.set(flowId, flow);
    try {
      const body = await this.request("device/code", { client_id: clientId, scope: "read:user" });
      if (
        typeof body.device_code !== "string" ||
        !body.device_code ||
        typeof body.user_code !== "string" ||
        !/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(body.user_code) ||
        body.verification_uri !== "https://github.com/login/device" ||
        typeof body.expires_in !== "number" ||
        !Number.isFinite(body.expires_in) ||
        body.expires_in <= 0 ||
        (body.interval !== undefined &&
          (typeof body.interval !== "number" ||
            !Number.isFinite(body.interval) ||
            body.interval <= 0))
      ) {
        throw new HttpError(
          502,
          "copilot_oauth_failed",
          "GitHub returned an invalid device authorization.",
        );
      }
      flow.deviceCode = body.device_code;
      flow.expiresAt = this.now() + Math.min(body.expires_in, 900) * 1000;
      flow.interval = Math.max(5, Number(body.interval ?? 5)) * 1000;
      flow.nextPoll = this.now() + flow.interval;
      flow.busy = false;
      return {
        flowId,
        authorizeUrl: body.verification_uri,
        userCode: body.user_code,
        expiresAt: flow.expiresAt,
      };
    } catch (error) {
      this.flows.delete(flowId);
      throw error;
    }
  }

  has(flowId: string): boolean {
    return this.flows.has(flowId);
  }

  private require(input: Handle): Flow {
    this.sweep();
    const flow = this.flows.get(input.flowId);
    if (!flow || flow.projectId !== input.projectId || flow.userId !== input.userId) {
      throw new HttpError(
        404,
        "model_oauth_flow_not_found",
        "This authorization has expired or does not exist. Start a new one.",
      );
    }
    return flow;
  }

  cancel(input: Handle): void {
    this.require(input).controller.abort();
    this.flows.delete(input.flowId);
  }

  async poll(input: Handle) {
    const flow = this.require(input);
    let applied: number | undefined;
    if (flow.status === "pending" && !flow.busy && this.now() >= flow.nextPoll) {
      flow.busy = true;
      try {
        const body = await this.request("oauth/access_token", {
          client_id: flow.clientId,
          device_code: flow.deviceCode,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        });
        if (this.flows.get(input.flowId) !== flow || this.now() >= flow.expiresAt)
          return {
            status: "error" as const,
            provider: "github-copilot",
            error: "code_rejected" as const,
          };
        if (body.error === "slow_down") flow.interval += 5000;
        else if (body.error === "authorization_pending") {
          /* Wait for the user. */
        } else if (
          typeof body.access_token === "string" &&
          body.access_token.startsWith("gho_") &&
          body.token_type === "bearer" &&
          body.expires_in === undefined &&
          body.refresh_token === undefined
        ) {
          flow.deviceCode = "";
          try {
            applied = await this.apply(
              flow.projectId,
              body.access_token,
              AbortSignal.any([
                flow.controller.signal,
                AbortSignal.timeout(Math.max(0, Math.floor(flow.expiresAt - this.now()))),
              ]),
            );
            flow.status = "done";
          } catch {
            flow.status = "error";
            flow.error = "apply_failed";
          }
        } else {
          flow.status = "error";
          flow.error = "code_rejected";
        }
      } catch {
        flow.status = "error";
        flow.error = "unreachable";
      } finally {
        flow.busy = false;
        flow.nextPoll = this.now() + flow.interval;
        if (flow.status !== "pending") flow.deviceCode = "";
      }
    }
    return {
      status: flow.status,
      provider: "github-copilot",
      ...(flow.error ? { error: flow.error } : {}),
      ...(applied !== undefined ? { applied } : {}),
    };
  }
}
