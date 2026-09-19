import { randomBytes } from "node:crypto";
import {
  startChatGPTDeviceAuthorization,
  pollChatGPTDeviceAuthorization,
} from "@prismshadow/penguin-core";
import type { ChatGPTCredentials, ChatGPTDeviceAuthorization } from "@prismshadow/penguin-core";
import { HttpError } from "../http/errors.js";
import type { ModelOAuthStartResult, ModelOAuthErrorCode } from "./model-oauth-service.js";

type Owner = { projectId: string; userId: string };
type Handle = Owner & { flowId: string };
interface Flow extends Owner {
  controller: AbortController;
  authorization?: ChatGPTDeviceAuthorization;
  busy: boolean;
  nextPoll: number;
  status: "pending" | "done" | "error";
  error?: ModelOAuthErrorCode;
  timer: ReturnType<typeof setTimeout>;
}

/** Bounded, owner-bound connection lifecycle. All provider wire requests live in AgentHub. */
export class ChatGPTDeviceFlow {
  private readonly flows = new Map<string, Flow>();
  constructor(
    private readonly apply: (
      projectId: string,
      credentials: ChatGPTCredentials,
      signal: AbortSignal,
    ) => Promise<number>,
  ) {}

  private remove(id: string): void {
    const flow = this.flows.get(id);
    if (flow) {
      flow.controller.abort();
      clearTimeout(flow.timer);
      this.flows.delete(id);
    }
  }

  async start(owner: Owner): Promise<ModelOAuthStartResult> {
    for (const [id, flow] of this.flows)
      if (flow.projectId === owner.projectId && flow.userId === owner.userId) this.remove(id);
    if (this.flows.size >= 256)
      throw new HttpError(
        429,
        "chatgpt_oauth_busy",
        "Too many pending authorizations. Try again later.",
      );
    const flowId = randomBytes(32).toString("base64url");
    const timer = setTimeout(() => this.remove(flowId), 900_000);
    timer.unref();
    const flow: Flow = {
      ...owner,
      controller: new AbortController(),
      busy: true,
      nextPoll: Infinity,
      status: "pending",
      timer,
    };
    this.flows.set(flowId, flow);
    try {
      const auth = await startChatGPTDeviceAuthorization(flow.controller.signal);
      flow.controller.signal.throwIfAborted();
      flow.authorization = auth;
      flow.busy = false;
      flow.nextPoll = Date.now() + auth.intervalMs;
      return {
        flowId,
        authorizeUrl: auth.authorizeUrl,
        userCode: auth.userCode,
        expiresAt: auth.expiresAt,
      };
    } catch {
      this.remove(flowId);
      throw new HttpError(
        502,
        "chatgpt_oauth_failed",
        "ChatGPT authorization could not be started. Try again.",
      );
    }
  }

  has(id: string): boolean {
    return this.flows.has(id);
  }
  private require(input: Handle): Flow {
    const flow = this.flows.get(input.flowId);
    if (!flow || flow.projectId !== input.projectId || flow.userId !== input.userId)
      throw new HttpError(
        404,
        "model_oauth_flow_not_found",
        "This authorization has expired or does not exist. Start a new one.",
      );
    return flow;
  }
  cancel(input: Handle): void {
    this.require(input);
    this.remove(input.flowId);
  }

  async poll(input: Handle) {
    const flow = this.require(input);
    let applied: number | undefined;
    if (
      flow.status === "pending" &&
      !flow.busy &&
      flow.authorization &&
      Date.now() >= flow.nextPoll
    ) {
      flow.busy = true;
      const authorization = flow.authorization;
      try {
        const credentials = await pollChatGPTDeviceAuthorization(
          authorization,
          flow.controller.signal,
        );
        flow.nextPoll = Date.now() + authorization.intervalMs;
        if (credentials) {
          delete flow.authorization;
          flow.controller.signal.throwIfAborted();
          try {
            applied = await this.apply(flow.projectId, credentials, flow.controller.signal);
            flow.status = "done";
          } catch {
            flow.status = "error";
            flow.error = "apply_failed";
          }
        }
      } catch {
        flow.status = "error";
        flow.error = "upstream_failed";
        delete flow.authorization;
      } finally {
        flow.busy = false;
      }
    }
    return {
      status: flow.status,
      provider: "chatgpt-codex",
      ...(flow.error ? { error: flow.error } : {}),
      ...(applied !== undefined ? { applied } : {}),
    };
  }
}
