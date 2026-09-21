/**
 * One ACP connection: a spawned agent subprocess speaking newline-delimited JSON-RPC v1
 * over stdio, wired through the official `@agentclientprotocol/sdk`. This file is the only
 * place the SDK's types appear; everything leaving it is the neutral vocabulary in
 * types.ts. Lifecycle (graceful stdin EOF, then a process-tree kill, including Windows)
 * follows the pattern proven in the use-codex plugin's client.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { Readable, Writable } from "node:stream";
import {
  client,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  RequestError,
  type AgentApp,
  type ClientConnection,
  type ContentBlock,
  type CreateElicitationResponse,
  type NewSessionResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
  type StopReason,
  type ToolCallContent,
  type ToolCallLocation,
  type ToolCallStatus,
  type ToolKind,
} from "@agentclientprotocol/sdk";
import { AcpAgentError, type AgentSessionEvent, type AgentToolCall } from "./types.js";

export type SpawnProcess = typeof spawn;

/**
 * npm-global CLIs are `.cmd`/`.bat` shims on Windows, which Node refuses to spawn
 * directly (EINVAL without a shell) — route just those through cmd.exe as one pre-quoted
 * command line. Definitions are admin-authored, the same trust as typing the command
 * into a shell, so cmd metacharacters in args stay the admin's own intent.
 */
function spawnTarget(command: string, args: string[]): [string, string[]] {
  if (process.platform !== "win32" || !/\.(cmd|bat)$/i.test(command)) return [command, args];
  // Tokens with spaces (an npm dir under "C:\Program Files") carry their own quotes;
  // with /s, cmd strips only the outer pair before executing the rest.
  const line = [command, ...args].map(quoteForCmdLine).join(" ");
  return ["cmd.exe", ["/d", "/s", "/c", `"${line}"`]];
}

