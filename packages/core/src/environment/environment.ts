/**
 * Environment —— executes approved tool calls inside the Workspace.
 *
 * Environment has no knowledge of any specific tool: it only assembles the tool names supported
 * by ToolConfig into BuiltinTool instances (see `environment/tools/`), and dispatches execution
 * by looking up the tool name. Adding a new built-in tool only requires implementing BuiltinTool
 * and registering it — no changes to this file needed. Tools from configured MCP Servers join
 * through the same BuiltinTool shape (see `environment/mcp/`) under `mcp__<server>__<tool>`
 * names, so the execution contract below applies to them unchanged. Tool call **rendering** is
 * not core's concern; it's handled by the CLI / Web frontend.
 *
 * The **framing and finalization** of the tool stream is handled uniformly by Environment:
 * - Entering execution immediately emits `start`; the tool only needs to yield output deltas
 *   (its own start/stop are ignored);
 * - Output is bounded online by maxOutputLength as **head and tail windows**: the budget splits
 *   in half, the head window streams live, and text past it is withheld into a fixed-capacity
 *   rolling tail flushed at finalization — verbatim when the total stayed within budget, or as
 *   a truncation marker carrying kept/total counts followed by the last tail window when it did
 *   not. The marker, the tool's self-reported end marker (`ToolResult.note`, e.g. exit code —
 *   appended outside the budget, never lost even when long output is truncated), and
 *   timeout/interruption/error markers are all emitted as part of the stream — **the content
 *   produced by concatenating streamed chunks matches the full message exactly**;
 * - Nested session messages carrying an origin marker (e.g. forwarded from run_subagent) pass
 *   through unchanged, taking no part in this tool's output or finalization;
 * - Argument parsing failures, unknown tool names, tool throws, and other exceptions all
 *   collapse into an explanatory, complete `tool_call_output` — never throws — and **output is
 *   never empty under any circumstance**.
 * Docs: /docs/tools § "Execution contract".
 */
import path from "node:path";
import { partialToolCallOutput, toolCallOutput, userText } from "../omnimessage/index.js";
import type { McpServerConnectResult, OmniMessage, StopReason } from "../omnimessage/index.js";
import type {
  ApproveFn,
  BackgroundCommandInfo,
  BackgroundSubagentInfo,
  BackgroundTaskDoneEvent,
  EnvironmentConfig,
  EnvironmentInterface,
  SubagentMessageOptions,
  SubagentMessageOutcome,
  SubagentRunner,
  ToolConfig,
  ToolDefinition,
  ToolExecutionRequest,
  ToolPermission,
} from "../interfaces/index.js";
import type { BuiltinTool, ToolResult } from "./tools/types.js";
import { BUILTIN_TOOL_FACTORIES } from "./tools/registry.js";
import { McpToolProvider } from "./mcp/provider.js";
import { CommandSessionManager } from "./tools/command/index.js";
import { ManagedSubagentSession, SubagentSessionManager } from "./tools/subagent/index.js";
import {
  TRUNCATED_TOOL_OUTPUT_FILE_LIMIT_BYTES,
  TruncatedToolOutputArchive,
  type TruncatedToolOutputArchiveSaveResult,
  type TruncatedToolOutputCapture,
} from "./truncated-tool-output-archive.js";
import { modelVisiblePath } from "../internal/model-visible-path.js";

/** Default cap on tool output truncation (characters). */
const DEFAULT_MAX_OUTPUT_LENGTH = 16000;

/** Default timeout cap for a single tool call (milliseconds); <=0 disables it (every tool must be bound by timeoutMs). */
const DEFAULT_TOOL_TIMEOUT_MS = 120000;

/** Marker appended to the result when a tool is interrupted by the user. */
const TOOL_ABORTED_NOTE = "[interrupted: tool aborted by user]";

/** Placeholder marker used when a tool produces no output at all (tool_call_output content is never empty). */
const TOOL_EMPTY_NOTE = "[no output]";

/**
 * Explanation for a failed argument JSON parse. The normal pipeline never reaches this: bad
 * JSON already throws during AgentHub's parsing stage, and the LLM layer finalizes it as
 * malformed for the engine to reconnect (see generative-model.ts) — it's never dispatched into
 * Environment as a completed tool_call. This function is only a defensive fallback for the
 * public interface.
 */
