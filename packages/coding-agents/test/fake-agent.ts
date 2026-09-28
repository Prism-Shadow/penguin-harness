/**
 * A scripted in-process ACP agent for tests: pairs directly with the kernel's client
 * (no subprocess), exposes hooks the tests set per case, and helper methods for the
 * agent->client direction (updates, permission asks, elicitation).
 */
import {
  agent,
  methods,
  PROTOCOL_VERSION,
  RequestError,
  type AgentApp,
  type AgentConnection,
  type AgentRequestContext,
  type CreateElicitationResponse,
  type PromptRequest,
  type PromptResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionConfigOption,
  type SessionModeState,
  type StopReason,
} from "@agentclientprotocol/sdk";

export type FakePromptHandler = (
  ctx: AgentRequestContext<PromptRequest>,
  sessionId: string,
) => Promise<StopReason> | StopReason;

export type FakeSetConfigHandler = (
  configId: string,
  value: boolean | string,
) => SessionConfigOption[] | void;

export class FakeCodingAgent {
  readonly app: AgentApp;
  private connection: AgentConnection | undefined;
  private sessionSeq = 0;

  promptHandler: FakePromptHandler | null = null;
  /** Token usage the next prompt responses report, as ACP's PromptResponse.usage. */
  promptUsage: PromptResponse["usage"] = null;
  protocolVersionOverride: number | null = null;
  /** When set, `session/new` fails with this message, as an agent whose account is refused does. */
  newSessionRefusal: string | null = null;
  /** When set, `initialize` fails with this message, as an agent refusing the handshake does. */
  initializeRefusal: string | null = null;
  readonly cancelNotifications: string[] = [];
  readonly answeredPermissions: RequestPermissionResponse[] = [];
  readonly setConfigRequests: { configId: string; value: boolean | string }[] = [];
  readonly closeRequests: string[] = [];
  readonly reopenRequests: { method: "load" | "resume"; sessionId: string; cwd: string }[] = [];
  private configOptions: SessionConfigOption[] = [];
  setConfigOptionHandler: FakeSetConfigHandler | null = null;

  constructor(
    options: {
      modes?: SessionModeState;
      configOptions?: SessionConfigOption[];
      /** Which reopen method to advertise; `load` replays `history` before answering. */
      reopen?: "resume" | "load" | "none";
      history?: string[];
    } = {},
  ) {
    this.configOptions = options.configOptions ?? [];
    const reopen = options.reopen ?? "none";
    this.app = agent({ name: "fake-agent" })
      .onConnect((conn) => {
        this.connection = conn;
      })
      .onRequest(methods.agent.initialize, () => {
        if (this.initializeRefusal !== null) throw new RequestError(-32000, this.initializeRefusal);
        return {
          protocolVersion: this.protocolVersionOverride ?? PROTOCOL_VERSION,
          agentCapabilities: {
            loadSession: reopen === "load",
            ...(reopen === "resume" ? { sessionCapabilities: { resume: {} } } : {}),
          },
        };
      })
      .onRequest(methods.agent.session.load, async (ctx) => {
        this.reopenRequests.push({
          method: "load",
          sessionId: ctx.params.sessionId,
          cwd: ctx.params.cwd,
        });
        for (const text of options.history ?? []) await this.say(ctx.params.sessionId, text);
        return {
          ...(options.configOptions !== undefined ? { configOptions: options.configOptions } : {}),
        };
      })
      .onRequest(methods.agent.session.resume, (ctx) => {
        this.reopenRequests.push({
          method: "resume",
          sessionId: ctx.params.sessionId,
          cwd: ctx.params.cwd,
        });
        return {
          ...(options.configOptions !== undefined ? { configOptions: options.configOptions } : {}),
        };
      })
      .onRequest(methods.agent.session.new, () => {
        if (this.newSessionRefusal !== null) throw new RequestError(-32000, this.newSessionRefusal);
        return {
          sessionId: `sess-${++this.sessionSeq}`,
          ...(options.modes !== undefined ? { modes: options.modes } : {}),
          ...(options.configOptions !== undefined ? { configOptions: options.configOptions } : {}),
        };
      })
      .onRequest(methods.agent.session.setConfigOption, (ctx) => {
        this.setConfigRequests.push({ configId: ctx.params.configId, value: ctx.params.value });
        const applied = this.setConfigOptionHandler?.(ctx.params.configId, ctx.params.value);
        if (applied !== undefined) this.configOptions = applied;
        else this.applyConfigValue(ctx.params.configId, ctx.params.value);
        return { configOptions: this.configOptions };
      })
      .onRequest(methods.agent.session.prompt, async (ctx): Promise<PromptResponse> => {
        const stopReason =
          this.promptHandler === null
            ? "end_turn"
            : await this.promptHandler(ctx, ctx.params.sessionId);
        return { stopReason, ...(this.promptUsage ? { usage: this.promptUsage } : {}) };
      })
      .onRequest(methods.agent.session.setMode, () => ({}))
      .onRequest(methods.agent.session.close, (ctx) => {
        this.closeRequests.push(ctx.params.sessionId);
        return {};
      })
      .onNotification(methods.agent.session.cancel, (ctx) => {
        this.cancelNotifications.push(ctx.params.sessionId);
      });
  }