function quoteForCmdLine(token: string): string {
  if (token !== "" && !/[\s"%]/.test(token)) return token;
  // cmd.exe expands %VARS% even inside double quotes; each % escapes as ^% outside a
  // fresh quote pair so a bare arg like 100% survives the shell intact.
  return `"${token.replaceAll('"', '""').replaceAll("%", '"^%"')}"`;
}

export interface AcpConnectionHandlers {
  onEvent: (event: AgentSessionEvent) => void;
  /** Called on the agent's `session/request_permission`; resolves with the human's choice. */
  onPermissionRequest: (request: RequestPermissionRequest) => Promise<RequestPermissionResponse>;
}

export interface AcpClientInfo {
  name: string;
  version: string;
}

export class AcpConnection {
  private killTimerArmed = false;
  /** The spawn's own failure (ENOENT, EACCES, ...): the handshake then dies with a generic stream error that hides it. */
  private spawnError: Error | null = null;

  private constructor(
    private readonly conn: ClientConnection,
    private readonly clientInfo: AcpClientInfo,
    private readonly handlers: AcpConnectionHandlers,
    private readonly proc?: ChildProcess,
  ) {
    proc?.on("error", (error: Error) => {
      this.spawnError = error;
      proc.kill();
    });
    void conn.closed.then(() => {
      handlers.onEvent({ type: "state", state: "closed" });
      this.killTree();
    });
  }

  /**
   * Spawn the agent command and open the ACP connection over its stdio. `env` is the FULL
   * child environment (the caller composes the sandboxed base via `sandboxedAgentEnv`).
   */
  static async spawn(
    command: string,
    args: string[],
    env: Record<string, string>,
    clientInfo: AcpClientInfo,
    handlers: AcpConnectionHandlers,
    spawnProcess: SpawnProcess = spawn,
  ): Promise<AcpConnection> {
    const [file, spawnArgs] = spawnTarget(command, args);
    const proc = spawnProcess(file, spawnArgs, {
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
      detached: process.platform !== "win32",
      // The cmd.exe route hands one pre-quoted string over; node must not re-quote it.
      ...(file !== command ? { windowsVerbatimArguments: true } : {}),
    });
    // Diagnostics can carry account secrets: drain without exposing them.
    proc.stderr.resume();
    if (process.env.PENGUIN_CODING_AGENTS_DEBUG === "1") {
      proc.stderr.on("data", (chunk: Buffer) => console.error("[agent-stderr]", chunk.toString()));
    }
    const conn = buildClientApp(clientInfo, handlers).connect(
      ndJsonStream(Writable.toWeb(proc.stdin!), Readable.toWeb(proc.stdout!)),
    );
    return new AcpConnection(conn, clientInfo, handlers, proc);
  }

  /** In-process variant for tests: pair this client with a scripted `AgentApp`. */
  static inProcess(
    agentApp: AgentApp,
    clientInfo: AcpClientInfo,
    handlers: AcpConnectionHandlers,
  ): AcpConnection {
    const conn = buildClientApp(clientInfo, handlers).connect(agentApp);
    return new AcpConnection(conn, clientInfo, handlers);
  }

  /** `initialize` handshake; refuses an agent speaking an unsupported protocol version. */
  async initialize(): Promise<void> {
    let info;
    try {
      info = await this.conn.agent.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientInfo: {
          name: this.clientInfo.name,
          title: "PenguinHarness",
          version: this.clientInfo.version,
        },
        // The agent does the filesystem/terminal work itself; we only relay elicitation
        // (login flows), which we surface as notices rather than answer programmatically.
        clientCapabilities: { elicitation: { form: {}, url: {} } },
      });
    } catch (error) {
      this.dispose();
      throw this.startupError(error);
    }
    if (info.protocolVersion !== PROTOCOL_VERSION) {
      this.dispose();
      throw new AcpAgentError(
        `agent speaks ACP protocol ${info.protocolVersion}, not the supported ${PROTOCOL_VERSION}`,
      );
    }
  }

  /**
   * A dead child surfaces as a generic stream failure; lead with the spawn error it came
   * from. A RequestError is the opposite case — the live agent refusing the handshake —
   * and its diagnostic is the useful part: initialize carries no user content, so unlike
   * turn errors it is safe to relay.
   */
  private startupError(error: unknown): AcpAgentError {
    if (this.spawnError !== null) {
      return new AcpAgentError(
        `the agent command could not be started: ${this.spawnError.message}`,
        {
          cause: this.spawnError,
        },
      );
    }
    if (error instanceof RequestError) {
      const detail = error.message !== "" ? `: ${error.message}` : "";
      return new AcpAgentError(`the agent refused the ACP handshake${detail}`, { cause: error });
    }
    return new AcpAgentError("the agent exited before the ACP handshake completed", {
      cause: error,
    });
  }

  async newSession(cwd: string): Promise<NewSessionResponse> {
    return await this.conn.agent.request(methods.agent.session.new, {
      cwd,
      mcpServers: [],
    });
  }

  /**
   * One turn. Resolves with the agent's stop reason; a long turn simply keeps the request
   * open, so no timeout applies here.
   */
  async prompt(sessionId: string, text: string): Promise<StopReason> {
    const response = await this.conn.agent.request(methods.agent.session.prompt, {
      sessionId,
      prompt: [{ type: "text", text }],
    });
    return response.stopReason;
  }

  async cancel(sessionId: string): Promise<void> {
    await this.conn.agent.notify(methods.agent.session.cancel, { sessionId });
  }

  async setMode(sessionId: string, modeId: string): Promise<void> {
    await this.conn.agent.request(methods.agent.session.setMode, { sessionId, modeId });
  }

  /** Ask the agent to close a session; a refusal or a missing method is not an error. */
  async closeSession(sessionId: string): Promise<void> {
    try {
      await this.conn.agent.request(methods.agent.session.close, { sessionId });
    } catch {
      // v1 agents without session/close just drop it; the connection stays usable.
    }
  }

  /** EOF on stdin first so maintained adapters can stop their own children; then hard-kill. */
  dispose(): void {
    this.conn.close();
    if (this.proc === undefined) return;
    this.proc.stdin?.end();
    if (this.proc.pid !== undefined && this.proc.exitCode === null && !this.killTimerArmed) {
      this.killTimerArmed = true;
      const pid = this.proc.pid;
      const timer = setTimeout(() => this.killTree(), 4_000);
      timer.unref();
      this.proc.once("exit", () => clearTimeout(timer));
    }
  }

  private killTree(): void {
    const proc = this.proc;
    if (proc === undefined || proc.pid === undefined || proc.exitCode !== null) return;
    if (process.platform === "win32") {
      const killer = spawn("taskkill.exe", ["/PID", String(proc.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
      killer.on("error", () => proc.kill());
    } else {
      try {
        process.kill(-proc.pid, "SIGKILL");
      } catch {
        // Already exited.
      }
    }
  }
}

/** Build the client-side ACP app: session updates to events, human-owned asks to handlers. */
function buildClientApp(
  clientInfo: AcpClientInfo,
  handlers: AcpConnectionHandlers,
): ReturnType<typeof client> {
  const lastToolTitles = new Map<string, string>();
  return client({ name: clientInfo.name })
    .onNotification(methods.client.session.update, (ctx) => {
      emitUpdate(handlers.onEvent, ctx.params, lastToolTitles);
    })
    .onRequest(methods.client.session.requestPermission, (ctx) =>
      handlers.onPermissionRequest(ctx.params),
    )
    .onRequest(methods.client.elicitation.create, (ctx) => {
      // No programmatic answers to agent questions: cancel and surface a notice so the
      // UI can explain what the agent wanted (a login form, ...). The ask's message is
      // optional on the v1 wire.
      const raw = (ctx.params as { message?: unknown }).message;
      const message =
        typeof raw === "string" && raw !== "" ? raw : "the agent requested your input";
      handlers.onEvent({ type: "notice", sessionId: null, message });
      const response: CreateElicitationResponse = { action: "cancel" };
      return response;
    });
}

/** Project a `session/update` notification onto the neutral event vocabulary. */
function emitUpdate(
  onEvent: AcpConnectionHandlers["onEvent"],
  params: SessionNotification,
  lastToolTitles: Map<string, string>,
): void {
  const update = params.update;
  const sessionId = params.sessionId;
  switch (update.sessionUpdate) {
    case "agent_message_chunk":
    case "agent_thought_chunk": {
      const delta = textOfContentBlock(update.content);
      if (delta !== "") {
        onEvent(
          update.sessionUpdate === "agent_message_chunk"
            ? { type: "message_chunk", sessionId, delta }
            : { type: "thought_chunk", sessionId, delta },
        );
      }
      return;
    }
    case "tool_call":
      onEvent({
        type: "tool_call",
        sessionId,
        call: toolCallFromAcp(update, lastToolTitles),
      });
      return;
    case "tool_call_update":
      onEvent({
        type: "tool_call_update",
        sessionId,
        call: toolCallFromAcp(update, lastToolTitles),
      });
      return;
    case "current_mode_update":
      onEvent({
        type: "modes",
        sessionId,
        modes: { currentModeId: update.currentModeId, modes: [] },
      });
      return;
    case "usage_update":
      onEvent({
        type: "usage",
        sessionId,
        used: update.used,
        ...(update.size !== null ? { size: update.size } : {}),
      });
      return;
    default:
      // plan, available_commands, session_info, compaction: not surfaced in v1.
      return;
  }
}

/** The loosest ACP tool-call shape: full `tool_call` and partial `tool_call_update` both. */
interface AcpToolCallShape {
  toolCallId: string;
  title?: string | null;
  kind?: ToolKind | null;
  status?: ToolCallStatus | null;
  content?: ToolCallContent[] | null;
  locations?: ToolCallLocation[] | null;
  rawInput?: unknown;
}

/** Project an ACP tool call (full or partial update) onto a complete neutral snapshot. */
function toolCallFromAcp(
  call: AcpToolCallShape,
  lastToolTitles: Map<string, string>,
): AgentToolCall {
  if (call.title !== undefined && call.title !== null) {
    lastToolTitles.set(call.toolCallId, call.title);
  }
  const title = call.title ?? lastToolTitles.get(call.toolCallId) ?? call.toolCallId;
  const content = call.content;
  return {
    toolCallId: call.toolCallId,
    title,
    ...(call.kind !== undefined && call.kind !== null ? { kind: call.kind } : {}),
    status: call.status ?? "pending",
    ...(call.rawInput !== undefined && call.rawInput !== null ? { rawInput: call.rawInput } : {}),
    ...(content !== undefined && content !== null && content.length > 0
      ? {
          output: content
            .map(textOfToolCallContent)
            .filter((t) => t !== "")
            .join("\n"),
        }
      : {}),
    locations:
      call.locations !== undefined && call.locations !== null
        ? call.locations.map((l) => ({
            path: l.path,
            ...(l.line !== undefined && l.line !== null ? { line: l.line } : {}),
          }))
        : [],
  };
}

function textOfContentBlock(block: ContentBlock): string {
  if (block.type === "text") return block.text;
  return "";
}

function textOfToolCallContent(content: ToolCallContent): string {
  if (content.type === "content") return textOfContentBlock(content.content);
  // diff/terminal blocks render client-side from rawInput/rawOutput in v1.
  return "";
}
