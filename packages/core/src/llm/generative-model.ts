/**
 * GenerativeModel —— the SDK's LLM interface implementation.
 *
 * Responsibilities (protocol translation + streaming aggregation):
 *   1. Merge a group of OmniMessages that **share the same role** into a single AgentHub `UniMessage`;
 *   2. Issue the request via `AutoLLMClient.streamingResponseStateful` (stateful — AgentHub
 *      maintains history internally), translating streamed `UniEvent`s back into OmniMessages:
 *        - text/thinking/tool-call deltas → `partial_*` (before the first delta of each segment
 *          `yield` a `start`; after the segment ends `yield` a `stop`);
 *        - after a segment ends, append the full `model_msg` (thinking / text / tool_call);
 *        - a `token_usage` event_msg is produced **only on normal completion**
 *          (observability/Token).
 *   3. Interruption/error handling: `finishInterrupted` first closes any open
 *      streaming segments and backfills the complete message, then the output ends — never
 *      leaking a malformed structure. This interface **never retries internally** — retryable
 *      errors (network/timeout/429/5xx, see `isRetryableError`) end with `timeout`; AgentHub
 *      JSON parse errors end with `malformed`; both are handed to `context_engine` to reconnect
 *      within the same run. User interruption ends with `aborted`; non-retryable errors
 *      (auth/parameters) end with `failed`.
 *
 * `context_engine` only consumes OmniMessage; all Uni* protocol details are encapsulated here.
 * Docs: /docs/interfaces § "The built-in implementation: GenerativeModel".
 */
import { AutoLLMClient, ThinkingLevel } from "@prismshadow/agenthub";
import type {
  ContentItem,
  FinishReason,
  ToolSchema,
  UniConfig,
  UniEvent,
  UniMessage,
  UsageMetadata,
} from "@prismshadow/agenthub";

import {
  addTokenCounts,
  assistantText,
  emptyTokenCounts,
  partialText,
  partialThinking,
  partialToolCall,
  thinkingMessage,
  tokenUsage,
  toolCall,
} from "../omnimessage/index.js";
import type {
  CompleteModelPayload,
  OmniMessage,
  StopReason,
  TokenCounts,
} from "../omnimessage/index.js";
import type {
  GenerativeModelConfig,
  GenerativeModelParameters,
  LLMInterface,
  LLMOutcome,
  ThinkingLevelName,
  ToolDefinition,
} from "../interfaces.js";
import { ToolCallIdAllocator, stripToolCallIdSuffix } from "./tool-call-ids.js";

// ---------------------------------------------------------------------------
// Pure conversion function: OmniMessage[] → a single UniMessage (unit-testable, no network)
// ---------------------------------------------------------------------------

/**
 * Tool arguments JSON string → object. History only ever contains tool_calls from committed
 * turns (non-completed turns are discarded on replay); bad JSON already throws during AgentHub
 * parsing and reconnects via malformed, so it never enters history — hence we parse directly
 * with no fallback tolerance; an empty string is treated as no arguments.
 */
function parseToolArguments(raw: string): Record<string, unknown> {
  if (!raw) return {};
  const parsed: unknown = JSON.parse(raw);
  return parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
}

/**
 * Maps a complete OmniMessage payload to an AgentHub `ContentItem`.
 * Only complete model_msg payloads are supported; `partial_*` is an output-only protocol.
 */
function payloadToContentItem(payload: CompleteModelPayload): ContentItem {
  // Provider-fidelity fields (signature / phase) are restored verbatim — some models require
  // them when history is replayed back (e.g. Claude thinking signatures, GPT-5 encrypted
  // reasoning and phase segmentation); losing them would break Session recovery.
  switch (payload.type) {
    case "text":
      return {
        type: "text",
        text: payload.text,
        ...(payload.phase != null ? { phase: payload.phase } : {}),
        ...(payload.signature !== undefined ? { signature: payload.signature } : {}),
      };
    case "image_url":
      return { type: "image_url", image_url: payload.image_url };
    case "inline_data":
      return {
        type: "inline_data",
        data: Buffer.from(payload.data, "base64"),
        mime_type: payload.mime_type,
        ...(payload.signature !== undefined ? { signature: payload.signature } : {}),
      };
    case "inline_thinking":
      return {
        type: "inline_thinking",
        data: Buffer.from(payload.data, "base64"),
        mime_type: payload.mime_type,
        ...(payload.signature !== undefined ? { signature: payload.signature } : {}),
      };
    case "thinking":
      return {
        type: "thinking",
        thinking: payload.thinking,
        ...(payload.signature !== undefined ? { signature: payload.signature } : {}),
      };
    case "tool_call":
      return {
        type: "tool_call",
        name: payload.name,
        // OmniMessage stores arguments as a JSON string; UniMessage uses an object.
        arguments: parseToolArguments(payload.arguments),
        // On the way back, strip the uniqueness suffix to restore the provider's original id (see tool-call-ids.ts).
        tool_call_id: stripToolCallIdSuffix(payload.tool_call_id),
        ...(payload.signature !== undefined ? { signature: payload.signature } : {}),
      };
    case "tool_call_output":
      return {
        type: "tool_result",
        text: payload.output,
        // Images carried by the tool output (data URL array) → AgentHub tool_result.images
        // (natively supported).
        ...(payload.images && payload.images.length > 0 ? { images: payload.images } : {}),
        // Gemini pairs by using tool_call_id as functionResponse.name, so it must be restored to the original id (the function name).
        tool_call_id: stripToolCallIdSuffix(payload.tool_call_id),
      };
    default: {
      // Exhaustiveness check: compile-time error when a new payload type is added.
      const _exhaustive: never = payload;
      throw new Error(
        `streamGenerate: unsupported message type: ${(_exhaustive as { type?: string }).type}`,
      );
    }
  }
}

