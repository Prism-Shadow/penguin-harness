/**
 * Environment —— executes approved tool calls inside the Workspace.
 *
 * Environment has no knowledge of any specific tool: it only assembles the tool names supported
 * by ToolConfig into BuiltinTool instances (see `environment/tools/`), and dispatches execution
 * by looking up the tool name. Adding a new built-in tool only requires implementing BuiltinTool
 * and registering it — no changes to this file needed. Tool call **rendering** is not core's
 * concern; it's handled by the CLI / Web frontend.
 *
 * The **framing and finalization** of the tool stream is handled uniformly by Environment:
 * - Entering execution immediately emits `start`; the tool only needs to yield output deltas
 *   (its own start/stop are ignored);
 * - Output is truncated online **front-to-back** by maxOutputLength (head is kept, forwarding
 *   stops once exceeded); the truncation marker, the tool's self-reported end marker
 *   (`ToolResult.note`, e.g. exit code — appended outside the truncation, never lost even when
 *   long output is truncated), and timeout/interruption/error markers are all emitted as part
 *   of the stream — **the content produced by concatenating streamed chunks matches the full
 *   message exactly**;
 * - Nested session messages carrying an origin marker (e.g. forwarded from run_subagent) pass
 *   through unchanged, taking no part in this tool's output or finalization;
 * - Argument parsing failures, unknown tool names, tool throws, and other exceptions all
 *   collapse into an explanatory, complete `tool_call_output` — never throws — and **output is
 *   never empty under any circumstance**.
 * Docs: /docs/tools § "Execution contract".
 */
import { partialToolCallOutput, toolCallOutput } from "../omnimessage/index.js";
import type { OmniMessage, StopReason } from "../omnimessage/index.js";
import type {
  EnvironmentConfig,
  EnvironmentInterface,
  ToolConfig,
  ToolDefinition,
  ToolExecutionRequest,
  ToolPermission,
} from "../interfaces.js";
import type { BuiltinTool, ToolResult } from "./tools/types.js";
import { BUILTIN_TOOL_FACTORIES } from "./tools/registry.js";
import { CommandSessionManager } from "./tools/command/index.js";
import { SubagentSessionManager } from "./tools/subagent/index.js";

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

export class Environment implements EnvironmentInterface {
  private readonly workspaceDir: string;
  private readonly toolConfig: ToolConfig;
  /** Assembled built-in tools: tool name -> BuiltinTool. Only tools supported by the registry and present in config. */
  private readonly tools: Map<string, BuiltinTool>;
  /** Long-running command session registry: constructed within this Environment and shared between run_command / input_command. */
  private readonly commandSessions: CommandSessionManager;
  /** Background subagent session registry: constructed within this Environment and shared between run_subagent / input_subagent. */
  private readonly subagentSessions: SubagentSessionManager;

  constructor(config: EnvironmentConfig) {
    this.workspaceDir = config.workspaceDir;
    this.toolConfig = config.toolConfig;
    this.tools = new Map();
    // The background session registry is created alongside Environment (one per Session) and
    // injected into whichever tools need it; all sessions are finalized together on dispose.
    // The vault environment variables are injected into child processes by the command session
    // registry at spawn time.
    this.commandSessions = new CommandSessionManager(
      config.vault !== undefined ? { vault: config.vault } : {},
    );
    this.subagentSessions = new SubagentSessionManager();
    const services = {
      ...config.services,
      commandSessions: this.commandSessions,
      subagentSessions: this.subagentSessions,
    };
    // Assemble the tools supported by config into BuiltinTool instances; unrecognized tool
    // names are skipped (neither exposed to the LLM nor executable).
    for (const def of config.toolConfig.customTools) {
      const factory = BUILTIN_TOOL_FACTORIES[def.name];
      if (factory) this.tools.set(def.name, factory(def, services));
    }
  }