function describeArgumentsError(name: string, raw: string, err: unknown): string {
  const detail = err instanceof Error ? err.message : String(err);
  if (raw.trim() === "") {
    return `Tool call "${name}" failed: the arguments field is empty. Re-issue the call with a complete JSON object.`;
  }
  return `Tool call "${name}" failed: the arguments are not valid JSON (${detail}). Re-issue the call with one complete, valid JSON object.`;
}

/** Appends a marker after existing content: newline-joins if content is non-empty, otherwise just returns the marker. */
function appendNote(base: string, note: string): string {
  return base ? `${base}\n${note}` : note;
}

/** The delta needed to stream out `note` on top of existing content `base` (includes separator, same basis as appendNote). */
function noteSuffix(base: string, note: string): string {
  return base ? `\n${note}` : note;
}

/** UTF-16 surrogate probes for budget cuts: the visible windows must not end or start mid-pair. */
function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** The truncation marker placed between the kept head and tail windows; the total lets the model judge whether the recovery file is worth reading. */
function truncationMarker(headLen: number, tailLen: number, totalLen: number): string {
  return `[output truncated: kept first ${headLen} and last ${tailLen} of ${totalLen} chars]`;
}

/** Joins visible windows around the marker; empty sides drop out so a zero head budget does not lead with a blank line. */
function joinVisibleParts(head: string, marker: string, tail: string): string {
  return [head, marker, tail].filter((part) => part !== "").join("\n");
}

/**
 * Bounds one complete string (the compatibility full-message basis) to the visible budget:
 * head and tail windows around a counting marker, with surrogate pairs kept whole at both cuts.
 */
function boundVisible(
  text: string,
  headBudget: number,
  tailBudget: number,
): { visible: string; truncated: boolean } {
  const cap = headBudget + tailBudget;
  if (text.length <= cap) return { visible: text, truncated: false };
  let head = text.slice(0, headBudget);
  if (head !== "" && isHighSurrogate(head.charCodeAt(head.length - 1))) head = head.slice(0, -1);
  let tail = text.slice(text.length - tailBudget);
  if (tail !== "" && isLowSurrogate(tail.charCodeAt(0))) tail = tail.slice(1);
  return {
    visible: joinVisibleParts(head, truncationMarker(head.length, tail.length, text.length), tail),
    truncated: true,
  };
}

export class Environment implements EnvironmentInterface {
  private readonly workspaceDir: string;
  private readonly toolConfig: ToolConfig;
  /**
   * Truncated-output recovery, derived from the generic `sessionScratchpadDir` config; null for
   * standalone embedders without a Session directory (legacy truncation-only behavior).
   */
  private readonly truncatedToolOutputArchive: TruncatedToolOutputArchive | null;
  /** Assembled built-in tools: tool name -> BuiltinTool. Only tools supported by the registry and present in config. */
  private readonly tools: Map<string, BuiltinTool>;
  /** MCP Server bridge (null when config lists no servers): lazily connects and exposes `mcp__<server>__<tool>` entries. */
  private readonly mcp: McpToolProvider | null;
  /** Long-running command session registry: constructed within this Environment and shared between exec_command / input_command. */
  private readonly commandSessions: CommandSessionManager;
  /** Background subagent session registry: constructed within this Environment and shared between run_subagent / input_subagent. */
  private readonly subagentSessions: SubagentSessionManager;
  /** The injected child-agent runner (null for embedders without one): the host resume fallback needs it outside any tool call. */
  private readonly subagentRunner: SubagentRunner | null;