/**
 * Groups a replayed, complete OmniMessage history into a sequence of UniMessages by
 * **adjacent same-role** runs (used for the setHistory injection during Session recovery).
 * One committed turn = a group of user-side input + a group of
 * assistant output, matching exactly the adjacent user / assistant UniMessages in AgentHub history.
 */
export function groupHistoryToUniMessages(history: OmniMessage[]): UniMessage[] {
  const groups: OmniMessage[][] = [];
  let currentRole: string | null = null;
  for (const msg of history) {
    const role = (msg.payload as { role?: string }).role;
    if (role !== "user" && role !== "assistant") {
      throw new Error(`setHistory: unsupported message without role: ${JSON.stringify(msg.type)}`);
    }
    if (role !== currentRole) {
      groups.push([]);
      currentRole = role;
    }
    groups[groups.length - 1]!.push(msg);
  }
  return groups.map(mergeOmniToUniMessage);
}

/**
 * Merges a group of OmniMessages into **a single** UniMessage.
 *
 * Constraint: all messages in the array must share the same
 * role; the role of the first payload is used as the UniMessage's role (a tool_call_output
 * group has role "user"). Throws if roles are mixed.
 */
export function mergeOmniToUniMessage(messages: OmniMessage[]): UniMessage {
  if (messages.length === 0) {
    throw new Error("streamGenerate requires at least one input message");
  }

  const payloads = messages.map((m) => m.payload as CompleteModelPayload);
  // Each payload carries its own role (tool_call_output is fixed to "user"); take the first one's role.
  const role = payloads[0]!.role;

  const contentItems: ContentItem[] = [];
  for (const payload of payloads) {
    if (payload.role !== role) {
      throw new Error(
        "streamGenerate does not accept mixed roles: all messages merged into one UniMessage must share the same role",
      );
    }
    contentItems.push(payloadToContentItem(payload));
  }

  return { role, content_items: contentItems };
}

// ---------------------------------------------------------------------------
// Token accounting (as defined by SKILL.md)
// ---------------------------------------------------------------------------

/**
 * Converts AgentHub `UsageMetadata` into PenguinHarness `TokenCounts`.
 *
 * Conversion rules (AgentHub UsageMetadata → OmniMessage TokenCounts, null treated as 0):
 *   - `cache_read  = cached_tokens` (input tokens served from cache hits);
 *   - `cache_write = prompt_tokens` (input tokens on a cache miss);
 *   - `output     = thoughts_tokens + response_tokens`;
 *   - `total      = cache_read + cache_write + output`.
 * That is, `input = cache_read + cache_write = cached_tokens + prompt_tokens`,
 * and `total = input + output` (consistent with SKILL.md's input/output accounting).
 */
export function usageToTokenCounts(usage: UsageMetadata): TokenCounts {
  const cached = usage.cached_tokens ?? 0;
  const prompt = usage.prompt_tokens ?? 0;
  const thoughts = usage.thoughts_tokens ?? 0;
  const response = usage.response_tokens ?? 0;
  const cacheRead = cached;
  const cacheWrite = prompt;
  const output = thoughts + response;
  return {
    cache_read: cacheRead,
    cache_write: cacheWrite,
    output,
    total: cacheRead + cacheWrite + output,
  };
}

// ---------------------------------------------------------------------------
// Pure translator: UniEvent[] → OmniMessage[] (unit-testable, no network)
// ---------------------------------------------------------------------------

interface ToolCallAccumulator {
  name: string;
  /** Accumulated arguments delta fragments (JSON string); used as a fallback when no complete tool_call arrives. */
  argsBuffer: string;
  /** If a complete tool_call appears in an event, its JSON.stringify'd arguments are recorded here. */
  completeArgs: string | null;
  /** Session-unique id emitted to OmniMessage (with a `#n` suffix on provider id collisions). */
  toolCallId: string;
  /** The original tool_call_id reported by the provider (the attribution key for inbound events). */
  providerKey: string;
  /** Provider-fidelity field: signature (kept verbatim, produced alongside the complete tool_call). */
  signature: string | undefined;
  /** Whether this tool_call's complete message has already been emitted eagerly in `pushEvent` (avoids duplicate emission in finish). */
  emitted: boolean;
}

/**
 * Streaming translator. Feed `UniEvent`s one at a time into `pushEvent`, which yields
 * incremental OmniMessages (`partial_*`); after the stream ends, call `finish` to produce
 * `stop`, the complete `model_msg`, and `token_usage`.
 *
 * Split into its own class to make unit testing easier (feed a constructed array of UniEvents,
 * assert on emission order / aggregation / token counts).
 * Docs: /docs/omni-message § "The streaming discipline".
 */
export class EventTranslator {
  /**
   * tool_call_id uniqueness registry. By default each translator creates its own (unit tests /
   * one-off translation); in production `GenerativeModel` injects a Session-level shared instance so
   * the uniqueness scope spans Requests and survives compaction rebuilds.
   */
  constructor(private readonly toolCallIds: ToolCallIdAllocator = new ToolCallIdAllocator()) {}

  // Whether each segment type has already yielded its `start`.
  private textStarted = false;
  private thinkingStarted = false;
  // Tool-call partial starts, tracked by the (uniqueness-resolved) tool_call_id.
  private toolStarted = new Set<string>();
  // Some providers' tool argument deltas don't carry a tool_call_id; attribute them to the most recently opened tool call (by provider id key).
  private activeToolCallId: string | null = null;

