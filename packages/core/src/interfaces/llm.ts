/**
 * What the LLM side needs: the contract `context_engine` drives one model request through.
 *
 * The engine calls exactly one method here — `streamGenerate` — and reads exactly two things
 * back: the yielded AmspRecord stream, and the generator's `LLMOutcome` return value (the
 * request's terminal state; see the docs page's "control plane"). Besides that it reads one
 * optional property, `defaultThinkingLevel`, to know which level a request with no pin goes
 * out at, and one in-process mark on a yielded tool call (`markInterruptedToolCall`). Protocol
 * conversion to and from the provider is the implementation's own business.
 *
 * Docs: packages/docs/content/interfaces.{zh,en}.md (site path /docs/interfaces).
 */
import type { ErrorCode, AmspRecord, StopReason, ToolDefinition } from "@prismshadow/amsp/records";
import type { ThinkingLevelName } from "./shared.js";
// Concrete class, used only as a type annotation (type-only import; no runtime dependency, no circular reference).
import type { ToolCallIdAllocator } from "../llm/tool-call-ids.js";

/**
 * GenerativeModel initialization config.
 * Docs: /docs/interfaces § "GenerativeModelConfig".
 */
export interface GenerativeModelConfig {
  modelId: string;
  apiKey?: string;
  /**
   * Optional host-owned credential resolver, called before every upstream request. When it
   * returns a different key, the MMSP client is rebuilt with its stateful history intact.
   * Core assigns no provider semantics to this hook.
   */
  resolveApiKey?: () => Promise<string | undefined>;
  baseUrl?: string;
  /**
   * MMSP client type (`openai-chat` / `openai-responses` / `ant-messages` /
   * `google-genai` / `anthropic-official` / …; the bare `openai` spelling is a
   * deprecated alias of `openai-chat`). If omitted, MMSP routes by the vendor family
   * `modelId` begins with (`gpt-`, `claude-`, `gemini-`, `glm-`, `kimi-`, `deepseek-`,
   * `minimax-`); custom-named models or third-party models using an OpenAI protocol must
   * specify it explicitly.
   */
  clientType?: string;
  tools: ToolDefinition[];
  /** Full system Prompt after placeholder substitution in the system_config.system_prompt template. */
  systemPrompt?: string;
  /**
   * Model context window (tokens, from the model entry). Used to clamp each request's
   * effective output cap so `input + max_tokens` stays inside the window (issue #218).
   * Unset (or implausibly small, see llm/context-limits.ts resolveContextWindow): the
   * clamp is disabled — a hard cap is never derived from an assumed window.
   */
  contextWindow?: number;
  /**
   * Output token cap per Request; non-positive (-1) means no explicit cap (omitted from the
   * request). With `contextWindow` set, a positive cap is a ceiling, not a constant: each
   * request sends `min(maxTokens, contextWindow − estimated input − safety margin)` (see
   * llm/context-limits.ts) so small-window models never fail provider validation.
   */
  maxTokens?: number;
  /**
   * Per-model fast mode (from the model entry's `fast_mode` annotation): when true, every
   * request opts into the provider's faster serving tier at premium pricing (MMSP
   * UniConfig `fast_mode`). Off by default. Models without a fast tier reject the parameter
   * before any network I/O (MMSP `UnsupportedParameterError`); `streamGenerate` reports
   * that as a `fatal` outcome so the engine surfaces it instead of retrying.
   */
  fastMode?: boolean;
  /** Construction-time default thinking level; a per-request `GenerativeModelParameters.thinkingLevel` overrides it for that request. */
  thinkingLevel?: ThinkingLevelName;
  /**
   * Idle budget (ms) for an LLM Request: the longest wait for the NEXT upstream event, not a
   * cap on the request's total duration — the timer runs only while awaiting upstream, resets
   * on every event, and excludes consumer-side time (yielding, approvals, Trace writes). It
   * therefore bounds the connect + first-event wait and the gaps between events, never how
   * long the model generates. From system_config.model.timeoutMs; <=0 disables it. Defaults
   * to 600000: a model whose reasoning never reaches the wire (or a relay that withholds it
   * until the answer starts) spends its whole thinking phase inside the first-event gap.
   */
  requestTimeoutMs?: number;
  /**
   * The Session's id, for endpoints whose attribution scheme identifies the conversation
   * rather than the app (OpenCode's `x-opencode-session`; see llm/app-attribution.ts
   * `attributionHeaders`). Unset — a request outside any Session: a connectivity test, a
   * vision probe, a one-off utility completion — attributionHeaders mints a fresh id, which
   * the instance then keeps for all of its requests, so they are a conversation of their own.
   */
  sessionId?: string;
  /**
   * tool_call_id uniqueness registry (Session-level). Pass the same instance when rebuilding a new
   * GenerativeModel on compaction so the uniqueness scope covers the whole Session; defaults to a fresh
   * one. See llm/tool-call-ids.ts.
   */
  toolCallIds?: ToolCallIdAllocator;
}

export interface GenerativeModelParameters {
  /** AmspRecord array for the input newly added this turn; implementations must merge it into a single UniMessage (multiple roles not accepted). */
  newMessages: AmspRecord[];
  signal?: AbortSignal;
  /**
   * Per-request thinking level override: applied to **this request only**; omitted falls back
   * to the construction-time default (`GenerativeModelConfig.thinkingLevel`). The thinking
   * level is a per-turn parameter, not a Session invariant.
   */
  thinkingLevel?: ThinkingLevelName;
}

