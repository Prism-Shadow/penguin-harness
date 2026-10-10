/**
 * GenerativeModel —— the SDK's LLM interface implementation.
 *
 * Responsibilities (protocol translation):
 *   1. Merge a group of OmniMessages that **share the same role** into a single MMSP `UniMessage`;
 *   2. Issue the request via `AutoLLMClient.streamingResponseStateful` (stateful — MMSP
 *      maintains history internally), translating streamed `UniEvent`s back into OmniMessages.
 *      MMSP streams every item as `.delta` fragments closed by its `.done` item, one item at a
 *      time, and ends the stream with one `stop` event; the translation is one to one:
 *        - a text / thinking / tool-call `.delta` → `partial_*` (a `start` before the item's
 *          first fragment, a `stop` when it ends);
 *        - a `.done` item → the full `model_msg` (thinking / text / tool_call);
 *        - the `stop` event → a `token_usage` event_msg, produced **only on normal
 *          completion** (observability/Token).
 *   3. Interruption/error handling: `finishInterrupted` closes the item still streaming and
 *      backfills its complete message, then the output ends — never leaking a malformed
 *      structure. This interface **never retries internally** — it only classifies, and
 *      `context_engine` owns the retry policy: `retryable` rides the engine's reconnect
 *      ladder, `fatal` stops the run. The split is an allowlist of certainty: only failures a
 *      retry provably cannot fix are `fatal` — a provider 4xx rejection (408/429 excluded, see
 *      `isFatalProviderRejection`), a credentials failure (`isAuthenticationError`), MMSP's
 *      fast-mode UnsupportedParameterError (`isFastModeUnsupportedError`), and input that
 *      fails to assemble into a request at all. Everything else — network/transport drops,
 *      timeouts, 429/5xx, MMSP's stream errors and truncated streams, and every
 *      unclassifiable error — ends `retryable`, with the concrete failure on `errorMessage`.
 *      User interruption ends with `aborted`.
 *
 * `context_engine` only consumes OmniMessage; all Uni* protocol details are encapsulated here.
 * Docs: /docs/interfaces § "The built-in implementation: GenerativeModel".
 */
import { AutoLLMClient, ThinkingLevel, UnsupportedParameterError } from "@prismshadow/mmsp";
import type {
  ContentItem,
  TextDoneItem,
  ThinkingDoneItem,
  ToolCallDeltaItem,
  ToolCallDoneItem,
  ToolSchema,
  UniConfig,
  UniEvent,
  UniMessage,
  UsageMetadata,
} from "@prismshadow/mmsp";

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
  Fidelity,
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
} from "../interfaces/index.js";
import { attributionHeaders } from "../state/model-catalog.js";
import { ToolCallIdAllocator, stripToolCallIdSuffix } from "./tool-call-ids.js";
import {
  approximateMessagesTokens,
  approximateTokens,
  effectiveMaxOutputTokens,
  resolveContextWindow,
} from "./context-limits.js";

// ---------------------------------------------------------------------------
// Pure conversion function: OmniMessage[] → a single UniMessage (unit-testable, no network)
// ---------------------------------------------------------------------------

/**
 * Tool arguments JSON string → object. History only ever contains tool_calls from committed
 * turns (non-completed turns are discarded on replay); bad JSON already throws during MMSP
 * parsing and reconnects via malformed, so it never enters history — hence we parse directly
 * with no fallback tolerance; an empty string is treated as no arguments.
 */
function parseToolArguments(raw: string): Record<string, unknown> {
  if (!raw) return {};
  const parsed: unknown = JSON.parse(raw);
  return parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
}

/** Spread helper: attach `fidelity` only when it carries at least one key. */
function fidelityProp(fidelity?: Fidelity): { fidelity?: Fidelity } {
  return fidelity != null && Object.keys(fidelity).length > 0 ? { fidelity } : {};
}

/**
 * Maps a complete OmniMessage payload to an MMSP `ContentItem` — a message holds complete
 * items only, typed with the `.done` suffix. Only complete model_msg payloads are supported;
 * `partial_*` is an output-only protocol.
 */