  // Buffers needed for the complete message.
  private textBuffer = "";
  private thinkingBuffer = "";
  // Provider-fidelity fields: the thinking block's signature (a signature
  // marks the end of a block) and the current text segment's phase (sticky across segments;
  // a differing phase marker starts a new segment) and signature.
  private thinkingSignature: string | undefined;
  private textPhase: string | null = null;
  private textSignature: string | undefined;
  /** Provider id keys saved in order of appearance, so complete tool_calls are emitted in a stable order. */
  private toolOrder: string[] = [];
  /** provider's original tool_call_id → the accumulator for the **latest** call under that id. */
  private tools = new Map<string, ToolCallAccumulator>();

  private finishReason: FinishReason | null = null;
  /** Token usage for this request (a snapshot from the most recent usage report). */
  private requestTokens: TokenCounts = emptyTokenCounts();

  /** Consumes one UniEvent, yielding 0..n streaming OmniMessages. */
  *pushEvent(event: UniEvent): Generator<OmniMessage> {
    if (event.finish_reason != null) {
      this.finishReason = event.finish_reason;
    }
    if (event.usage_metadata) {
      // The same request may report usage multiple times, always as a **cumulative snapshot**
      // (Gemini reports one per chunk, as do some OpenAI-compatible endpoints; Claude/GPT-5,
      // aggregated by AgentHub, report only once at the end). Overwrite with the latest snapshot
      // — never accumulate: summing snapshots chunk by chunk would inflate usage by roughly the
      // number of chunks.
      this.requestTokens = this.usageOnce(event.usage_metadata);
    }

    for (const item of event.content_items) {
      switch (item.type) {
        case "text": {
          // Provider fidelity: a phase marker can arrive as an increment with **empty text**
          // (e.g. GPT-5's segment markers). A phase differing from the current segment's phase
          // starts a new segment — providers split by phase when replaying history, so mixing
          // segments would break fidelity. Phase is sticky across segments (a subsequent segment
          // with the same phase isn't re-marked).
          if (item.phase != null && item.phase !== this.textPhase) {
            yield* this.flushThinking("completed");
            yield* this.flushText("completed");
            this.textPhase = item.phase;
          }
          if (item.signature) this.textSignature = item.signature;
          if (!item.text) break;
          // Type boundary: before a text segment starts, flush any unclosed thinking
          // segment, so the complete-message order matches generation order (thinking → text).
          // The boundary flush uses completed: that thinking segment's stop reason is "switched
          // to text", not "Request ended".
          yield* this.flushThinking("completed");
          if (!this.textStarted) {
            this.textStarted = true;
            yield partialText("start");
          }
          this.textBuffer += item.text;
          yield partialText("delta", item.text);
          break;
        }
        case "thinking": {
          // Provider fidelity: a thinking block ends with a signature (Claude's signature_delta
          // is empty text + signature; redacted blocks carry sentinel text + signature; GPT-5
          // encrypted reasoning is empty text + signature). If thinking content/a new signature
          // arrives after a signature is already set, that's a new block — close the current
          // segment first, so each block's signature stays independently faithful and blocks
          // don't bleed into each other when history is replayed.
          if (this.thinkingSignature !== undefined && (item.thinking || item.signature)) {
            yield* this.flushThinking("completed");
          }
          if (item.signature) this.thinkingSignature = item.signature;
          if (!item.thinking) break;
          // Type boundary: before a thinking segment starts, flush any unclosed text
          // segment, so the complete-message order matches generation order (text → thinking).
          // The boundary flush uses completed: that text segment's stop reason is "switched to
          // thinking", not "Request ended".
          yield* this.flushText("completed");
          if (!this.thinkingStarted) {
            this.thinkingStarted = true;
            yield partialThinking("start");
          }
          this.thinkingBuffer += item.thinking;
          yield partialThinking("delta", item.thinking);
          break;
        }
        case "partial_tool_call": {
          // Some providers' argument deltas don't carry a tool_call_id; attribute them to the most
          // recently opened tool call. If there's no open tool call yet, skip — don't fabricate a
          // tool_call with an empty id.
          const providerKey = item.tool_call_id || this.activeToolCallId;
          if (!providerKey) break;
          if (item.tool_call_id) this.activeToolCallId = item.tool_call_id;
          const acc = this.ensureTool(providerKey, item.name);
          if (item.name) acc.name = item.name;
          if (item.signature) acc.signature = item.signature;
          // Externally always use the uniqueness-resolved id (with a `#n` suffix on provider id collisions), matching the complete tool_call.
          if (!this.toolStarted.has(acc.toolCallId)) {
            // Type boundary: before a new tool_call starts, flush any unclosed thinking/text
            // segment. Only triggered on the tool's first delta (!toolStarted.has); continuation
            // deltas (including id-less increments attributed via activeToolCallId) don't re-trigger the flush.
            yield* this.flushThinking("completed");
            yield* this.flushText("completed");
            this.toolStarted.add(acc.toolCallId);
            yield partialToolCall({
              eventType: "start",
              name: acc.name,
              toolCallId: acc.toolCallId,
            });
          }
          // Only emit a delta when there's an arguments increment (an empty increment carries
          // no information, consistent with how empty text/thinking increments are handled).
          // The delta doesn't repeat the name — leave it blank; tool identity is established by
          // the start segment and tool_call_id.
          if (item.arguments) {
            acc.argsBuffer += item.arguments;
            yield partialToolCall({
              eventType: "delta",
              name: "",
              arguments: item.arguments,
              toolCallId: acc.toolCallId,
            });
          }
          break;
        }
        case "tool_call": {
          // Complete tool-call content item: record the authoritative name/arguments and
          // **eagerly emit** the tool's partial(stop) and complete tool_call. This lets the
          // engine start approval/execution as soon as the first tool arrives, without waiting
          // for the whole turn to finish — key for async/incremental tool calls (see comment
          // #24). An empty id is invalid; skip it.
          if (!item.tool_call_id) break;
          // The model may think/output text before calling a tool: flush any buffered
          // thinking/text complete messages before emitting the complete tool_call, so the
          // complete-message order is thinking → text → tool_call. finish_reason isn't known
          // yet here; the boundary flush uses completed, with the stop reason attributed to
          // the tool_call itself.
          yield* this.flushThinking("completed");
          yield* this.flushText("completed");
          // The same provider id already emitted a complete call and now another complete tool_call
          // arrives: not a duplicate delivery but **another** call from a name-as-id provider (e.g.
          // Gemini using the function name as id) — start a fresh accumulator, allocate a new unique id,
          // and emit as usual; never drop it (otherwise parallel same-name calls in one turn would lack
          // tool execution and paired output).
          let acc = this.tools.get(item.tool_call_id);
          if (!acc || acc.emitted) acc = this.createTool(item.tool_call_id, item.name);
          acc.name = item.name;
          acc.completeArgs = JSON.stringify(item.arguments ?? {});
          if (item.signature) acc.signature = item.signature;
          yield* this.emitCompleteTool(acc);
          break;
        }
        // Other content items (image_url / inline_data / inline_thinking /
        // tool_result / embedding) are not treated as model streaming output.
        default:
          break;
      }
    }
  }