  constructor(config: EnvironmentConfig) {
    this.workspaceDir = config.workspaceDir;
    this.toolConfig = config.toolConfig;
    this.truncatedToolOutputArchive = config.sessionScratchpadDir
      ? new TruncatedToolOutputArchive({
          rootDir: path.join(config.sessionScratchpadDir, "truncated-tool-output"),
        })
      : null;
    this.tools = new Map();
    // The background session registry is created alongside Environment (one per Session) and
    // injected into whichever tools need it; all sessions are finalized together on dispose.
    // The vault environment variables are injected into child processes by the command session
    // registry at spawn time (which also applies the proxyEnv policy — strip or inject).
    this.commandSessions = new CommandSessionManager({
      ...(config.vault !== undefined ? { vault: config.vault } : {}),
      ...(config.proxyEnv !== undefined ? { proxyEnv: config.proxyEnv } : {}),
    });
    this.subagentSessions = new SubagentSessionManager();
    this.subagentRunner = config.services?.subagentRunner ?? null;
    const services = {
      ...config.services,
      commandSessions: this.commandSessions,
      subagentSessions: this.subagentSessions,
      // Completion reports of run_in_background launches converge here; the Session attaches
      // the single consumer via setBackgroundTaskListener (events before that are buffered).
      backgroundDone: (event: BackgroundTaskDoneEvent) => this.emitBackgroundDone(event),
      // Live-forwarded background-subagent messages, same single-consumer pattern.
      backgroundForward: (msg: OmniMessage) => this.emitBackgroundForward(msg),
    };
    // Assemble the tools supported by config into BuiltinTool instances; unrecognized tool
    // names are skipped (neither exposed to the LLM nor executable).
    for (const def of config.toolConfig.customTools) {
      const factory = BUILTIN_TOOL_FACTORIES[def.name];
      if (factory) this.tools.set(def.name, factory(def, services));
    }
    // MCP Servers bridge in lazily: construction only records the config; connecting and
    // tool discovery happen on the first listTools()/executeTool() (see McpToolProvider).
    // The vault is deliberately not handed over: MCP server processes see only the SDK's
    // safe env defaults plus the entry's own env.
    this.mcp =
      config.toolConfig.mcpServers.length > 0
        ? new McpToolProvider(config.toolConfig.mcpServers, {
            workspaceDir: config.workspaceDir,
          })
        : null;
  }

  /** Releases runtime resources held by Environment: finalizes all managed background sessions (command and subagent) and closes MCP clients (stdio server processes included). Idempotent. */
  dispose(): void {
    // Suppress completion reports first: dispose kills the remaining background sessions, and
    // their exits must not masquerade as task completions after the Session has ended.
    this.bgDisposed = true;
    this.bgBuffer = [];
    this.bgFwdBuffer = [];
    this.commandSessions.dispose();
    this.subagentSessions.dispose();
    this.mcp?.closeQuietly();
  }

  // Background completion reports: a single listener (the owning Session), with events fired
  // before the attach buffered so a fast completion is never lost between construction and wiring.
  private bgListener: ((event: BackgroundTaskDoneEvent) => void) | null = null;
  private bgBuffer: BackgroundTaskDoneEvent[] = [];
  private bgDisposed = false;

  private emitBackgroundDone(event: BackgroundTaskDoneEvent): void {
    if (this.bgDisposed) return;
    if (this.bgListener) this.bgListener(event);
    else this.bgBuffer.push(event);
  }

  /** Attaches the single background-completion listener, flushing buffered events (see EnvironmentInterface). */
  setBackgroundTaskListener(listener: (event: BackgroundTaskDoneEvent) => void): void {
    this.bgListener = listener;
    const buffered = this.bgBuffer;
    this.bgBuffer = [];
    for (const event of buffered) this.emitBackgroundDone(event);
  }

  // Live-forwarded background-subagent messages: same single-listener + buffer-until-attach
  // pattern as the completion reports above.
  private bgFwdListener: ((msg: OmniMessage) => void) | null = null;
  private bgFwdBuffer: OmniMessage[] = [];

  private emitBackgroundForward(msg: OmniMessage): void {
    if (this.bgDisposed) return;
    if (this.bgFwdListener) this.bgFwdListener(msg);
    else this.bgFwdBuffer.push(msg);
  }

  /** Attaches the single background-message listener, flushing buffered messages (see EnvironmentInterface). */
  setBackgroundMessageListener(listener: (msg: OmniMessage) => void): void {
    this.bgFwdListener = listener;
    const buffered = this.bgFwdBuffer;
    this.bgFwdBuffer = [];
    for (const msg of buffered) this.emitBackgroundForward(msg);
  }

  /** Background command processes registered by exec_command (still-listed exited ones included; the host UI filters as it sees fit). */
  listBackgroundCommands(): BackgroundCommandInfo[] {
    return this.commandSessions.list().map(({ processId, session }) => ({
      processId,
      pid: session.pid,
      cmd: session.cmd,
      cwd: session.cwd,
      startedAt: session.startedAt,
      running: session.running,
      ...(session.serviceUrl !== null ? { serviceUrl: session.serviceUrl } : {}),
    }));
  }

