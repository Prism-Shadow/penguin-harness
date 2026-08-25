/**
 * What the LLM side needs: the contract `context_engine` drives one model request through.
 *
 * The engine calls exactly one method here — `streamGenerate` — and reads exactly two things
 * back: the yielded OmniMessage stream, and the generator's `LLMOutcome` return value (the
 * request's terminal state; see the docs page's "control plane"). Protocol conversion to and
 * from the provider is the implementation's own business.
 *
 * Docs: packages/docs/content/interfaces.{zh,en}.md (site path /docs/interfaces).
 */
import type { OmniMessage, StopReason, ToolDefinition } from "../omnimessage/types.js";
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
  baseUrl?: string;
  /**
   * AgentHub client protocol (`openai-chat` / `openai-responses` / `claude-4-8` /
   * `deepseek-v4` / …; the bare `openai` spelling is a deprecated alias of `openai-chat`). If
   * omitted, AgentHub infers it from `modelId`; custom-named models or third-party models
   * using an OpenAI protocol must specify it explicitly.
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
   * request opts into the provider's faster serving tier at premium pricing (AgentHub
   * UniConfig `fast_mode`). Off by default. Models without a fast tier reject the parameter
   * before any network I/O (AgentHub `UnsupportedParameterError`); `streamGenerate` reports
   * that as a permanent `failed` outcome so the engine surfaces it instead of retrying.
   */
  fastMode?: boolean;
  /** Construction-time default thinking level; a per-request `GenerativeModelParameters.thinkingLevel` overrides it for that request. */
  thinkingLevel?: ThinkingLevelName;
  /** LLM Request timeout (ms): from system_config.model.timeoutMs; <=0 disables it. Defaults to 120000. */
  requestTimeoutMs?: number;
  /**
   * tool_call_id uniqueness registry (Session-level). Pass the same instance when rebuilding a new
   * GenerativeModel on compaction so the uniqueness scope covers the whole Session; defaults to a fresh
   * one. See llm/tool-call-ids.ts.
   */
  toolCallIds?: ToolCallIdAllocator;
}

export interface GenerativeModelParameters {
  /** OmniMessage array for the input newly added this turn; implementations must merge it into a single UniMessage (multiple roles not accepted). */
  newMessages: OmniMessage[];
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
 * async generator (not a yielded message). The status values share the same six-value protocol
 * as OmniMessage `stop_reason`:
 *   - `completed`: finished normally (already produced `token_usage`);
 *   - `timeout`: LLM timed out or lost connection, needs reconnect — retried by `context_engine`
 *     within the same run;
 *   - `malformed`: AgentHub response failed JSON parsing, needs reconnect — also retried by
 *     `context_engine`;
 *   - `aborted`: user-initiated interruption — stop and hand back to the user;
 *   - `failed`: an error the retry classifier did not judge transient (params, etc.) — still
 *     retried by `context_engine` within the same run (`errorMessage` provides the display text).
 *     The classification stays honest — this is reported as `failed`, not relabelled a
 *     timeout — while the *policy* retries it, because that classifier is an allowlist and a
 *     gateway phrasing a transient fault its own way lands here;
 *   - `auth`: the provider rejected the credentials (see `isAuthenticationError`) — the one
 *     status that stops the run outright, since no retry can turn a rejected credential into
 *     a working one; hosts also key on it to disable input until the model's API key is
 *     updated (only the model reference is fixed at Session creation; credentials come from
 *     the current Project config, so a key update lets the Session continue).
 * Docs: /docs/interfaces § "LLMOutcome semantics".
 */
export interface LLMOutcome {
  status: StopReason;
  /**
   * Error detail (`describeError` text): present on `failed` / `auth`, and on `timeout` /
   * `malformed` when a concrete transport/provider error was caught (a plain idle timeout
   * has none). Carried onto the `request_end` event as `error_message` — one name across
   * the internal outcome and the wire — so observability (the Cost center's errors panel)
   * can show the real reason behind a retried request.
   */
  errorMessage?: string;
  /**
   * Marks a `failed` outcome as deterministic: a client-side rejection thrown before any
   * network I/O (currently AgentHub's `UnsupportedParameterError` for `fast_mode` on a model
   * without a fast tier), which the identical request can never retry into working. The
   * engine skips the reconnect ladder for it and aborts the run with `errorMessage` — the
   * same terminal handling as `auth`, but the fix is a config change (turn off fast mode for
   * the model), not a credential update, so it stays a `failed` and hosts don't gate input.
   */
  permanent?: boolean;
}

/**
 * A stateful LLM object attached to a Session.
 * `streamGenerate` yields streaming `partial_*` messages as an async generator, and appends the
 * corresponding complete `model_msg` once each fragment ends; Token usage is emitted as a
 * `token_usage` event_msg. **Never throws to `context_engine`**: any interruption/exception is
 * closed off in well-formed structure and returned normally, and **must** report the terminal
 * state via `LLMOutcome` — error handling happens entirely inside the LLM interface, and
 * `context_engine` only decides subsequent actions based on the outcome.
 * Docs: /docs/interfaces § "LLMInterface".
 */
export interface LLMInterface {
  streamGenerate(parameters: GenerativeModelParameters): AsyncGenerator<OmniMessage, LLMOutcome>;
}