  /**
   * Stream-end finalization: first `yield` the `stop` and complete message for the text/thinking
   * segments, then backfill partial(stop) + complete tool_call for tool_calls that **haven't
   * been emitted eagerly yet** (i.e. the fallback case — no complete tool_call content item was
   * received, only deltas). Tools already emitted eagerly in `pushEvent` are not repeated here.
   */
  *finish(): Generator<OmniMessage> {
    const stopReason = this.omniStopReason();

    // 1. Close out the **last** unflushed thinking / text segment (earlier segments were already
    //    flushed at their respective type boundaries or before the first tool_call).
    //    Since boundaries already flush, at most one buffer is non-empty here, so call
    //    order doesn't matter — the other call is a no-op; the final finish_reason is used as
    //    the stop_reason here.
    yield* this.flushThinking(stopReason);
    yield* this.flushText(stopReason);

    // 2. Fallback path: for tools that never received a complete tool_call content item,
    //    backfill using the accumulated deltas.
    for (const id of this.toolOrder) {
      if (!id) continue; // Defensive: an invalid tool call with an empty id (its result can't be routed).
      const acc = this.tools.get(id)!;
      if (acc.emitted) continue; // Already emitted eagerly in pushEvent; don't repeat.
      yield* this.emitCompleteTool(acc);
    }
  }

  /**
   * Interruption finalization: even when interrupted or on error, close the structure
   * as `start → delta → stop → complete message`. Closes any unclosed thinking/text segments and
   * backfills their complete messages, then backfills partial(stop) + complete tool_call for
   * tool_calls that only have deltas and were never emitted eagerly. All backfilled messages are
   * uniformly tagged with the interruption `stopReason` (`aborted` / `timeout` / `failed`), to
   * distinguish them from normal completion (`completed`).
   *
   * Differs from `finish`: doesn't read `finish_reason`, and doesn't produce `token_usage` (an
   * interrupted Request has no usage to report); backfilled incomplete tool_calls carry the
   * interruption stop_reason, so `context_engine` won't dispatch them for execution.
   */
  *finishInterrupted(stopReason: StopReason): Generator<OmniMessage> {
    yield* this.flushThinking(stopReason);
    yield* this.flushText(stopReason);
    for (const id of this.toolOrder) {
      if (!id) continue;
      const acc = this.tools.get(id)!;
      if (acc.emitted) continue; // A tool_call already emitted eagerly keeps its `tool_call` semantics and is left unchanged.
      yield* this.emitCompleteTool(acc, stopReason);
    }
  }

  /**
   * Eagerly emits the finalization of a tool_call: partial(stop) (without name) + complete
   * tool_call. Marks `emitted` to prevent duplicate emission in finish. `stopReason` defaults to
   * `completed` (a normal request); when called during interruption finalization
   * (`finishInterrupted`), the interruption reason is passed in, letting `context_engine`
   * distinguish "a real tool request" from "an incomplete tool_call backfilled to close the
   * structure on interruption" by stop_reason, and dispatch only the former.
   */
  private *emitCompleteTool(
    acc: ToolCallAccumulator,
    stopReason: StopReason = "completed",
  ): Generator<OmniMessage> {
    acc.emitted = true;
    if (this.toolStarted.has(acc.toolCallId)) {
      // stop doesn't carry name (tool identity is established by start and tool_call_id).
      yield partialToolCall({
        eventType: "stop",
        name: "",
        toolCallId: acc.toolCallId,
        stopReason,
      });
    }
    yield toolCall({
      name: acc.name,
      arguments: acc.completeArgs ?? acc.argsBuffer,
      toolCallId: acc.toolCallId,
      stopReason,
      ...(acc.signature !== undefined ? { signature: acc.signature } : {}),
    });
    // activeToolCallId holds the provider id key (used to attribute id-less deltas); reset it by providerKey.
    if (this.activeToolCallId === acc.providerKey) {
      this.activeToolCallId = null;
    }
  }