  /** Refreshes the listen-port probes behind serviceUrl (running sessions only; each internally TTL-cached and time-bounded — see EnvironmentInterface). */
  async probeBackgroundCommandServices(): Promise<void> {
    await Promise.all(
      this.commandSessions.list().map(({ session }) => session.refreshServiceProbe()),
    );
  }

  /** Whether a managed subagent session is mid-round (see EnvironmentInterface.hasRunningBackgroundSubagents). */
  hasRunningBackgroundSubagents(): boolean {
    return this.subagentSessions.hasRunning();
  }

  /** All live subagent child sessions, foreground-window ones included (see EnvironmentInterface.listBackgroundSubagents). */
  listBackgroundSubagents(): BackgroundSubagentInfo[] {
    return this.subagentSessions.listLive();
  }

  /**
   * Host-initiated message to one child session — a user's input on the child, whatever its
   * state: steering mid-run, a follow-up run when idle, a revival through the runner when the
   * session is no longer live (see EnvironmentInterface.sendToBackgroundSubagent). Converges
   * on the same managed-session channel input_subagent uses; the message carries no sender
   * (human origin), unlike the model path's "parent_agent". `opts.thinkingLevel` pins only a
   * round this call starts — steering cannot change the round already in flight.
   */
  async sendToBackgroundSubagent(
    childSessionId: string,
    text: string,
    opts?: SubagentMessageOptions,
  ): Promise<SubagentMessageOutcome> {
    const session = this.subagentSessions.bySessionId(childSessionId);
    if (!session) return this.resumeAndRun(childSessionId, text, opts);
    this.attachHostTap(session);
    if (session.steer([userText(text)])) return "steered";
    if (session.running) return "busy";
    try {
      // A host round is the user's own conversation with the child, not work the model
      // dispatched: it must not fire a background completion notice at the parent.
      session.startRun(text, {
        ...(opts?.thinkingLevel !== undefined ? { thinkingLevel: opts.thinkingLevel } : {}),
        suppressDoneReport: true,
      });
    } catch {
      return "gone";
    }
    return "started";
  }

  /**
   * The resume fallback of sendToBackgroundSubagent: revives the released child Session
   * (resumeSession semantics via SubagentRunner.resume), re-manages it — live index,
   * background registration (so the model can address it again by subagent_id), forwarding
   * tap, and the host approval fallback via track — and starts its next round with the text.
   */
  private async resumeAndRun(
    childSessionId: string,
    text: string,
    opts?: SubagentMessageOptions,
  ): Promise<SubagentMessageOutcome> {
    const agentId = opts?.resume?.agentId;
    const runner = this.subagentRunner;
    if (agentId === undefined || !runner?.resume || this.subagentSessions.isDisposed) {
      return "gone";
    }
    // Same admission rule as a spawn: never evict a running child to make room.
    if (!this.subagentSessions.makeRoom()) return "busy";
    let session: ManagedSubagentSession;
    try {
      session = new ManagedSubagentSession(
        await runner.resume({ agentId, sessionId: childSessionId }),
        { resumeAgentId: agentId },
      );
    } catch {
      return "gone"; // No trace to resume from, or the agent is gone: nothing to revive.
    }
    this.subagentSessions.track(session);
    this.subagentSessions.register(session);
    this.attachHostTap(session);
    try {
      // Host-initiated like the started path: no completion notice at the parent.
      session.startRun(text, {
        ...(opts?.thinkingLevel !== undefined ? { thinkingLevel: opts.thinkingLevel } : {}),
        suppressDoneReport: true,
      });
    } catch {
      return "gone";
    }
    return "resumed";
  }

  /** Host-initiated abort of one child session's current run (see EnvironmentInterface.abortBackgroundSubagentRun). */
  abortBackgroundSubagentRun(childSessionId: string): boolean {
    const session = this.subagentSessions.bySessionId(childSessionId);
    if (!session) return false;
    this.attachHostTap(session);
    return session.abortRun();
  }

  /** Attaches the single subagent run-state listener (see EnvironmentInterface.setSubagentStateListener). */
  setSubagentStateListener(listener: () => void): void {
    this.subagentSessions.setStateListener(() => {
      if (!this.bgDisposed) listener();
    });
  }