  /** Releases runtime resources held by Environment: finalizes all managed background sessions (command and subagent). Idempotent. */
  dispose(): void {
    this.commandSessions.dispose();
    this.subagentSessions.dispose();
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
   * MCP Server config flows into Environment via toolConfig; enumerating concrete MCP tools
   * is left to a later adapter layer.
   */
  async listTools(): Promise<ToolDefinition[]> {
    return this.toolConfig.customTools
      .filter((tool) => this.tools.has(tool.name))
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        ...(tool.parameters !== undefined ? { parameters: tool.parameters } : {}),
      }));
  }

  /** Looks up a tool's permission level (for the frontend's permission-mode decisions); returns undefined for an unknown tool. */
  toolPermission(name: string): ToolPermission | undefined {
    return this.toolConfig.customTools.find((t) => t.name === name)?.permission;
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

    const tool = this.tools.get(name);
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

    // Consume the tool stream: content deltas are forwarded after online front-truncation;
    // nested messages pass through; manual iteration to capture the generator's return value.
    let streamed = ""; // Content forwarded so far (<= maxOutputLength)
    let contentLen = 0; // Total length of content produced by the tool (including truncated/discarded parts)
    let toolOutput: string | null = null; // Fallback: content basis when the tool produces a full message itself
    let selfReported: StopReason | undefined; // Tool's self-reported stop reason (return value takes priority over the full message)
    let selfNote: string | null = null; // Tool's self-reported end marker (e.g. exit code), appended outside truncation
    let selfImages: string[] | undefined; // Tool's self-reported images (data URL), carried via a single streamed delta and the full message
    let thrown: unknown = null;
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
          // maxOutputLength <= 0 means truncation is disabled (same semantics as timeoutMs).
          const room =
            maxOutputLength > 0 ? maxOutputLength - streamed.length : Number.POSITIVE_INFINITY;
          if (room > 0) {
            const chunk = p.output.length > room ? p.output.slice(0, room) : p.output;
            streamed += chunk;
            // Rebuild the delta: tool_call_id is uniformly enforced by Environment, never trusting the tool's own value.
            yield partialToolCallOutput({
              eventType: "delta",
              output: chunk,
              toolCallId,
            });
          }
        } else if (p.type === "tool_call_output") {
          // Fallback: if the tool still produces a full message, use it as the basis for content and stop reason (not needed under the new contract).
          toolOutput = p.output ?? "";
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
    // path) or the already-forwarded delta; after front-truncating to the cap, the truncation
    // marker and interruption/timeout/error markers are appended in turn, all made up via
    // streamed deltas — streamed concatenation == the full message.
    const contentBase = toolOutput ?? streamed;
    const capped =
      maxOutputLength > 0 && contentBase.length > maxOutputLength
        ? contentBase.slice(0, maxOutputLength)
        : contentBase;
    const truncated = capped.length < contentBase.length || contentLen > streamed.length;

    const aborted =
      signal?.aborted === true ||
      (!timedOut &&
        (selfReported === "aborted" ||
          (thrown as { name?: string } | null)?.name === "AbortError"));
    let stopReason: StopReason;
    const notes: string[] = [];
    if (truncated) {
      notes.push(`[output truncated: exceeded ${maxOutputLength} chars]`);
    }
    // The tool's self-reported end marker (e.g. exit code): appended outside the truncation —
    // if treated as a content delta it would get cut off once long output hits the cap, and the
    // model would misread a command that failed after printing lots of output as successful.
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
    if (capped === "" && notes.length === 0) {
      notes.push(TOOL_EMPTY_NOTE);
    }
    const noteText = notes.join("\n");
    const fullOutput = noteText ? appendNote(capped, noteText) : capped;

    // Compensating content delta: if nothing was streamed, emit the whole thing at once; on the
    // fallback path, emit the portion of the full message beyond the already-streamed prefix
    // (if the tool is internally inconsistent, the full message wins — no further reconciliation).
    let compensation = "";
    if (streamed === "") compensation = capped;
    else if (toolOutput !== null && capped.startsWith(streamed)) {
      compensation = capped.slice(streamed.length);
    }
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
        output: noteSuffix(capped, noteText),
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