  /**
   * Closes out the currently buffered thinking segment and appends the complete thinking
   * message, then clears the buffer and resets the start flag. May be called before eagerly
   * emitting the first complete tool_call (`pushEvent`) or at stream end (`finish`), which
   * guarantees the complete-message order is thinking → text → tool_call.
   *
   * "Flush then reset" rather than a one-shot guard: once the buffer is cleared, a repeated call
   * is a no-op (each segment is emitted exactly once); if the model outputs new thinking after a
   * tool_call (interleaved/multi-segment models), that new segment accumulates again and gets
   * correctly flushed at the next tool_call or `finish`, without being lost.
   *
   * The complete thinking message passes through the given stop_reason just like partial(stop)
   * (aligned with flushText — streamed concatenation == complete message): at type boundaries the
   * caller passes completed (the stop reason belongs to the following tool_call/text);
   * finish/finishInterrupted follow the actual end reason.
   */
  private *flushThinking(stopReason: StopReason): Generator<OmniMessage> {
    if (this.thinkingStarted) {
      yield partialThinking("stop", "", stopReason);
      this.thinkingStarted = false;
    }
    // A thinking block with empty text but a signature (GPT-5 encrypted reasoning) still
    // produces a complete message — the signature is required when replaying history.
    if (this.thinkingBuffer || this.thinkingSignature !== undefined) {
      yield thinkingMessage(this.thinkingBuffer, stopReason, {
        ...(this.thinkingSignature !== undefined ? { signature: this.thinkingSignature } : {}),
      });
      this.thinkingBuffer = "";
      this.thinkingSignature = undefined;
    }
  }

  /**
   * Closes out the currently buffered text segment and appends the complete text message, then
   * clears the buffer and resets the start flag. Uses the same "flush then reset" approach as
   * `flushThinking` to support new text segments after a tool_call. When emitted before the
   * first complete tool_call, finish_reason is unknown and the caller passes completed; when
   * emitted in `finish`, the final `omniStopReason()` is passed (consistent with prior behavior).
   */
  private *flushText(stopReason: StopReason): Generator<OmniMessage> {
    if (this.textStarted) {
      yield partialText("stop", "", stopReason);
      this.textStarted = false;
    }
    // A text segment with empty text but a signature (e.g. Gemini carrying a thoughtSignature on
    // a text part) still produces a complete message — aligned with flushThinking, so the
    // signature isn't lost or leaked into a later segment just because the buffer is empty.
    if (this.textBuffer || this.textSignature !== undefined) {
      yield assistantText(this.textBuffer, stopReason, {
        ...(this.textPhase != null ? { phase: this.textPhase } : {}),
        ...(this.textSignature !== undefined ? { signature: this.textSignature } : {}),
      });
      this.textBuffer = "";
      this.textSignature = undefined;
      // textPhase is sticky across segments: a later segment with the same phase isn't
      // re-marked; it's updated when a different phase marker appears.
    }
  }

  /** Whether finish_reason (the terminal event) has been received: signals a fully delivered response (see the defensive branch in streamGenerate). */
  sawFinishReason(): boolean {
    return this.finishReason !== null;
  }

  /** Token usage for this request (read after finish). */
  getRequestTokens(): TokenCounts {
    return this.requestTokens;
  }

  private ensureTool(providerKey: string, name: string): ToolCallAccumulator {
    return this.tools.get(providerKey) ?? this.createTool(providerKey, name);
  }

  /**
   * Create an accumulator for a new call: the emitted id is made unique via the Session-level registry
   * (kept as-is when the provider id is free, with a `#n` suffix on collision). Creating again under the
   * same provider id (another call with a duplicate id) replaces the old Map entry — the old call has
   * finished emitting, so later inbound events are attributed to the latest call.
   */
  private createTool(providerKey: string, name: string): ToolCallAccumulator {
    const acc: ToolCallAccumulator = {
      name: name ?? "",
      argsBuffer: "",
      completeArgs: null,
      toolCallId: this.toolCallIds.allocate(providerKey),
      providerKey,
      signature: undefined,
      emitted: false,
    };
    this.tools.set(providerKey, acc);
    this.toolOrder.push(providerKey);
    return acc;
  }

  private usageOnce(usage: UsageMetadata): TokenCounts {
    return usageToTokenCounts(usage);
  }

  /**
   * Converts an AgentHub finish_reason into an OmniMessage stop_reason (the five-value protocol).
   * "stop", "tool_call", and null are treated as completed; length or unknown reasons map to failed.
   */
  private omniStopReason(): StopReason {
    if (
      this.finishReason == null ||
      this.finishReason === "stop" ||
      this.finishReason === "tool_call"
    ) {
      return "completed";
    }
    return "failed";
  }
}

/**
 * One-shot translation: folds a batch of UniEvents into an OmniMessage sequence (including
 * complete messages and token_usage). A pure function for easy unit testing; the live streaming
 * path is wired up by `GenerativeModel.streamGenerate`.
 *
 * @param events The event sequence
 * @param sessionTokensBefore The session's cumulative tokens before this translation (used to produce token_usage.session)
 * @returns `{ messages, requestTokens, sessionTokens }`
 */
export function translateEvents(
  events: UniEvent[],
  sessionTokensBefore: TokenCounts = emptyTokenCounts(),
): {
  messages: OmniMessage[];
  requestTokens: TokenCounts;
  sessionTokens: TokenCounts;
} {
  const translator = new EventTranslator();
  const out: OmniMessage[] = [];
  for (const event of events) {
    for (const msg of translator.pushEvent(event)) out.push(msg);
  }
  for (const msg of translator.finish()) out.push(msg);

  const requestTokens = translator.getRequestTokens();
  const sessionTokens = addTokenCounts(sessionTokensBefore, requestTokens);
  out.push(tokenUsage(sessionTokens, requestTokens));

  return { messages: out, requestTokens, sessionTokens };
}

