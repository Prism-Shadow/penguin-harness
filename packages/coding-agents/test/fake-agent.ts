/**
 * A scripted in-process ACP agent for tests: pairs directly with the kernel's client
 * (no subprocess), exposes hooks the tests set per case, and helper methods for the
 * agent->client direction (updates, permission asks, elicitation).
 */
import {
  agent,
  methods,
  PROTOCOL_VERSION,
  type AgentApp,
  type AgentConnection,
  type AgentRequestContext,
  type CreateElicitationResponse,
  type PromptRequest,
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
  protocolVersionOverride: number | null = null;
  readonly cancelNotifications: string[] = [];
  readonly answeredPermissions: RequestPermissionResponse[] = [];
  readonly setConfigRequests: { configId: string; value: boolean | string }[] = [];
  private configOptions: SessionConfigOption[] = [];
  setConfigOptionHandler: FakeSetConfigHandler | null = null;

  constructor(options: { modes?: SessionModeState; configOptions?: SessionConfigOption[] } = {}) {
    this.configOptions = options.configOptions ?? [];
    this.app = agent({ name: "fake-agent" })
      .onConnect((conn) => {
        this.connection = conn;
      })
      .onRequest(methods.agent.initialize, () => ({
        protocolVersion: this.protocolVersionOverride ?? PROTOCOL_VERSION,
      }))
      .onRequest(methods.agent.session.new, () => ({
        sessionId: `sess-${++this.sessionSeq}`,
        ...(options.modes !== undefined ? { modes: options.modes } : {}),
        ...(options.configOptions !== undefined ? { configOptions: options.configOptions } : {}),
      }))
      .onRequest(methods.agent.session.setConfigOption, (ctx) => {
        this.setConfigRequests.push({ configId: ctx.params.configId, value: ctx.params.value });
        const applied = this.setConfigOptionHandler?.(ctx.params.configId, ctx.params.value);
        if (applied !== undefined) this.configOptions = applied;
        else this.applyConfigValue(ctx.params.configId, ctx.params.value);
        return { configOptions: this.configOptions };
      })
      .onRequest(methods.agent.session.prompt, async (ctx): Promise<{ stopReason: StopReason }> => {
        const stopReason =
          this.promptHandler === null
            ? "end_turn"
            : await this.promptHandler(ctx, ctx.params.sessionId);
        return { stopReason };
      })
      .onRequest(methods.agent.session.setMode, () => ({}))
      .onRequest(methods.agent.session.close, () => ({}))
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
  async askPermission(sessionId: string): Promise<RequestPermissionResponse> {
    const response = await this.requireConnection().client.request(
      methods.client.session.requestPermission,
      {
        sessionId,
        toolCall: { toolCallId: "tool-1", title: "Run tests", kind: "execute" },
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