function payloadToContentItem(payload: CompleteModelPayload): ContentItem {
  // The provider-fidelity payload is opaque and restored verbatim — some models require it
  // when history is replayed back (e.g. Claude thinking signatures, GPT-5 encrypted reasoning
  // and phase segmentation, the OpenAI-compatible reasoning field name); losing it would break
  // Session recovery.
  switch (payload.type) {
    case "text":
      return { type: "text.done", text: payload.text, ...fidelityProp(payload.fidelity) };
    case "image_url":
      return { type: "image_url.done", image_url: payload.image_url };
    case "inline_data":
      return {
        type: "inline_data.done",
        data: Buffer.from(payload.data, "base64"),
        mime_type: payload.mime_type,
        ...fidelityProp(payload.fidelity),
      };
    case "inline_thinking":
      return {
        type: "inline_thinking.done",
        data: Buffer.from(payload.data, "base64"),
        mime_type: payload.mime_type,
        ...fidelityProp(payload.fidelity),
      };
    case "thinking":
      return {
        type: "thinking.done",
        thinking: payload.thinking,
        ...fidelityProp(payload.fidelity),
      };
    case "tool_call":
      return {
        type: "tool_call.done",
        name: payload.name,
        // OmniMessage stores arguments as a JSON string; UniMessage uses an object.
        arguments: parseToolArguments(payload.arguments),
        // On the way back, strip the uniqueness suffix to restore the provider's original id (see tool-call-ids.ts).
        tool_call_id: stripToolCallIdSuffix(payload.tool_call_id),
        ...fidelityProp(payload.fidelity),
      };
    case "tool_call_output":
      return {
        type: "tool_result.done",
        text: payload.output,
        // Images carried by the tool output (data URL array) → MMSP tool_result.images
        // (natively supported).
        ...(payload.images && payload.images.length > 0 ? { images: payload.images } : {}),
        // A provider that pairs by function name (Gemini generateContent) needs the original id back.
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
 * assistant output, matching exactly the adjacent user / assistant UniMessages in MMSP history.
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
 * Converts MMSP `UsageMetadata` into PenguinHarness `TokenCounts`.
 *
 * Conversion rules (MMSP UsageMetadata → OmniMessage TokenCounts, null treated as 0):
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

/** The item streaming now, from its first visible fragment: MMSP streams one item at a time. */
interface OpenItem {
  kind: "text" | "thinking" | "tool_call";
  /** What its fragments carried so far — all an interrupted stream leaves of it. */
  content: string;
  /** A tool call's name and its Session-unique id (a `#n` suffix when the provider's id was already taken). */
  name: string;
  toolCallId: string;
}

/** A `partial_*` message of the open item (a tool call's name rides on its `start` alone). */
function partial(
  open: OpenItem,
  eventType: "start" | "delta" | "stop",
  content = "",
  stopReason: StopReason = "completed",
): OmniMessage {
  if (open.kind === "tool_call") {
    const name = eventType === "start" ? open.name : "";
    return partialToolCall({
      eventType,
      name,
      arguments: content,
      toolCallId: open.toolCallId,
      stopReason,
    });
  }
  return (open.kind === "text" ? partialText : partialThinking)(eventType, content, stopReason);
}

/**
 * Streaming translator. Feed `UniEvent`s one at a time into `pushEvent`, which yields the
 * OmniMessages they stand for. MMSP's grammar does the aggregation — an item streams as
 * `.delta` fragments closed by its `.done` item, items never interleave, and one `stop` event
 * ends the stream — so the mapping is one to one:
 *
 *   - a `.delta` becomes a `partial_*` delta, behind a `start` on the item's first fragment;
 *   - a `.done` becomes the partial `stop` and the complete `model_msg`, read off the done
 *     item alone (the streamed fragments are never reconciled against it);
 *   - the `stop` event carries the request's usage and finish reason.
 *
 * Docs: /docs/omni-message § "The streaming discipline".
 */
export class EventTranslator {
  /**
   * tool_call_id uniqueness registry. By default each translator creates its own (unit tests /
   * one-off translation); in production `GenerativeModel` injects a Session-level shared instance so
   * the uniqueness scope spans Requests and survives compaction rebuilds.
   */
  constructor(private readonly toolCallIds: ToolCallIdAllocator = new ToolCallIdAllocator()) {}

  private open: OpenItem | null = null;
  /**
   * A finished text or thinking item whose messages have not gone out yet: its stop reason is
   * `completed` unless it ends the stream — then it is the request's own — and only the next
   * event says which. A tool call never waits: the engine starts on it the moment it is complete.
   */
  private held: TextDoneItem | ThinkingDoneItem | null = null;
  private stopSeen = false;
  private requestTokens: TokenCounts = emptyTokenCounts();

  /** Consumes one UniEvent, yielding 0..n OmniMessages. */
  *pushEvent(event: UniEvent): Generator<OmniMessage> {
    if (event.event_type === "stop") {
      this.stopSeen = true;
      if (event.usage_metadata) this.requestTokens = usageToTokenCounts(event.usage_metadata);
      // "length" and "unknown" end the last item `fatal`: the request itself committed, so
      // nothing retries, but it ended in a way only a human can fix (raise the output cap),
      // which is what the abnormal terminal label tells the render layers.
      const normal = event.finish_reason === "stop" || event.finish_reason === "tool_call";
      yield* this.close(normal ? "completed" : "fatal");
      return;
    }
    for (const item of event.content_items) {
      // Another item arrived, so the one held back did not end the stream.
      if (this.held) yield* this.close("completed");
      switch (item.type) {
        case "text.delta":
          yield* this.fragment("text", item.text);
          break;
        case "thinking.delta":
          yield* this.fragment("thinking", item.thinking);
          break;
        case "tool_call.delta":
          yield* this.fragment("tool_call", item.arguments, item);
          break;
        case "text.done":
        case "thinking.done":
          this.held = item;
          break;
        case "tool_call.done":
          yield* this.close("completed", item);
          break;
        // Other items (inline data, inline thinking, embeddings) are not model streaming
        // output here.
        default:
          break;
      }
    }
  }

  /**
   * Interruption finalization: even when interrupted or on error, the structure closes as
   * `start → delta → stop → complete message`. The item still streaming gets its partial
   * `stop` and a complete message holding what had arrived, tagged with the interruption
   * `stopReason` (`aborted` / `retryable` / `fatal`) to tell it from a normal completion —
   * `context_engine` dispatches only tool calls that ended `completed`. Produces no
   * `token_usage`: an interrupted Request has no usage to report.
   */
  *finishInterrupted(stopReason: StopReason): Generator<OmniMessage> {
    yield* this.close(stopReason);
  }

  /** Whether the `stop` event arrived: a fully delivered, committed response. */
  get stopped(): boolean {
    return this.stopSeen;
  }

  /** Token usage for this request (the `stop` event's). */
  getRequestTokens(): TokenCounts {
    return this.requestTokens;
  }

  /**
   * One fragment of the item streaming now. The item opens on its first visible fragment — a
   * call's name (which only its first fragment carries), or any text — so one that carries
   * only fidelity (a signature, encrypted reasoning) shows nothing on screen.
   */
  private *fragment(
    kind: OpenItem["kind"],
    content: string,
    call?: ToolCallDeltaItem,
  ): Generator<OmniMessage> {
    if (!this.open) {
      if (kind === "tool_call" ? !call?.name : !content) return;
      const toolCallId = call ? this.toolCallIds.allocate(call.tool_call_id) : "";
      this.open = { kind, content: "", name: call?.name ?? "", toolCallId };
      yield partial(this.open, "start");
    }
    if (!content) return;
    this.open.content += content;
    yield partial(this.open, "delta", content);
  }

  /**
   * Ends the item in hand: its partial `stop`, then its complete message — the done item's
   * (`done`, else the one held back), or, when the stream broke before one arrived, whatever
   * its fragments carried.
   */
  private *close(
    stopReason: StopReason,
    done: TextDoneItem | ThinkingDoneItem | ToolCallDoneItem | null = this.held,
  ): Generator<OmniMessage> {
    const open = this.open;
    this.open = this.held = null;
    if (open) yield partial(open, "stop", "", stopReason);
    if (done?.type === "tool_call.done") {
      const toolCallId = open?.toolCallId ?? this.toolCallIds.allocate(done.tool_call_id);
      const args = JSON.stringify(done.arguments);
      const { name, fidelity } = done;
      yield toolCall({ name, arguments: args, toolCallId, stopReason, ...fidelityProp(fidelity) });
    } else if (done) {
      yield done.type === "text.done"
        ? assistantText(done.text, stopReason, done.fidelity)
        : thinkingMessage(done.thinking, stopReason, done.fidelity);
    } else if (open?.kind === "tool_call") {
      const { name, content, toolCallId } = open;
      yield toolCall({ name, arguments: content, toolCallId, stopReason });
    } else if (open) {
      yield (open.kind === "text" ? assistantText : thinkingMessage)(open.content, stopReason);
    }
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

  const requestTokens = translator.getRequestTokens();
  const sessionTokens = addTokenCounts(sessionTokensBefore, requestTokens);
  out.push(tokenUsage(sessionTokens, requestTokens));

  return { messages: out, requestTokens, sessionTokens };
}

// ---------------------------------------------------------------------------
// Retry policy
// ---------------------------------------------------------------------------

/**
 * A fuller error string than `err.message` for the LLM request outcome. Node's `fetch`
 * wraps the real transport failure as `TypeError: terminated` and puts the actual reason
 * on `err.cause` (a socket close, `ECONNRESET`, a provider stream abort, …); taking only
 * `.message` throws that away and leaves a bare, unactionable "terminated". This walks the
 * `cause` chain and appends each level's message and error `code`, so it surfaces as e.g.
 * "terminated: other side closed (UND_ERR_SOCKET)". Segments are de-duplicated and the
 * chain walk guards against cycles; a non-Error cause tail (string/number) is still kept.
 */
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let cur: unknown = error;
  while (cur instanceof Error && !seen.has(cur)) {
    seen.add(cur);
    const code = (cur as { code?: unknown }).code;
    let piece = cur.message || cur.name;
    if (typeof code === "string" && code && !piece.includes(code)) piece = `${piece} (${code})`;
    if (piece && !parts.includes(piece)) parts.push(piece);
    cur = (cur as { cause?: unknown }).cause;
  }
  if (cur != null && !(cur instanceof Error)) {
    const tail = String(cur);
    if (tail && !parts.includes(tail)) parts.push(tail);
  }
  return parts.join(": ") || error.message || String(error);
}

/** The errors that mean "a response arrived and cannot be used": a JSON parse failure, and MMSP's own stream errors. */
const UNUSABLE_RESPONSE_ERRORS: ReadonlySet<string> = new Set([
  "SyntaxError",
  "ToolCallArgumentParseError",
  "EmptyResponseError",
  "StreamProtocolError",
]);

/**
 * Determines whether an error means the response was delivered but cannot be used:
 *
 * - a raw `SyntaxError` from `JSON.parse` on a response body;
 * - MMSP's stream errors, thrown in place of the item or the `stop` event they spoil:
 *   `ToolCallArgumentParseError` (streamed tool-call arguments are not a JSON object — e.g. a
 *   stream truncated mid-arguments), `EmptyResponseError` (a completed response carrying
 *   thinking only, which cannot be replayed) and `StreamProtocolError` (a client broke the
 *   stream grammar);
 * - a stream a server/proxy ended early but **cleanly**, leaving MMSP no usage or finish reason
 *   to close it with: a plain `Error` MMSP gives no type, matched by its message
 *   ("Streaming response ended without usage_metadata|finish_reason", @prismshadow/mmsp 0.5.0).
 *
 * In every case the turn was **not committed** to MMSP's history: an incomplete LLM Request,
 * which ends `retryable` and is handed to the engine to reconnect and retry. Judged by the
 * error's `name` (so cross-realm or reconstructed errors match too), down the `cause` chain.
 */
export function isUnusableResponseError(error: unknown): boolean {
  return anyInCauseChain(error, (level) => {
    const { name, message } = level as { name?: unknown; message?: unknown };
    return (
      UNUSABLE_RESPONSE_ERRORS.has(String(name)) ||
      String(message ?? "").startsWith("Streaming response ended without")
    );
  });
}

/** Credentials/authentication error codes and types (OpenAI-compatible bodies / SDK errors). */
const AUTH_CODES: ReadonlySet<string> = new Set([
  "invalid_api_key",
  "authentication_error",
  "unauthorized",
]);

/**
 * Walks the error's `cause` chain (cycle-safe, same approach as `describeError`) applying
 * `probe` to each level; true as soon as one level matches. Higher layers routinely wrap the
 * real failure (Node fetch puts the transport error on `cause`), so single-level checks miss it.
 */
function anyInCauseChain(error: unknown, probe: (level: object) => boolean): boolean {
  const seen = new Set<unknown>();
  let cur: unknown = error;
  while (cur != null && typeof cur === "object" && !seen.has(cur)) {
    seen.add(cur);
    if (probe(cur)) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Provider error-code signals at one level of an error: `code` and `type` on the error
 * itself (the OpenAI SDK exposes the parsed body's code directly), plus the parsed body
 * under `error` — both the OpenAI shape (`err.error.code`) and the Anthropic SDK shape,
 * whose `error` property holds the whole response body (`err.error.error.code`). Auth
 * signals ride on `type` in some bodies, so both fields are collected.
 */
function providerSignals(level: object): string[] {
  const err = level as {
    code?: unknown;
    type?: unknown;
    error?: { code?: unknown; type?: unknown; error?: { code?: unknown; type?: unknown } };
  };
  const body = typeof err.error === "object" && err.error !== null ? err.error : undefined;
  const inner = typeof body?.error === "object" && body.error !== null ? body.error : undefined;
  const signals = [err.code, body?.code, inner?.code, err.type, body?.type, inner?.type];
  return signals.filter((v): v is string => typeof v === "string");
}

/**
 * Determines whether an error is a credentials/authentication failure — the one class an
 * in-run retry can never fix: the request keeps going out with the same dead credential.
 * Only the model REFERENCE is fixed at Session creation; the credential is read from the
 * current Project config whenever the Session loads, so the fix is updating that model's
 * API key (Models page) — after which the Session can continue — not retrying. Signals:
 * HTTP 401 (any), a known auth code/type (on the error, its `cause` chain, or the parsed
 * provider body), or the SDK error class name `AuthenticationError` (OpenAI / Anthropic
 * SDKs). Deliberately narrow and explicit — this detector is the ONLY thing that stops a
 * request from retrying, so nothing heuristic belongs in it: a bare 403 carries no
 * credential signal, classifies like any other failure, and rides the retry ladder.
 */
export function isAuthenticationError(error: unknown): boolean {
  return anyInCauseChain(error, (level) => {
    const err = level as { status?: unknown; statusCode?: unknown; name?: unknown };
    if (err.status === 401 || err.statusCode === 401) return true;
    if (providerSignals(level).some((c) => AUTH_CODES.has(c))) return true;
    const name = typeof err.name === "string" ? err.name : "";
    return name === "AuthenticationError" || level.constructor?.name === "AuthenticationError";
  });
}

/**
 * Determines whether an error is MMSP's `UnsupportedParameterError` for `fast_mode`:
 * clients without a fast tier (and claude5 on Bedrock / Claude 4.6 ids) reject the
 * parameter by throwing **before any network I/O**, so with the same frozen config the
 * failure is deterministic — retrying the identical request can never succeed. Deliberately
 * scoped to `parameter === "fast_mode"`: other UnsupportedParameterError sources keep the
 * default `retryable` classification (and the engine's ladder) unchanged. Judged by exception
 * type with a `name` fallback (covers cross-realm or deserialization-reconstructed errors,
 * same approach as isUnusableResponseError), probing down the `cause` chain.
 */
export function isFastModeUnsupportedError(error: unknown): boolean {
  return anyInCauseChain(error, (level) => {
    const err = level as { name?: unknown; parameter?: unknown };
    const isUnsupportedParameter =
      level instanceof UnsupportedParameterError || err.name === "UnsupportedParameterError";
    return isUnsupportedParameter && err.parameter === "fast_mode";
  });
}

/**
 * Actionable tail appended to a fast-mode rejection's error text: the raw MMSP message
 * says what is unsupported ("Kimi does not support fast mode."); this says where the switch
 * lives. Exported for the outcome-classification tests.
 */
export const FAST_MODE_UNSUPPORTED_GUIDANCE =
  "Fast mode is enabled for this model; turn it off in the model settings to use this model.";

/**
 * Determines whether an error is a definitive provider rejection of the request itself —
 * the `fatal` detector for errored requests. Only an explicit HTTP client-error status
 * counts: 4xx minus 408 (request timeout) and 429 (rate limit), which are transient by
 * definition. Deliberately an allowlist of certainty, probed down the `cause` chain
 * (SDKs wrap the real response error): everything this misses stays `retryable`, because
 * retrying a genuinely fatal error costs one ladder and ends with the same message, while
 * refusing to retry a transient one destroys the turn. Authentication is checked
 * separately (`isAuthenticationError`) and first — a 401 is fatal through that path with
 * its more specific message handling.
 */
export function isFatalProviderRejection(error: unknown): boolean {
  return anyInCauseChain(error, (level) => {
    const err = level as { status?: unknown; statusCode?: unknown };
    const status = typeof err.status === "number" ? err.status : err.statusCode;
    if (typeof status !== "number") return false;
    return status >= 400 && status <= 499 && status !== 408 && status !== 429;
  });
}

/**
 * Provider wordings of a request refused over an image it carries (matched case-insensitively
 * against the provider's message and its error code/type). Each names an image explicitly —
 * a bare "invalid request" must stay `rejected`.
 */
const IMAGE_REJECTION_PATTERNS: readonly RegExp[] = [
  // OpenAI "You uploaded an unsupported image", DeepSeek "You have uploaded an unsupported image".
  /unsupported image/i,
  // OpenAI-style "Invalid image" and the `invalid_image` / `invalid_image_format` codes.
  /invalid image/i,
  /invalid_image/i,
  // The `image_parse_error` code OpenAI-style APIs send for bytes they could not parse.
  /image_parse_error/i,
  // Anthropic "Could not process image".
  /could not process image/i,
  // Gemini "Unable to process input image"; OpenAI-compatible servers "Failed to decode
  // image", "failed to download image" (an image URL the server fetches itself).
  /(unable|failed) to (process|decode|download|fetch|load|read) (the )?(input |provided )?image/i,
  // "The image is not valid", "Image is invalid", "image could not be processed".
  /image (is not valid|is invalid|could not be (processed|decoded))/i,
  // "The provided image does not represent a valid image".
  /does not represent a valid image/i,
  // Anthropic "Image does not match the provided media type image/png".
  /image does not match the provided media type/i,
  // Anthropic "image exceeds 5 MB maximum", "image dimensions exceed max allowed size".
  /image.{0,40}(exceeds|too large|dimensions? (exceed|too))/i,
  // A text-only model: "This model does not support image input", "doesn't support vision".
  /(does not|doesn't) support (image|vision)/i,
  // llama.cpp without a multimodal projector: "image input is not supported".
  /image input (is )?not supported/i,
  // Gateways fronting a text-only model: "Images are not supported for this model".
  /images? (are|is) not supported/i,
];

/**
 * Provider wordings of a request larger than the model's context window (matched like
 * IMAGE_REJECTION_PATTERNS).
 */
const CONTEXT_OVERFLOW_PATTERNS: readonly RegExp[] = [
  // OpenAI's `context_length_exceeded` code, which compatible servers repeat in the message.
  /context[_ ]length[_ ]exceeded/i,
  // OpenAI / vLLM "This model's maximum context length is 131072 tokens. However, …".
  /maximum context length/i,
  // llama.cpp "request (100091 tokens) exceeds the available context size (98304 tokens)".
  /exceeds? the (available |maximum )?context (size|length|window)/i,
  // Anthropic "prompt is too long: 210000 tokens > 200000 maximum".
  /prompt is too long/i,
  // Gemini "The input token count (1200000) exceeds the maximum number of tokens allowed".
  /input token count.{0,40}exceeds the maximum/i,
  // Moonshot "Your request exceeded model token limit: 131072".
  /exceeded model token limit/i,
  // Mistral "Prompt contains 40000 tokens, too large for model with 32768 maximum context length".
  /too large for model with \d+ maximum context length/i,
  // Qwen (DashScope) "Range of input length should be [1, 129024]".
  /range of input length should be/i,
  // "Input length exceeds the maximum", "input tokens exceed the model's context window".
  /input (length|tokens?) exceeds? (the )?(model'?s? )?(context|max)/i,
];

/**
 * The provider's own words at one level of an error: its `message`, the string `code` /
 * `type` fields (see providerSignals), and the message of the parsed body under `error` — the
 * OpenAI SDK shape (`err.error.message`) and the Anthropic one, whose `error` holds the whole
 * body (`err.error.error.message`).
 */
function providerWording(level: object): string[] {
  const err = level as {
    message?: unknown;
    error?: { message?: unknown; error?: { message?: unknown } };
  };
  const body = typeof err.error === "object" && err.error !== null ? err.error : undefined;
  const inner = typeof body?.error === "object" && body.error !== null ? body.error : undefined;
  const messages = [err.message, body?.message, inner?.message].filter(
    (v): v is string => typeof v === "string",
  );
  return [...messages, ...providerSignals(level)];
}

/** Whether any level of the error's `cause` chain words itself like one of `patterns`. */
function matchesProviderWording(error: unknown, patterns: readonly RegExp[]): boolean {
  return anyInCauseChain(error, (level) =>
    providerWording(level).some((text) => patterns.some((pattern) => pattern.test(text))),
  );
}

/**
 * Determines whether a provider rejection is about an image in the request — an unsupported
 * format, corrupt data, a size or dimension past the provider's limit, or a model that takes
 * no images. Read off the provider's wording (IMAGE_REJECTION_PATTERNS) and consulted only for
 * an error `isFatalProviderRejection` already holds definitive, so a transient failure that
 * happens to mention an image keeps its retries. The outcome is still `fatal` here: whether
 * the request can go out again without the image is the engine's call (`image_rejected`).
 */
export function isImageRejection(error: unknown): boolean {
  return matchesProviderWording(error, IMAGE_REJECTION_PATTERNS);
}

/**
 * Determines whether a provider rejection says the request exceeds the model's context window.
 * Read off the provider's wording (CONTEXT_OVERFLOW_PATTERNS) and, like `isImageRejection`,
 * consulted only for a definitive 4xx. Still `fatal` — the same context overflows again on
 * every retry — but coded `context_overflow` so frontends can point at the fix: a model with a
 * larger window, or a configured context window no larger than what the server supports (set
 * too large, compaction triggers too late to keep the context under the real limit).
 */
export function isContextOverflowRejection(error: unknown): boolean {
  return matchesProviderWording(error, CONTEXT_OVERFLOW_PATTERNS);
}

// ---------------------------------------------------------------------------
// GenerativeModel
// ---------------------------------------------------------------------------

/**
 * A stateful LLM object attached to a Session. MMSP's `streamingResponseStateful` maintains
 * conversation history internally; this class is only responsible for protocol translation
 * and token accounting. **It never retries internally** — retries are handled by
 * `context_engine`.
 */
export class GenerativeModel implements LLMInterface {
  private client: AutoLLMClient;
  private readonly clientOptions: Omit<ConstructorParameters<typeof AutoLLMClient>[0], "apiKey">;
  private currentApiKey: string | undefined;
  private readonly resolveApiKey: (() => Promise<string | undefined>) | undefined;
  private readonly uniConfig: UniConfig;
  /**
   * Construction-time default thinking level. Kept **out of the frozen uniConfig**: the
   * effective level is resolved per request (`params.thinkingLevel ?? default`), so a turn can
   * override it without rebuilding the model object — the thinking level is a per-turn
   * parameter, not a Session invariant.
   */
  private readonly defaultThinkingLevel: ThinkingLevelName | undefined;
  /** Streaming idle timeout (milliseconds); <= 0 disables it. A timeout is treated as needing reconnection. */
  private readonly requestTimeoutMs: number;
  /**
   * tool_call_id uniqueness registry (see tool-call-ids.ts): when a name-as-id provider (e.g. Gemini)
   * calls the same tool repeatedly, it assigns a `#n` suffix to later calls so engine pairing and the
   * frontend tool cards don't collide on id. Injected via config so it can be shared across the new
   * instance rebuilt on compaction; defaults to a fresh one.
   */
  private readonly toolCallIds: ToolCallIdAllocator;
  /** Configured output cap (`GenerativeModelConfig.maxTokens`); the per-request clamp derives the effective cap from it (see effectiveMaxTokens). */
  private readonly configuredMaxTokens: number | undefined;
  /** Model context window; `undefined` when unconfigured (or implausibly small, see resolveContextWindow) — the per-request clamp then disables itself rather than clamp against an assumption. */
  private readonly contextWindow: number | undefined;
  /**
   * Construction-time estimate of the fixed request prefix (system prompt + tool schemas):
   * the prefix is part of every request but never part of `newMessages`. Seeds
   * `lastRequestTotal`, and re-seeds it in `setHistory`.
   */
  private readonly baseInputTokens: number;
  /**
   * The current context's size: the most recent completed request's real
   * `token_usage.request.total` once one exists (a measured total always includes the
   * prefix, so it can only refine the seed upward from real data; providers stripping
   * historical thinking only make it an overestimate, the safe direction), the
   * `baseInputTokens` seed before that, plus the replayed-history estimate after
   * `setHistory`. The next request's input is this figure plus the newly appended
   * messages.
   */
  private lastRequestTotal: number;
  /** Last hard-clamped cap already warned about on stderr (dedupe: retries reuse the same estimate and would repeat the identical line). */
  private lastWarnedCap: number | undefined;

  constructor(config: GenerativeModelConfig) {
    // Omit apiKey / baseUrl when undefined, letting MMSP read them from environment
    // variables. clientType determines which protocol to speak (`openai-chat` means OpenAI
    // Chat Completions compatible; the bare `openai` spelling is a deprecated upstream alias);
    // when omitted, MMSP infers it from model_id, so it only needs to be specified
    // explicitly for custom-named models. `defaultHeaders` carries the app attribution the
    // configured endpoint reads (see attributionHeaders); MMSP hands it to every request
    // the routed client makes, and endpoints with no attribution scheme get no extra headers
    // at all. The Session's id rides along for the schemes that name the conversation rather
    // than the app; without one, attributionHeaders mints a fresh id. Computed once and kept
    // in clientOptions, so every request of this instance — across a rotated credential too —
    // names the same conversation.
    const headers = attributionHeaders(config.baseUrl, config.sessionId);
    this.clientOptions = {
      model: config.modelId,
      ...(config.baseUrl !== undefined ? { baseUrl: config.baseUrl } : {}),
      ...(config.clientType !== undefined ? { clientType: config.clientType } : {}),
      ...(headers ? { defaultHeaders: headers } : {}),
    };
    this.currentApiKey = config.apiKey;
    this.resolveApiKey = config.resolveApiKey;
    this.client = new AutoLLMClient({
      ...this.clientOptions,
      ...(this.currentApiKey !== undefined ? { apiKey: this.currentApiKey } : {}),
    });

    this.uniConfig = buildUniConfig(config);
    this.defaultThinkingLevel = config.thinkingLevel;
    this.requestTimeoutMs = config.requestTimeoutMs ?? 300000;
    this.toolCallIds = config.toolCallIds ?? new ToolCallIdAllocator();
    this.configuredMaxTokens = config.maxTokens;
    this.contextWindow = resolveContextWindow(config.contextWindow);
    this.baseInputTokens =
      approximateTokens(config.systemPrompt ?? "") +
      approximateTokens(JSON.stringify(this.uniConfig.tools ?? []));
    this.lastRequestTotal = this.baseInputTokens;
  }

  /** Swap a rotated credential into MMSP without losing its stateful conversation. */
  private async refreshApiKey(): Promise<void> {
    if (this.resolveApiKey === undefined) return;
    const nextApiKey = await this.resolveApiKey();
    if (nextApiKey === undefined || nextApiKey === this.currentApiKey) return;
    const history = this.client.getHistory();
    const next = new AutoLLMClient({ ...this.clientOptions, apiKey: nextApiKey });
    if (history.length > 0) next.setHistory(history);
    this.client = next;
    this.currentApiKey = nextApiKey;
  }

  /**
   * The UniConfig for one request: the shared frozen config plus this request's effective
   * thinking level (per-request override, else the construction-time default; neither → the
   * key stays off the wire, preserving the provider default) and this request's effective
   * output cap (the window-derived clamp below; equal to the configured cap for big-window
   * models, so the frozen value goes out unchanged).
   */
  private requestConfig(
    override: ThinkingLevelName | undefined,
    newMessages: OmniMessage[],
  ): UniConfig {
    const thinking = mapThinkingLevel(override ?? this.defaultThinkingLevel);
    const maxTokens = this.effectiveMaxTokens(newMessages);
    let cfg = this.uniConfig;
    if (thinking !== undefined) cfg = { ...cfg, thinking_level: thinking };
    if (maxTokens !== undefined && maxTokens !== this.uniConfig.max_tokens) {
      cfg = { ...cfg, max_tokens: maxTokens };
    }
    return cfg;
  }

  /**
   * Per-request output cap: `min(configured max_tokens, context_window − estimated input −
   * safety margin)`, floored — recomputed for every request (compaction requests included:
   * they run through the same path, exactly when the context is largest) from the freshest
   * input knowledge this object has: the last completed request's real `token_usage` total
   * plus a character-heuristic estimate of the newly appended messages (no tokenizer;
   * see context-limits.ts). Fixes issue #218: a fixed cap (the seeded 32000) that ignores
   * the input made every request to a small-window model (e.g. a 32k vLLM) fail provider
   * validation with a non-retryable 400.
   *
   * Interplay with compaction: the engine's compaction threshold is derived at
   * `context_window − COMPACTION_HEADROOM` (see effectiveMaxContextLength), so under normal
   * operation the context is summarized before the remaining window ever nears the
   * MIN_OUTPUT_TOKENS floor; the floor only binds when compaction is disabled or the window
   * is misconfigured, where a deterministic small cap beats a provider rejection.
   * `undefined` = no positive cap configured: the key stays off the wire and the provider's
   * own remaining-window default applies (the existing `-1` contract). Without a configured
   * `contextWindow` the clamp is off entirely (see effectiveMaxOutputTokens).
   *
   * A hard clamp — the derived cap dropping below half the configured one — is announced
   * once per distinct value on stderr with the numbers involved, so a shaved `max_tokens`
   * is diagnosable from the log instead of surfacing only as an opaque failed/short turn.
   */
  private effectiveMaxTokens(newMessages: OmniMessage[]): number | undefined {
    const estimatedInput = this.lastRequestTotal + approximateMessagesTokens(newMessages);
    const derived = effectiveMaxOutputTokens(
      this.configuredMaxTokens,
      this.contextWindow,
      estimatedInput,
    );
    if (
      derived !== undefined &&
      this.configuredMaxTokens !== undefined &&
      derived < this.configuredMaxTokens / 2 &&
      derived !== this.lastWarnedCap
    ) {
      this.lastWarnedCap = derived;
      process.stderr.write(
        `[penguin] output cap clamped hard: max_tokens ${this.configuredMaxTokens} -> ${derived} ` +
          `(context_window ${this.contextWindow}, estimated input ${estimatedInput})\n`,
      );
    }
    return derived;
  }

  /**
   * Streaming generation (a single attempt, no internal retry). Merges
   * `params.newMessages` into one UniMessage to issue a stateful request, translating streamed
   * UniEvents into OmniMessages.
   *
   * **Never throws to `context_engine`**: whether it ends normally or is interrupted/errors out,
   * every `partial_*` segment is closed as `start → delta → stop → complete message`,
   * and the terminal state is then returned as `LLMOutcome`:
   *   - **Normal completion**: the `stop` event closed every item; `token_usage` is produced
   *     (only in this case) → `completed`;
   *   - **User interruption**: `finishInterrupted("aborted")` closes out, produces no usage →
   *     `aborted`;
   *   - **Fatal failure** — a definitive provider 4xx rejection (`isFatalProviderRejection`;
   *     coded `image_rejected` / `context_overflow` when its wording says so, see
   *     `isImageRejection`), a credentials failure (`isAuthenticationError`), a fast-mode
   *     rejection (`isFastModeUnsupportedError`, thrown deterministically before any network
   *     I/O when this config enables `fast_mode` on a model without a fast tier), or input
   *     that never assembled into a request: `finishInterrupted("fatal")` closes out, produces
   *     no usage → `fatal` (carrying `errorMessage`), which the engine stops the run on
   *     instead of retrying — the identical request can never succeed, so the ladder would
   *     only delay the actionable message;
   *   - **Every other failure** — idle timeout, network/transport drops, 408/429/5xx,
   *     MMSP parse errors and truncated streams, and anything unclassifiable:
   *     `finishInterrupted("retryable")` closes out, produces no usage → `retryable`
   *     (carrying `errorMessage` when a concrete error was caught), reconnected by
   *     `context_engine` within the same run. Unclassifiable errors stay retryable on
   *     purpose: the fatal detector is an allowlist, and a gateway phrasing a transient
   *     fault its own way must keep its retries.
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
    // mixed roles / argument JSON collapse to a fatal outcome — the same input can never
    // assemble on a retry, so burning the reconnect ladder would only delay the message —
    // and never throw to context_engine.
    let uniMessage: UniMessage;
    try {
      uniMessage = mergeOmniToUniMessage(params.newMessages);
    } catch (err) {
      return { status: "fatal", errorCode: "invalid_input", errorMessage: describeError(err) };
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

    /**
     * Settles as soon as the run must stop, whatever upstream is doing: the user aborted, or
     * the idle timer fired (both go through `ac`). `it.next()` is raced against this because
     * an upstream that does not honour its AbortSignal leaves that promise pending **forever**
     * — and once `ac` is aborted the idle timer's own `ac.abort()` is a no-op, so nothing is
     * left to unwedge the loop. Observed against Kimi: pressing Stop mid-request left the
     * Session running with no way to send, compact or interrupt it again, short of a restart.
     *
     * The pre-loop `userSignal?.aborted` check below covers the *other* half of this (aborting
     * while suspended at a `yield`); it cannot help here, since the loop never gets back to it.
     */
    const STOPPED = Symbol("stopped");
    const stopped: Promise<typeof STOPPED> = new Promise((resolve) => {
      if (ac.signal.aborted) {
        resolve(STOPPED);
        return;
      }
      ac.signal.addEventListener("abort", () => resolve(STOPPED), { once: true });
    });

    // Terminal-state classification: retryable (transport/parse failures) / fatal (definitive
    // rejections) / aborted (user). null means it ended normally.
    let outcome: LLMOutcome | null = null;
    try {
      await this.refreshApiKey();
      const it = this.openStream(
        uniMessage,
        ac.signal,
        this.requestConfig(params.thinkingLevel, params.newMessages),
      )[Symbol.asyncIterator]();
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
        let res: IteratorResult<UniEvent> | typeof STOPPED;
        try {
          res = await Promise.race([it.next(), stopped]);
        } finally {
          clearTimer();
        }
        if (res === STOPPED) {
          // Upstream never settled after the abort. Abandon it rather than await it: ask it to
          // close (best effort — a stream that ignored the signal may ignore this too, so the
          // rejection is swallowed and the promise is not awaited) and classify by trigger.
          void Promise.resolve(it.return?.(undefined)).catch(() => undefined);
          outcome = userSignal?.aborted
            ? { status: "aborted" }
            : { status: "retryable", errorCode: "timeout" };
          break;
        }
        if (res.done) break;
        // `stop` is always the last event, and MMSP committed the turn to its history before
        // yielding it: with that event in hand the request is complete, whatever the abort
        // signal says.
        if (userSignal?.aborted && res.value.event_type !== "stop") {
          outcome = { status: "aborted" };
          break;
        }
        for (const msg of translator.pushEvent(res.value)) yield msg;
        if (translator.stopped) break;
      }
    } catch (error) {
      // User interruption **takes priority**: even if the idle timer fires at the same time,
      // it's classified as aborted (user intent outweighs a coincidental timeout).
      if (userSignal?.aborted) {
        outcome = { status: "aborted" };
      } else if (timedOut) {
        outcome = { status: "retryable", errorCode: "timeout" }; // Idle timeout -> needs reconnection
      } else if (isUnusableResponseError(error)) {
        // An unusable response, or a cleanly truncated stream (MMSP had no usage or finish
        // reason to close it with): both are an incomplete LLM Request — the turn was never
        // committed, so the engine reconnects and retries. Checked before the fatal
        // detectors: these carry no HTTP status, but the explicit branch keeps the message
        // and the intent readable.
        outcome = {
          status: "retryable",
          errorCode: "malformed",
          errorMessage: describeError(error),
        };
      } else if (isAuthenticationError(error)) {
        // Credentials failure: fatal — no retry can turn a rejected credential into a
        // working one. The errorMessage tells the user to update this model's API key
        // (only the model reference is fixed at Session creation; the credential is read
        // from the current Project config on load), after which the Session continues.
        outcome = { status: "fatal", errorCode: "auth", errorMessage: describeError(error) };
      } else if (this.uniConfig.fast_mode === true && isFastModeUnsupportedError(error)) {
        // Fast mode rejected by a model without a fast tier: MMSP throws its
        // UnsupportedParameterError before any network I/O, so with this object's frozen
        // config the failure is deterministic — fatal, so the engine surfaces the message
        // immediately instead of burning the reconnect ladder on a request that can never
        // succeed. The guard on our own config keeps the special case honest: without
        // fast_mode on the wire this error cannot be ours to explain.
        outcome = {
          status: "fatal",
          errorCode: "unsupported",
          errorMessage: `${describeError(error)} ${FAST_MODE_UNSUPPORTED_GUIDANCE}`,
        };
      } else if (isFatalProviderRejection(error)) {
        // A definitive provider 4xx rejection (408/429 excluded): the identical request
        // fails identically on every retry, so stop now with the provider's own message.
        // Two rejections get a code of their own, read off that message: an image the
        // provider refuses (the engine can replace it and send the rest again) and a request
        // past the context window (frontends point at the fix). The image is checked first:
        // a message matching both takes the path the engine can recover from, and a retry
        // that still overflows comes back as context_overflow.
        const errorCode = isImageRejection(error)
          ? "image_rejected"
          : isContextOverflowRejection(error)
            ? "context_overflow"
            : "rejected";
        outcome = { status: "fatal", errorCode, errorMessage: describeError(error) };
      } else if ((error as { name?: string })?.name === "AbortError") {
        outcome = { status: "aborted" }; // Fallback: an unexpected abort (neither timeout nor user)
      } else {
        // Everything else — network/transport drops, 429/5xx, and anything unclassifiable —
        // retries on the engine's ladder. The detail rides on the outcome so observability
        // (request_end -> the Cost center's errors panel) shows the real reason behind a
        // retried request.
        outcome = { status: "retryable", errorCode: "network", errorMessage: describeError(error) };
      }
    } finally {
      clearTimer();
      userSignal?.removeEventListener("abort", onUserAbort);
    }

    // Defensive: a stream that ended without its `stop` event and without throwing — an
    // upstream answering an abort with a graceful end — was never committed, and must not be
    // misjudged as completed (priority matches the catch classification: user interruption >
    // timeout). The opposite mistake is ruled out above: once `stop` arrived the turn is in
    // MMSP's history, and treating it as aborted would have the engine flatten an
    // already-committed tool_use turn, leaving every later request rejected as an unanswered
    // tool_use (400) with no fix-up path that reaches the LLM history.
    if (!outcome && !translator.stopped) {
      if (userSignal?.aborted) outcome = { status: "aborted" };
      else if (timedOut) outcome = { status: "retryable", errorCode: "timeout" };
      else {
        outcome = {
          status: "retryable",
          errorCode: "malformed",
          errorMessage: "The response stream ended without a stop event.",
        };
      }
    }

    if (outcome) {
      // Interrupted/errored: close the item still streaming and backfill its complete message, producing no token_usage.
      const reason: StopReason = outcome.status === "completed" ? "retryable" : outcome.status;
      for (const msg of translator.finishInterrupted(reason)) yield msg;
      return outcome;
    }

    // Normal completion: the `stop` event closed every item; produce token_usage.
    const requestTokens = translator.getRequestTokens();
    // The provider-measured context size, feeding the next request's output-cap clamp
    // (see effectiveMaxTokens). Only a completed request updates it: an interrupted or
    // failed attempt was never committed, so the context did not grow.
    this.lastRequestTotal = requestTokens.total;
    // The session series is not this object's business (its lifetime is one model context):
    // the engine accumulates and stamps token_usage.session on every message it forwards.
    // The request counts stand in for consumers running a GenerativeModel without an engine.
    yield tokenUsage(requestTokens, requestTokens);
    return { status: "completed" };
  }

  /**
   * Injects the replayed history in one shot when resuming a Session: converts the complete
   * OmniMessage history, grouped by adjacent same role, into
   * MMSP UniMessages and calls MMSP's setHistory, so subsequent Requests continue from a
   * history exactly matching the original conversation. **Called only once, on a fresh context
   * object, during resumption**; not used during normal operation, where the incremental context
   * is maintained by MMSP itself.
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
    // The injected history is context this object's first request carries without any
    // token_usage having measured it: re-seed the input-size tracker (prefix + history
    // estimate) so the output-cap clamp (effectiveMaxTokens) doesn't reason from an empty
    // context on a resumed session. The first completed request replaces this with the
    // real total.
    this.lastRequestTotal = this.baseInputTokens + approximateMessagesTokens(history);
    this.client.setHistory(groupHistoryToUniMessages(history));
  }

  /**
   * Opens the underlying MMSP stream (a testing seam): defaults to
   * `streamingResponseStateful`; unit tests can subclass and override this method, feeding in a
   * controlled UniEvent stream to verify the outcome classification for timeout/network
   * drop/interruption/error (without a real API). `config` is this request's resolved
   * UniConfig (the shared frozen config plus the per-request thinking level).
   */
  protected openStream(
    uniMessage: UniMessage,
    signal: AbortSignal,
    config: UniConfig = this.uniConfig,
  ): AsyncIterable<UniEvent> {
    return this.client.streamingResponseStateful({
      message: uniMessage,
      config,
      signal,
    });
  }
}

// ---------------------------------------------------------------------------
// UniConfig pre-construction
// ---------------------------------------------------------------------------

/** Maps a ThinkingLevelName to the MMSP ThinkingLevel enum; returns undefined if not found. */
export function mapThinkingLevel(name: ThinkingLevelName | undefined): ThinkingLevel | undefined {
  if (name === undefined) return undefined;
  const table: Record<ThinkingLevelName, ThinkingLevel> = {
    none: ThinkingLevel.NONE,
    low: ThinkingLevel.LOW,
    medium: ThinkingLevel.MEDIUM,
    high: ThinkingLevel.HIGH,
    xhigh: ThinkingLevel.XHIGH,
    max: ThinkingLevel.MAX,
  };
  return table[name];
}

/** Maps ToolDefinition[] to MMSP ToolSchema[]. */
export function toolDefinitionsToSchemas(tools: ToolDefinition[]): ToolSchema[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    ...(tool.parameters !== undefined ? { parameters: tool.parameters } : {}),
  }));
}

/**
 * Pre-builds UniConfig from GenerativeModelConfig (called once at construction time).
 *
 * When the tool list is empty (connectivity probe, bare/meta LLM, vision describer), `tools`
 * is omitted entirely instead of set to `[]`: strict OpenAI-compatible servers (e.g. vLLM)
 * reject an empty array with a 400 ("tools must not be an empty array"), and omission is the
 * protocol equivalent. `tool_choice` is likewise never set — MMSP only puts it on the wire
 * when UniConfig defines it, and leaving it off preserves the protocol default ("auto" when
 * tools are present).
 *
 * `thinkingLevel` is deliberately **not** baked in here: the effective level is resolved per
 * request (`GenerativeModelParameters.thinkingLevel ?? the construction default`, see
 * `GenerativeModel.requestConfig`), so a turn can override it on a live session.
 */
export function buildUniConfig(config: GenerativeModelConfig): UniConfig {
  const uniConfig: UniConfig = {};
  if (config.tools.length > 0) {
    uniConfig.tools = toolDefinitionsToSchemas(config.tools);
  }
  if (config.systemPrompt !== undefined) {
    uniConfig.system_prompt = config.systemPrompt;
  }
  // Non-positive (-1 per the config contract) means "no explicit cap": the key is left off
  // the wire so the provider default applies — sent literally, every provider rejects a
  // negative max_tokens with a 400 (issue #55's sibling).
  if (config.maxTokens !== undefined && config.maxTokens > 0) {
    uniConfig.max_tokens = config.maxTokens;
  }
  // Fast mode (the model entry's `fast_mode` annotation): only ever set when enabled — the
  // key stays off the config otherwise, so models without a fast tier are unaffected by
  // default (MMSP rejects the parameter wherever no fast tier exists).
  if (config.fastMode === true) {
    uniConfig.fast_mode = true;
  }
  // Thought summaries, always requested. Two things ride on it: the user gets to watch the
  // model reason, and — because the request timeout is an idle budget between upstream events
  // — a reasoning phase that reaches the wire keeps resetting that timer instead of counting
  // as one long silence. No model rejects the flag (unlike fast_mode): MMSP maps it where
  // it exists and drops it where it doesn't, so the only cost of asking is on families that
  // answer with a summarized thinking stream (Claude) instead of the raw one.
  uniConfig.thinking_summary = true;
  return uniConfig;
}