// ---------------------------------------------------------------------------
// Retry policy
// ---------------------------------------------------------------------------

/**
 * Determines whether an error is an AgentHub / Provider response JSON parse error.
 *
 * AgentHub uses `JSON.parse` internally to parse response bodies, and a parse failure throws a
 * `SyntaxError`; hence we judge directly by exception type (the `name` check also covers
 * cross-realm or deserialization-reconstructed errors, and we probe down the `cause` chain for
 * wrapped errors). This is not an auth/parameter failure but an incomplete LLM Request, and
 * should end with `malformed` and be handed to the engine to retry.
 */
export function isMalformedJsonParseError(error: unknown): boolean {
  if (error == null) return false;
  if (error instanceof SyntaxError) return true;
  const err = error as { name?: string; cause?: unknown };
  if (err.name === "SyntaxError") return true;
  if (err.cause && err.cause !== error) {
    return isMalformedJsonParseError(err.cause);
  }
  return false;
}

/**
 * Determines whether an error is AgentHub's "incomplete stream" validation error: when a
 * server/proxy terminates the stream early **cleanly** at an event boundary (no network error
 * thrown), AgentHub's `_validateLastEvent` reports the missing or incomplete final event as a
 * plain `Error` ("Streaming response yielded no events" / "Last event must carry
 * usage_metadata|finish_reason"). This is not an auth/parameter failure but an incomplete LLM
 * Request, and should end with `malformed` and be handed to the engine to reconnect and retry.
 * AgentHub doesn't provide an error type for this, so we match by message prefix
 * (@prismshadow/agenthub 0.3.x), probing down the `cause` chain.
 */
export function isIncompleteStreamError(error: unknown): boolean {
  if (error == null) return false;
  const err = error as { message?: string; cause?: unknown };
  const msg = err.message ?? "";
  if (
    msg.startsWith("Streaming response yielded no events") ||
    msg.startsWith("Last event must carry")
  ) {
    return true;
  }
  if (err.cause && err.cause !== error) {
    return isIncompleteStreamError(err.cause);
  }
  return false;
}

/**
 * Determines whether an error is retryable.
 *
 * Retryable: network errors, timeouts, connection reset, HTTP 429 / 5xx.
 * Not retryable: HTTP 4xx auth/parameter errors (401/403/400/404, etc.).
 * JSON parse errors are classified separately as `malformed` by `isMalformedJsonParseError`.
 *
 * Since AgentHub doesn't guarantee the shape of error objects, this uses a lenient check: first
 * the status code, then error codes / message keywords. When undeterminable, treat it as
 * **non-retryable** to avoid pointless retries.
 */
