/**
 * BuiltinTool abstraction — lets Environment avoid special-casing any specific tool name.
 *
 * Each builtin tool carries its own: `name`, the `definition` handed to the LLM, and a streaming
 * `execute`. Environment dispatches purely by looking up `name`; an unknown tool collapses to an
 * explanatory `tool_call_output`, never throwing. Adding a new tool later (e.g. file read/write,
 * retrieval) only requires implementing this interface and registering it with the registry, with
 * no changes needed to Environment.
 */
import type { OmniMessage, StopReason } from "../../omnimessage/index.js";
import type { ApproveFn, ToolDefinitionConfig } from "../../interfaces.js";

/**
 * Tool execution context: runtime information needed to execute one tool call.
 * Docs: /docs/tools § "Execution contract".
 */
export interface ToolExecutionContext {
  /** Workspace absolute path; relative-path arguments should be resolved against it. */
  workspaceDir: string;
  /** The tool_call_id passed through unchanged, used to build streaming deltas and nested origin tags. */
  toolCallId: string;
  /** Abort signal; the tool should close out and return as soon as possible once it fires. */
  signal?: AbortSignal;
  /** The parent Agent's approval callback; run_subagent passes it through to the child Session so it inherits the parent's approval mode (unused by most tools). */
  approve?: ApproveFn;
}

/**
 * Tool execution result (the generator's return value); treated as `completed` if omitted.
 * Docs: /docs/tools § "Execution contract".
 */
export interface ToolResult {
  stopReason?: StopReason;
  /**
   * Terminal marker (e.g. `[exit code: 1]`): appended by Environment during its unified
   * close-out, **outside** the maxOutputLength truncation, and streamed to the frontend as an
   * extra chunk — so the failure marker isn't lost when long output gets truncated (it would be
   * cut off if produced as a content delta instead).
   */
  note?: string;
  /**
   * Images carried by the tool output (e.g. an image read by read_image): each entry is a
   * `data:<mime>;base64,...` data URL. Attached by Environment during close-out: a single
   * streaming delta carries it all at once before stop, plus the final complete
   * `tool_call_output` (only carried on normal completion; images are not chunked and don't
   * count toward text truncation).
   */
  images?: string[];
}

/**
 * Builtin tool interface. `execute` receives the already-parsed tool argument object and the
 * execution context, streaming out OmniMessage as an async generator. Contract (a relaxed
 * version — framing and close-out are handled uniformly by Environment):
 *
 * - **Own output**: yielding the **delta** of `partial_tool_call_output` is enough; `start`/`stop`
 *   are optional (Environment ignores the tool's start/stop and frames it itself), and there's
 *   **no need** to produce a complete `tool_call_output` either (the complete message,
 *   maxOutputLength forward truncation, and close-out are all derived by Environment from the
 *   deltas). If a tool does produce a complete `tool_call_output` anyway, Environment uses it as
 *   the basis for content and stop reason (tolerated for compatibility, not recommended).
 * - **Nested forwarding**: yielding any message **tagged with origin** is passed through by
 *   Environment unchanged (e.g. run_subagent forwarding all of a child session's messages).
 * - **Stop reason**: reported via the generator's return value (defaults to completed); a throw
 *   is collapsed by Environment into aborted/failed based on interruption/error, never
 *   propagating up as an exception.
 * Docs: /docs/interfaces § "The inner tool contract: BuiltinTool"; /docs/tools § "Execution contract".
 */
export interface BuiltinTool {
  /** Tool name (corresponds to the tool_call.name returned by the LLM). */
  name: string;
  /** Tool definition handed to the LLM (including description / parameters / permission / maxOutputLength). */
  definition: ToolDefinitionConfig;
  /** Executes one tool call: args is the already-parsed argument object, ctx is the runtime context. */
  execute(
    args: Record<string, unknown>,
    ctx: ToolExecutionContext,
  ): AsyncGenerator<OmniMessage, ToolResult | void>;
}