  /** Stream one assistant text chunk to the client. */
  async say(sessionId: string, text: string): Promise<void> {
    await this.requireConnection().client.notify(methods.client.session.update, {
      sessionId,
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } },
    });
  }

  /** Report context occupancy and the session's running cost, as ACP's usage_update. */
  async reportUsage(
    sessionId: string,
    used: number,
    size: number,
    cost?: { amount: number; currency: string },
  ): Promise<void> {
    await this.requireConnection().client.notify(methods.client.session.update, {
      sessionId,
      update: { sessionUpdate: "usage_update", used, size, ...(cost ? { cost } : {}) },
    });
  }

  /** Stream one thinking chunk to the client. */
  async think(sessionId: string, text: string): Promise<void> {
    await this.requireConnection().client.notify(methods.client.session.update, {
      sessionId,
      update: { sessionUpdate: "agent_thought_chunk", content: { type: "text", text } },
    });
  }

  /** Emit a completed tool call (read a file, say). */
  async toolCall(
    sessionId: string,
    call: {
      toolCallId: string;
      title: string;
      kind?: "read" | "edit" | "execute" | "other";
      status?: "pending" | "in_progress" | "completed" | "failed";
      rawInput?: unknown;
    },
  ): Promise<void> {
    await this.requireConnection().client.notify(methods.client.session.update, {
      sessionId,
      update: { sessionUpdate: "tool_call", ...call },
    });
  }

  /** Ask the human for permission and wait for their answer. */
  async askPermission(
    sessionId: string,
    toolCall: {
      title?: string;
      kind?: "edit" | "execute";
      locations?: { path: string }[];
      rawInput?: unknown;
    } = {},
  ): Promise<RequestPermissionResponse> {
    const call: RequestPermissionRequest["toolCall"] = {
      toolCallId: "tool-1",
      title: toolCall.title ?? "Run tests",
      kind: toolCall.kind ?? "execute",
      locations: toolCall.locations ?? null,
      rawInput: toolCall.rawInput,
    };
    const response = await this.requireConnection().client.request(
      methods.client.session.requestPermission,
      {
        sessionId,
        toolCall: call,
        options: [
          { optionId: "allow", name: "Allow", kind: "allow_once" },
          { optionId: "reject", name: "Reject", kind: "reject_once" },
        ],
      },
    );
    this.answeredPermissions.push(response);
    return response;
  }

  /** Ask the human a login question; the kernel is expected to cancel it. */
  async askElicitation(sessionId: string): Promise<CreateElicitationResponse> {
    return await this.requireConnection().client.request(methods.client.elicitation.create, {
      sessionId,
      elicitationId: "elicit-1",
      mode: "url",
      url: "https://example.com/login",
      message: "Sign in to continue",
    });
  }

  /** Emit a full config-option set to the client, as a live config_option_update. */
  async pushConfigOptions(sessionId: string): Promise<void> {
    await this.requireConnection().client.notify(methods.client.session.update, {
      sessionId,
      update: { sessionUpdate: "config_option_update", configOptions: this.configOptions },
    });
  }

  /** Default set behavior: move the option to the value the client asked for. */
  private applyConfigValue(configId: string, value: boolean | string): void {
    for (const option of this.configOptions) {
      if (option.id !== configId) continue;
      if (option.type === "boolean" && typeof value === "boolean") {
        option.currentValue = value;
      } else if (option.type === "select" && typeof value === "string") {
        option.currentValue = value;
      }
    }
  }

  private requireConnection(): AgentConnection {
    if (this.connection === undefined) throw new Error("fake agent has no connection yet");
    return this.connection;
  }
}