export function isRetryableError(error: unknown): boolean {
  if (error == null) return false;

  const err = error as {
    status?: number;
    statusCode?: number;
    code?: string;
    name?: string;
    message?: string;
  };

  // 1. HTTP status code takes priority.
  const status = err.status ?? err.statusCode;
  if (typeof status === "number") {
    if (status === 429 || status === 408) return true; // Rate limited / request timeout (transient)
    if (status >= 500 && status <= 599) return true; // Server error
    if (status >= 400 && status <= 499) return false; // Other 4xx auth/parameter errors, not retryable
  }

  // 2. Network-layer error codes.
  const retryableCodes = new Set([
    "ECONNRESET",
    "ECONNREFUSED",
    "ETIMEDOUT",
    "EPIPE",
    "EAI_AGAIN",
    "ENOTFOUND",
    "ECONNABORTED",
  ]);
  if (err.code && retryableCodes.has(err.code)) return true;

  // 3. Error name / message keywords (timeout, network, rate limit).
  if (err.name === "AbortError") return false; // User interruption, not retryable
  const text = `${err.name ?? ""} ${err.message ?? ""}`.toLowerCase();
  if (
    /timeout|timed out|network|socket hang up|econnreset|connection reset|too many requests|rate limit|temporarily unavailable|503|502|504/.test(
      text,
    )
  ) {
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// GenerativeModel
// ---------------------------------------------------------------------------

/**
 * A stateful LLM object attached to a Session. AgentHub's `streamingResponseStateful` maintains
 * conversation history internally; this class is only responsible for protocol translation,
 * streaming aggregation, and token accumulation. **It never retries internally** — retries are
 * handled by `context_engine`.
 */
export class GenerativeModel implements LLMInterface {
  private readonly client: AutoLLMClient;
  private readonly uniConfig: UniConfig;
  /** Streaming idle timeout (milliseconds); <= 0 disables it. A timeout is treated as needing reconnection. */
  private readonly requestTimeoutMs: number;
  /**
   * tool_call_id uniqueness registry (see tool-call-ids.ts): when a name-as-id provider (e.g. Gemini)
   * calls the same tool repeatedly, it assigns a `#n` suffix to later calls so engine pairing and the
   * frontend tool cards don't collide on id. Injected via config so it can be shared across the new
   * instance rebuilt on compaction; defaults to a fresh one.
   */
  private readonly toolCallIds: ToolCallIdAllocator;

  /** Cumulative session tokens. */
  sessionTokens: TokenCounts = emptyTokenCounts();

  constructor(config: GenerativeModelConfig) {
    // Omit apiKey / baseUrl when undefined, letting AgentHub read them from environment
    // variables. clientType determines which protocol to speak (`openai` means OpenAI Chat
    // Completions compatible); when omitted, AgentHub infers it from model_id, so it only needs
    // to be specified explicitly for custom-named models.
    this.client = new AutoLLMClient({
      model: config.modelId,
      ...(config.apiKey !== undefined ? { apiKey: config.apiKey } : {}),
      ...(config.baseUrl !== undefined ? { baseUrl: config.baseUrl } : {}),
      ...(config.clientType !== undefined ? { clientType: config.clientType } : {}),
    });

    this.uniConfig = buildUniConfig(config);
    this.requestTimeoutMs = config.requestTimeoutMs ?? 120000;
    this.toolCallIds = config.toolCallIds ?? new ToolCallIdAllocator();
  }

  /**
   * Streaming generation (a single attempt, no internal retry). Merges
   * `params.newMessages` into one UniMessage to issue a stateful request, translating streamed
   * UniEvents into OmniMessages.
   *
   * **Never throws to `context_engine`**: whether it ends normally or is interrupted/errors out,
   * every `partial_*` segment is closed as `start → delta → stop → complete message`,
   * and the terminal state is then returned as `LLMOutcome`:
   *   - **Normal completion**: `finish()` closes out and produces `token_usage` (usage is only
   *     produced in this case) → `completed`;
   *   - **Idle timeout / network drop** (retryable errors like network/429/5xx):
   *     `finishInterrupted("timeout")` closes out, produces no usage → `timeout`, reconnected by
   *     `context_engine` within the same run;
   *   - **AgentHub JSON parse error**: `finishInterrupted("malformed")` closes out, produces no
   *     usage → `malformed`, likewise reconnected by `context_engine` within the same run;
   *   - **User interruption**: `finishInterrupted("aborted")` closes out, produces no usage →
   *     `aborted`;
   *   - **Other non-retryable errors** (auth/parameters etc.): `finishInterrupted("failed")`
   *     closes out, produces no usage → `failed` (carrying `message`), handed to
   *     `context_engine` to stop and return control to the user.
   *
   * Timeout detection: the idle timer resets on every event received; once idle exceeds
   * `requestTimeoutMs`, the underlying stream is aborted and handled as needing reconnection
   * (merged with user interruption into a single internal AbortController).
   */
  async *streamGenerate(
    params: GenerativeModelParameters,
  ): AsyncGenerator<OmniMessage, LLMOutcome> {
    const userSignal = params.signal;

    // Already interrupted before issuing: no streaming segment has been opened, so nothing to close out.
    if (userSignal?.aborted) return { status: "aborted" };

    // Input merging is placed inside a guarded block: build failures such as empty input /
    // mixed roles / argument JSON also collapse to a failed outcome, never throwing to
    // context_engine.
    let uniMessage: UniMessage;
    try {
      uniMessage = mergeOmniToUniMessage(params.newMessages);
    } catch (err) {
      return {
        status: "failed",
        message: err instanceof Error ? err.message : String(err),
      };
    }

    const translator = new EventTranslator(this.toolCallIds);

    // Merges "user interruption" and "idle timeout" into a single internal AbortController: either triggering aborts the underlying stream.
    const ac = new AbortController();
    const onUserAbort = (): void => ac.abort();
    userSignal?.addEventListener("abort", onUserAbort, { once: true });

    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const clearTimer = (): void => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };
    const armTimer = (): void => {
      if (this.requestTimeoutMs <= 0) return; // Timeout disabled
      clearTimer();
      timer = setTimeout(() => {
        timedOut = true;
        ac.abort();
      }, this.requestTimeoutMs);
    };

    // Terminal-state classification: timeout (timed out/network drop) / malformed (response
    // parse error) / aborted (user) / failed (other). null means it ended normally.
    let outcome: LLMOutcome | null = null;
    try {
      const it = this.openStream(uniMessage, ac.signal)[Symbol.asyncIterator]();
      for (;;) {
        // The interruption check must happen **before pulling from upstream**: the user may
        // interrupt while this generator is suspended at the `yield` below (the typical case —
        // the engine is blocked on `await approve(tc)` waiting for human approval). By then,
        // onUserAbort has already called `ac.abort()`, cutting off the upstream stream; when the
        // consumer pulls again and we come back here to call `it.next()` on an **already-aborted
        // stream**, that promise will never settle. The idle timer can't save us either: once it
        // fires, it just calls `ac.abort()` again (already aborted, a no-op), and the pending
        // `it.next()` still hangs forever. The consequence is that `run` never closes out and the
        // Session stays stuck running forever — after interruption, it can neither send messages
        // nor compact.
        if (userSignal?.aborted) {
          outcome = { status: "aborted" };
          break;
        }
        // Timing runs **only while waiting on an upstream event** (excluding consumer/yield
        // time), measuring upstream idleness — this avoids a slow consumer (e.g. a slow Trace
        // sink) falsely triggering the timeout.
        armTimer();
        let res: IteratorResult<UniEvent>;
        try {
          res = await it.next();
        } finally {
          clearTimer();
        }
        if (res.done) break;
        if (userSignal?.aborted) {
          outcome = { status: "aborted" };
          break;
        }
        for (const msg of translator.pushEvent(res.value)) yield msg;
      }
    } catch (error) {
      // User interruption **takes priority**: even if the idle timer fires at the same time,
      // it's classified as aborted (user intent outweighs a coincidental timeout).
      if (userSignal?.aborted) {
        outcome = { status: "aborted" };
      } else if (timedOut) {
        outcome = { status: "timeout" }; // Idle timeout -> needs reconnection
      } else if (isMalformedJsonParseError(error) || isIncompleteStreamError(error)) {
        // A response JSON parse error, or a cleanly truncated stream (AgentHub's final-event
        // validation failed): both are an incomplete LLM Request, handed to the engine as
        // malformed to reconnect and retry — must not be classified as failed.
        outcome = {
          status: "malformed",
          message: error instanceof Error ? error.message : String(error),
        };
      } else if (isRetryableError(error)) {
        outcome = { status: "timeout" }; // Network drop/network error -> needs reconnection
      } else if ((error as { name?: string })?.name === "AbortError") {
        outcome = { status: "aborted" }; // Fallback: an unexpected abort (neither timeout nor user)
      } else {
        outcome = {
          status: "failed",
          message: error instanceof Error ? error.message : String(error),
        };
      }
    } finally {
      clearTimer();
      userSignal?.removeEventListener("abort", onUserAbort);
    }

    // Defensive: when the underlying stream responds to an abort with a **graceful end (done)**
    // rather than throwing, it must still be closed out as interrupted/timed out, and must not be
    // misjudged as completed (priority matches the catch classification: user interruption >
    // timeout). Exception: if finish_reason was already received before the stream ended (the
    // response was fully delivered and AgentHub has already committed this turn into stateful
    // history), close out as completed — if the interruption race lands exactly during the wait
    // on the final next() and gets misjudged as aborted, the already-committed tool_use turn
    // would be cleaned up by context_engine as "incomplete" flatten, losing the tool_result
    // pairing; subsequent requests would all be rejected by the provider as an unanswered
    // tool_use (400), and the engine has no fix-up path left that touches LLM history.
    if (!outcome && !translator.sawFinishReason()) {
      if (userSignal?.aborted) outcome = { status: "aborted" };
      else if (timedOut) outcome = { status: "timeout" };
    }

    if (outcome) {
      // Interrupted/errored: close any opened streaming segments and backfill the complete message, producing no token_usage.
      const reason: StopReason = outcome.status === "completed" ? "failed" : outcome.status;
      for (const msg of translator.finishInterrupted(reason)) yield msg;
      return outcome;
    }

    // Normal completion: backfill stop + the complete model_msg, and produce token_usage.
    for (const msg of translator.finish()) yield msg;
    const requestTokens = translator.getRequestTokens();
    this.sessionTokens = addTokenCounts(this.sessionTokens, requestTokens);
    yield tokenUsage(this.sessionTokens, requestTokens);
    return { status: "completed" };
  }

  /**
   * Injects the replayed history in one shot when resuming a Session: converts the complete
   * OmniMessage history, grouped by adjacent same role, into
   * AgentHub UniMessages and calls AgentHub's setHistory, so subsequent Requests continue from a
   * history exactly matching the original conversation. **Called only once, on a fresh context
   * object, during resumption**; not used during normal operation, where the incremental context
   * is maintained by AgentHub itself.
   * Docs: /docs/sessions-and-traces § "Session recovery".
   */
  setHistory(history: OmniMessage[]): void {
    if (history.length === 0) return;
    // Resume seeding: register tool_call_ids already used in history into the uniqueness registry. A
    // name-as-id provider (e.g. Gemini) only gets a new suffix when it calls the same tool again after
    // resume, so it won't collide with the history tool cards the frontend already rendered.
    for (const msg of history) {
      const p = msg.payload as { type?: string; tool_call_id?: string };
      if (p.type === "tool_call" && p.tool_call_id) {
        this.toolCallIds.markUsed(p.tool_call_id);
      }
    }
    this.client.setHistory(groupHistoryToUniMessages(history));
  }

  /**
   * Opens the underlying AgentHub stream (a testing seam): defaults to
   * `streamingResponseStateful`; unit tests can subclass and override this method, feeding in a
   * controlled UniEvent stream to verify the outcome classification for timeout/network
   * drop/interruption/error (without a real API).
   */
  protected openStream(uniMessage: UniMessage, signal: AbortSignal): AsyncIterable<UniEvent> {
    return this.client.streamingResponseStateful({
      message: uniMessage,
      config: this.uniConfig,
      signal,
    });
  }
}

// ---------------------------------------------------------------------------
// UniConfig pre-construction
// ---------------------------------------------------------------------------

/** Maps a ThinkingLevelName to the AgentHub ThinkingLevel enum; returns undefined if not found. */
export function mapThinkingLevel(name: ThinkingLevelName | undefined): ThinkingLevel | undefined {
  if (name === undefined) return undefined;
  const table: Record<ThinkingLevelName, ThinkingLevel> = {
    none: ThinkingLevel.NONE,
    low: ThinkingLevel.LOW,
    medium: ThinkingLevel.MEDIUM,
    high: ThinkingLevel.HIGH,
    xhigh: ThinkingLevel.XHIGH,
  };
  return table[name];
}

/** Maps ToolDefinition[] to AgentHub ToolSchema[]. */
export function toolDefinitionsToSchemas(tools: ToolDefinition[]): ToolSchema[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    ...(tool.parameters !== undefined ? { parameters: tool.parameters } : {}),
  }));
}

/** Pre-builds UniConfig from GenerativeModelConfig (called once at construction time). */
export function buildUniConfig(config: GenerativeModelConfig): UniConfig {
  const uniConfig: UniConfig = {
    tools: toolDefinitionsToSchemas(config.tools),
  };
  if (config.systemPrompt !== undefined) {
    uniConfig.system_prompt = config.systemPrompt;
  }
  if (config.maxTokens !== undefined) {
    uniConfig.max_tokens = config.maxTokens;
  }
  const thinking = mapThinkingLevel(config.thinkingLevel);
  if (thinking !== undefined) {
    uniConfig.thinking_level = thinking;
  }
  return uniConfig;
}