  /** Attaches the host's session-lifetime fallback approval sink for child sessions (see EnvironmentInterface.setSubagentApprovalFallback). */
  setSubagentApprovalFallback(approve: ApproveFn): void {
    this.subagentSessions.setApprovalFallback((toolCall) =>
      this.bgDisposed ? Promise.resolve("deny") : approve(toolCall),
    );
  }

  /**
   * A host touching a child proves a live-forwarding consumer exists, so attach the message
   * tap on first touch: the child's messages then reach the frontend the moment they are
   * produced instead of waiting for the model's next poll. Model-facing text buffering and
   * poll semantics are unchanged; background launches already attached this tap at launch.
   */
  private attachHostTap(session: {
    hasMessageTap: boolean;
    setMessageTap(tap: (msg: OmniMessage) => void): void;
  }): void {
    if (session.hasMessageTap) return;
    session.setMessageTap((msg) => this.emitBackgroundForward(msg));
  }

  /** Kills one background command process (whole process group) and drops it from the registry; false when the id is unknown. */
  killBackgroundCommand(processId: string): boolean {
    return this.commandSessions.kill(processId);
  }

  /**
   * Lists tools available to the current Session, for context_engine to initialize GenerativeModel.
   * Only lists tools that have been assembled (i.e. supported by the registry) — tool names
   * unrecognized in config are not exposed to the LLM (consistent with the constructor);
   * the definition (description/parameters) treats **the config entry as the single source of
   * truth** — factories must not rewrite the definition at runtime; where a differentiated
   * implementation is needed, use a separate explicit tool-name entry with a `forModel`
   * annotation (e.g. read_image / describe_image).
   * Only exposes `{name, description, parameters}`, dropping permission/maxOutputLength.
   * MCP Server tools follow the builtin list: the first call connects the configured
   * servers and appends their discovered tools as `mcp__<server>__<tool>` entries
   * (unreachable servers are skipped with a stderr warning; see environment/mcp/).
   */
  async listTools(): Promise<ToolDefinition[]> {
    const builtin = this.toolConfig.customTools
      .filter((tool) => this.tools.has(tool.name))
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        ...(tool.parameters !== undefined ? { parameters: tool.parameters } : {}),
      }));
    if (!this.mcp) return builtin;
    return [...builtin, ...(await this.mcp.listTools())];
  }

  /** Names of the validly configured MCP servers (config order; empty without MCP). Concrete-class surface for the composition layer's connect events — not part of EnvironmentInterface. */
  mcpServerNames(): string[] {
    return this.mcp?.serverNames() ?? [];
  }

  /** Per-server MCP connect outcomes, populated by the first listTools(); empty before it or without MCP. Feeds the mcp_connect_end event. */
  mcpConnectResults(): McpServerConnectResult[] {
    return this.mcp?.connectResults() ?? [];
  }

  /** Cancels an in-flight MCP connect attempt (user abort mid-connect): the next listTools() reconnects from scratch. No-op without MCP or when nothing is in flight. */
  cancelMcpConnect(): void {
    this.mcp?.cancelConnect();
  }

  /** Looks up a tool's permission level (for the frontend's permission-mode decisions); returns undefined for an unknown tool. MCP tools answer from their entry's `permission` after discovery, or from their own `readOnlyHint` annotation when the entry sets none. */
  toolPermission(name: string): ToolPermission | undefined {
    return (
      this.toolConfig.customTools.find((t) => t.name === name)?.permission ??
      this.mcp?.toolPermission(name)
    );
  }

  /**
   * Executes an approved tool call, streaming `partial_tool_call_output` and a final
   * `tool_call_output`; nested messages carrying origin pass through unchanged. Dispatches by
   * looking up the tool name; any exception collapses into an explanatory output — never throws.
   *
   * The priority for deciding stop_reason is: user interruption > timeout > tool throw > tool
   * self-report. Interruption is determined by the `signal` held by Environment, and is
   * compatible with both a tool self-reporting aborted and an AbortError raised by the
   * interruption. An internal abort raised by a timeout does not count as a user interruption —
   * it's finalized as failed, with the timeout reason written into the output.
   * Docs: /docs/tools § "Execution contract".
   */
  async *executeTool(request: ToolExecutionRequest): AsyncGenerator<OmniMessage> {
    const payload = request.toolCall.payload;
    // tool_call_id is passed through unchanged, so context_engine and the LLM can associate the
    // request with its result.
    const toolCallId = payload.tool_call_id;
    const name = payload.name;

    // Every path is framed uniformly by Environment: entering execution emits start; the end
    // uniformly emits stop + the full message.
    yield partialToolCallOutput({ eventType: "start", toolCallId });

    // Builtin lookup first; an MCP-prefixed name resolves through the provider (which
    // connects on demand — resolution failures fall through to the unknown-tool reply).
    const tool = this.tools.get(name) ?? (await this.mcp?.resolveTool(name));
    if (!tool) {
      yield* emitFailure(toolCallId, `Unknown tool: ${name}`);
      return;
    }

    // Parse the tool's argument JSON; a parse failure collapses into an explanatory output
    // (also streamed, so the frontend can render it).
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload.arguments);
    } catch (err) {
      yield* emitFailure(toolCallId, describeArgumentsError(name, payload.arguments, err));
      return;
    }

    const args =
      parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};

    const maxOutputLength = tool.definition.maxOutputLength ?? DEFAULT_MAX_OUTPUT_LENGTH;
    const timeoutMs = tool.definition.timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;
    const signal = request.signal;

    // User interruption and tool timeout are merged into a single internal signal handed to the
    // tool: either one triggers abortion of execution.
    // The timeout constraint is enforced uniformly by Environment for all tools; the
    // tool only needs to respond to signal.
    const ac = new AbortController();
    if (signal?.aborted) ac.abort();
    const onAbort = (): void => ac.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    let timedOut = false;
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            ac.abort();
          }, timeoutMs)
        : null;
    timer?.unref?.();

    // Consume the tool stream: the head window is forwarded live, text past it is withheld into
    // a bounded rolling tail; nested messages pass through; manual iteration to capture the
    // generator's return value.
    // maxOutputLength <= 0 disables the budget entirely (same semantics as timeoutMs).
    const truncationEnabled = maxOutputLength > 0;
    const headBudget = truncationEnabled
      ? Math.floor(maxOutputLength / 2)
      : Number.POSITIVE_INFINITY;
    const tailBudget = truncationEnabled ? maxOutputLength - headBudget : 0;
    // Tail window plus slack: one char for the head's surrogate retraction and one more so a
    // run that ends exactly on the budget boundary never evicts — a within-budget run must
    // flush its withheld text verbatim.
    const withheldCapacity = tailBudget + 2;
    let streamed = ""; // Head window forwarded so far (<= headBudget)
    let headClosed = false; // Once true, nothing more streams live; all further text is withheld
    let withheld = ""; // Rolling buffer of text past the head window (<= withheldCapacity)
    let contentLen = 0; // Total length of content produced by the tool (including evicted parts)
    let toolOutput: string | null = null; // Fallback: content basis when the tool produces a full message itself
    let selfReported: StopReason | undefined; // Tool's self-reported stop reason (return value takes priority over the full message)
    let selfNote: string | null = null; // Tool's self-reported end marker (e.g. exit code), appended outside truncation
    let selfImages: string[] | undefined; // Tool's self-reported images (data URL), carried via a single streamed delta and the full message
    let thrown: unknown = null;
    // Created lazily on the first delta that takes the total past the budget when this
    // Environment has a Session scratchpad. It captures the tool's complete text before the
    // rolling tail evicts the middle, but does not alter the model/frontend stream.
    let archiveCapture: TruncatedToolOutputCapture | null = null;
    const gen = tool.execute(args, {
      workspaceDir: this.workspaceDir,
      toolCallId,
      signal: ac.signal,
      // Pass through the parent's approve callback (run_subagent uses it so the child Session
      // inherits the parent's approval mode; other tools ignore it).
      ...(request.approve ? { approve: request.approve } : {}),
    });
    try {
      for (;;) {
        const res = await gen.next();
        if (res.done) {
          const result: ToolResult | void = res.value;
          if (result?.stopReason) selfReported = result.stopReason;
          if (result?.note) selfNote = result.note;
          if (result?.images && result.images.length > 0) selfImages = result.images;
          break;
        }
        const out = res.value;
        if (out.origin && out.origin.length > 0) {
          yield out; // Nested session message: pass through unchanged, not part of this tool's output/finalization
          continue;
        }
        const p = out.payload as {
          type?: string;
          event_type?: string;
          stop_reason?: string;
          output?: string;
        };
        if (p.type === "partial_tool_call_output") {
          // Only takes delta content; start/stop are ignored (framing is uniformly handled by Environment).
          if (p.event_type !== "delta" || !p.output) continue;
          contentLen += p.output.length;
          if (
            truncationEnabled &&
            contentLen > maxOutputLength &&
            this.truncatedToolOutputArchive
          ) {
            if (!archiveCapture) {
              archiveCapture = this.truncatedToolOutputArchive.startCapture();
              // `streamed` then `withheld` is exactly the tool text accepted before this delta:
              // forwarding stops for good once the head window closes, so the two segments are
              // contiguous. Appending them once, then every complete current/future delta,
              // reconstructs the pre-truncation tool text without changing what is forwarded.
              archiveCapture.append(streamed);
              archiveCapture.append(withheld);
            }
            archiveCapture.append(p.output);
          }
          let rest = p.output;
          if (!headClosed) {
            const room = headBudget - streamed.length;
            if (rest.length < room) {
              streamed += rest;
              // Rebuild the delta: tool_call_id is uniformly enforced by Environment, never trusting the tool's own value.
              yield partialToolCallOutput({
                eventType: "delta",
                output: rest,
                toolCallId,
              });
              rest = "";
            } else {
              headClosed = true;
              let chunk = rest.slice(0, room);
              // The closed head must not end on a pairable high surrogate: its low half would
              // otherwise sit across the marker or in the dropped middle. Withholding it keeps
              // the pair whole — the finalization flush reunites the two halves whenever the
              // boundary region survives.
              if (chunk !== "" && isHighSurrogate(chunk.charCodeAt(chunk.length - 1))) {
                chunk = chunk.slice(0, -1);
              }
              if (chunk !== "") {
                streamed += chunk;
                yield partialToolCallOutput({
                  eventType: "delta",
                  output: chunk,
                  toolCallId,
                });
              }
              rest = rest.slice(chunk.length);
            }
          }
          if (rest !== "") {
            withheld += rest;
            if (withheld.length > withheldCapacity) {
              withheld = withheld.slice(withheld.length - withheldCapacity);
            }
          }
        } else if (p.type === "tool_call_output") {
          // Fallback: if the tool still produces a full message, use it as the basis for content and stop reason (not needed under the new contract).
          toolOutput = p.output ?? "";
          if (
            maxOutputLength > 0 &&
            toolOutput.length > maxOutputLength &&
            this.truncatedToolOutputArchive
          ) {
            if (!archiveCapture) {
              archiveCapture = this.truncatedToolOutputArchive.startCapture();
            }
            // A compatibility tool's complete message is Environment's content basis, so it
            // also becomes the recovery basis instead of any deltas it happened to emit.
            archiveCapture.replace(toolOutput);
          }
          if (selfReported === undefined && p.stop_reason) {
            selfReported = p.stop_reason as StopReason;
          }
        } else {
          // Other message types without origin: protocol misuse, ignore and warn (keep the parent stream clean).
          process.stderr.write(
            `[penguin] tool "${name}" yielded unexpected message type "${p.type}"; ignored.\n`,
          );
        }
      }
    } catch (err) {
      // A tool throw also collapses into the uniform finalization: keep already-streamed content, don't discard produced output.
      thrown = err;
    } finally {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }

    // Uniform finalization. Content basis = the tool's self-produced full message (fallback
    // path) or the forwarded head plus the withheld tail. A within-budget run flushes the
    // withheld text verbatim; an over-budget run keeps the head and tail windows around a
    // counting marker. Markers and notes are then appended in turn, all made up via streamed
    // deltas — streamed concatenation == the full message.
    let visible: string;
    let truncated: boolean;
    if (toolOutput !== null) {
      ({ visible, truncated } = boundVisible(toolOutput, headBudget, tailBudget));
    } else if (!truncationEnabled || contentLen <= maxOutputLength) {
      // The rolling buffer never evicts within budget, so this is the complete tool text.
      visible = streamed + withheld;
      truncated = false;
    } else {
      let tail = withheld.slice(withheld.length - tailBudget);
      if (tail !== "" && isLowSurrogate(tail.charCodeAt(0))) tail = tail.slice(1);
      visible = joinVisibleParts(
        streamed,
        truncationMarker(streamed.length, tail.length, contentLen),
        tail,
      );
      truncated = true;
    }
    // Freeze the tool's terminal facts before auxiliary archive I/O. A user abort arriving
    // while the file is being written must not reclassify an already-finished tool.
    const aborted =
      signal?.aborted === true ||
      (!timedOut &&
        (selfReported === "aborted" ||
          (thrown as { name?: string } | null)?.name === "AbortError"));
    let archiveResult: TruncatedToolOutputArchiveSaveResult | null = null;
    if (truncated && archiveCapture) {
      // Both truncation paths initialize this capture at the exact point they first exceed the
      // visible cap, so a truncated call with a Session scratchpad always has one to save. A
      // standalone Environment has no capture and retains truncation-only behavior.
      archiveResult = await archiveCapture.save(name, toolCallId);
    } else {
      archiveCapture?.cancel();
    }

    let stopReason: StopReason;
    const notes: string[] = [];
    if (truncated) {
      if (archiveResult?.status === "saved") {
        const archivePath = modelVisiblePath(archiveResult.path);
        if (archiveResult.archiveTruncated) {
          const limitMiB = Math.ceil(TRUNCATED_TOOL_OUTPUT_FILE_LIMIT_BYTES / (1024 * 1024));
          notes.push(
            `[output archived (${limitMiB} MiB limit; head and tail kept): ${archivePath}]`,
          );
        } else {
          notes.push(`[output archived: ${archivePath}]`);
        }
      } else if (archiveResult?.status === "failed") {
        notes.push(`[output archive failed: ${archiveResult.code}]`);
      }
    }
    // The tool's self-reported end marker (e.g. exit code): appended outside the budget — as a
    // content delta it could be evicted from the tail window by trailing output, and the model
    // would misread a command that failed after printing lots of output as successful.
    if (selfNote) {
      notes.push(selfNote);
    }
    if (aborted) {
      stopReason = "aborted";
      notes.push(TOOL_ABORTED_NOTE);
    } else if (timedOut) {
      stopReason = "failed";
      notes.push(`[tool timeout: exceeded ${timeoutMs}ms]`);
    } else if (thrown != null) {
      stopReason = "failed";
      notes.push(`[tool error] ${thrown instanceof Error ? thrown.message : String(thrown)}`);
    } else {
      stopReason = selfReported ?? "completed";
    }
    // The tool's reply must never be empty: an empty tool_result leaves the model unable to
    // tell "silent success" apart from "call failed", and some Providers outright reject empty
    // content blocks.
    if (visible === "" && notes.length === 0) {
      notes.push(TOOL_EMPTY_NOTE);
    }
    const noteText = notes.join("\n");
    const fullOutput = noteText ? appendNote(visible, noteText) : visible;

    // Compensating content delta: everything in the visible content beyond the already-forwarded
    // head — the withheld flush, the marker plus the tail window, or a fallback full message (if
    // the tool is internally inconsistent, the full message wins — no further reconciliation).
    const compensation = visible.startsWith(streamed) ? visible.slice(streamed.length) : "";
    if (compensation) {
      yield partialToolCallOutput({
        eventType: "delta",
        output: compensation,
        toolCallId,
      });
    }
    if (noteText) {
      yield partialToolCallOutput({
        eventType: "delta",
        output: noteSuffix(visible, noteText),
        toolCallId,
      });
    }
    // Images are made up via streaming: images are not delta'd — a single delta carries them
    // all at once right before stop, and the full message carries them again — satisfying
    // "streamed concatenation == full message" the same way text does (truncation only applies
    // to text, never touches images).
    // Only carried on normal completion; interruption/timeout/error paths carry no images, to keep finalization simple.
    const images = stopReason === "completed" ? selfImages : undefined;
    if (images) {
      yield partialToolCallOutput({ eventType: "delta", toolCallId, images });
    }
    yield partialToolCallOutput({ eventType: "stop", toolCallId, stopReason });
    yield toolCallOutput({
      output: fullOutput,
      toolCallId,
      stopReason,
      ...(images ? { images } : {}),
    });
  }
}

/** Upfront failure (unknown tool/argument parse failure): delta(explanation) -> stop -> full failed output (start already emitted by the caller). */
function* emitFailure(toolCallId: string, message: string): Generator<OmniMessage> {
  yield partialToolCallOutput({ eventType: "delta", output: message, toolCallId });
  yield partialToolCallOutput({ eventType: "stop", toolCallId, stopReason: "failed" });
  yield toolCallOutput({ output: message, toolCallId, stopReason: "failed" });
}