/**
 * The terminal state of an LLM request, returned as the **return value** of the `streamGenerate`
 * async generator (not a yielded message). The engine records the status as the Request's
 * `request_end.status` — the only record of why a Request ended:
 *   - `completed`: finished normally (already produced `token_usage`);
 *   - `aborted`: user-initiated interruption — stop and hand back to the user;
 *   - `retryable`: a failure worth retrying — transport drops, idle timeouts, 408/429/5xx,
 *     malformed or truncated responses, and anything unclassifiable. `context_engine`
 *     reconnects on its backoff ladder; `errorMessage` names the concrete failure.
 *     Unclassifiable errors land here on purpose: the fatal detector is an allowlist, and a
 *     gateway phrasing a transient fault its own way must keep its retries. A response that
 *     arrived whole but stopped at its output cap is `retryable` too, coded `output_truncated`
 *     (one that ended on a finish reason the client does not map is coded `malformed`): the
 *     implementation takes the turn back out of its stateful history but still emits its
 *     `token_usage`, since the provider billed it. A one-shot caller may read the text of an
 *     `output_truncated` answer as it would a completed one;
 *   - `fatal`: a failure no retry can fix — a provider 4xx rejection (invalid request or
 *     quota; 408/429 stay retryable), a credentials failure (see `isAuthenticationError`),
 *     or a deterministic client-side rejection thrown before any network I/O (fast mode on
 *     a model without a fast tier). The engine stops the run and surfaces `errorMessage`;
 *     the fix is a config or credential change, then a new request (only the model
 *     reference is fixed at Session creation — credentials come from the current Project
 *     config, so a key update lets the Session continue).
 * Docs: /docs/interfaces § "LLMOutcome semantics".
 */
export interface LLMOutcome {
  status: StopReason;
  /**
   * Classified cause (the records' ErrorCode vocabulary): present on every
   * non-completed failure outcome. Carried onto the `request_end` event as `error_code`,
   * next to `error_message` — the status answers "retry?", the code says what kind of
   * error it was, machine-readably.
   */
  errorCode?: ErrorCode;
  /**
   * Error detail (`describeError` text): present on `fatal`, and on `retryable` when a
   * concrete transport/provider error was caught or the response was cut off (a plain idle
   * timeout has none). Carried onto the `request_end` event as `error_message` — one name across the internal outcome
   * and the wire — so observability (the Cost center's errors panel) can show the real
   * reason behind a retried request.
   */
  errorMessage?: string;
}

/**
 * How many attempts a single turn's request may make at most, the first one included, unless
 * the engine is given its own ceiling (`maxTurnAttempts`). A host that numbers a retry ladder
 * ("attempt 3/10") reads it from here, so the count it shows is the engine's.
 */
export const DEFAULT_MAX_TURN_ATTEMPTS = 10;

/** Complete tool calls an implementation closed because their request ended early (see `markInterruptedToolCall`). */
const interruptedToolCalls = new WeakSet<AmspRecord>();

/**
 * Marks a complete `tool_call` the implementation closed because its request was interrupted,
 * failed or cut off before the call's own end arrived: the record holds the raw argument
 * text that did arrive, and the engine never dispatches it. The mark lives on this record
 * object in this process only — it is not part of the record and is never serialized; a
 * reader of the stream or the Trace tells such a call from its Request's `request_end.status`.
 * Returns the record, for `yield markInterruptedToolCall(call)`.
 */
export function markInterruptedToolCall<T extends AmspRecord>(record: T): T {
  interruptedToolCalls.add(record);
  return record;
}

/** Whether `record` is a tool call its implementation closed early (`markInterruptedToolCall`). */
export function isInterruptedToolCall(record: AmspRecord): boolean {
  return interruptedToolCalls.has(record);
}

/**
 * A stateful LLM object attached to a Session.
 * `streamGenerate` yields streaming `partial_*` messages as an async generator, and appends the
 * corresponding complete `model_msg` once each item ends — an item still streaming when the
 * request ends early is closed with what had arrived, and such a tool call is marked with
 * `markInterruptedToolCall` so the engine never dispatches it; Token usage is emitted as a
 * `token_usage` event_msg. **Never throws to `context_engine`**: any interruption/exception is
 * closed off in well-formed structure and returned normally, and **must** report the terminal
 * state via `LLMOutcome` — error handling happens entirely inside the LLM interface, and
 * `context_engine` only decides subsequent actions based on the outcome.
 * Docs: /docs/interfaces § "LLMInterface".
 */
export interface LLMInterface {
  streamGenerate(parameters: GenerativeModelParameters): AsyncGenerator<AmspRecord, LLMOutcome>;
  /**
   * The level this object sends when a request names none (its construction default). The
   * engine reads it to resolve each request's effective level once — pin, else this — and
   * both sends that value and records it on the request's `request_begin`, so the record
   * cannot drift from the wire. An implementation without a default may omit it; the engine
   * then sends and records a level only when the Session pins one.
   */
  readonly defaultThinkingLevel?: ThinkingLevelName;
}
