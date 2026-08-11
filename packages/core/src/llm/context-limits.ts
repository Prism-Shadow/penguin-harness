/**
 * Window-derived request limits (issue #218) — pure arithmetic shared by the per-request
 * output-token clamp (GenerativeModel) and the compaction-threshold derivation (Agent).
 *
 * The problem both solve: a model entry's `max_tokens` and the Agent's
 * `compaction.max_context_length` are fixed numbers, while the space they must fit into is
 * the model's `context_window` minus whatever the input already occupies. Small-window
 * models (a local vLLM with `--max-model-len 32768`, say) reject any request whose
 * `input + max_tokens` exceeds the window with a non-retryable 400 — with the seeded
 * per-Agent `max_tokens` of 32000 that is *every* request, before compaction ever gets a
 * chance to run. Everything here is derived at use from the configured values; stored
 * config is never rewritten.
 *
 * `OUTPUT_SAFETY_MARGIN` is the single tunable of the margin story: the output floor and
 * the compaction headroom are derived from it (PR #235 review), so their invariants —
 * floor below margin, headroom above margin — cannot drift apart. The two remaining
 * independent facts are `DEFAULT_CONTEXT_WINDOW` and `IMAGE_TOKEN_ESTIMATE`.
 *
 * Thinking-level interaction (considered, out of scope): on a high-reasoning session a
 * small derived cap can be consumed by thinking tokens before any visible answer, ending
 * the request as length -> failed. The arithmetic has no notion of the thinking level;
 * the compaction threshold firing `COMPACTION_HEADROOM` below the window keeps caps from
 * staying small for long, which bounds the exposure.
 */
import type { OmniMessage } from "../omnimessage/index.js";

/**
 * Assumed context window when a model entry has no usable `context_window` configured.
 * Mirrors the web app's display default (`packages/web/src/lib/context.ts`,
 * `DEFAULT_CONTEXT_WINDOW`) so every consumer of an unknown window reasons from the same
 * number. Only the compaction-threshold derivation uses this assumption; the per-request
 * output clamp is disabled without a configured window (see effectiveMaxOutputTokens).
 * Models with a *smaller* real window still need `context_window` set on their entry —
 * no derivation can protect a window it doesn't know about.
 */
export const DEFAULT_CONTEXT_WINDOW = 128000;

/**
 * Smallest `context_window` value taken at face value. Anything below is treated as
 * unconfigured (no real model has a window under 4096; such values are typos or unit
 * mistakes), which routes the derivations to their unconfigured behavior instead of
 * clamping every request into uselessness against a bogus number.
 */
export const MIN_USABLE_CONTEXT_WINDOW = 4096;

/**
 * Safety margin (tokens) kept between `estimated input + output cap` and the window.
 * It absorbs what the estimate cannot see: provider-side chat-template and tool-schema
 * serialization overhead, and the error of the character heuristic on input appended since
 * the last real `token_usage`. 1024 comfortably covers those sources while staying
 * negligible against every real window (>= 8k).
 */
export const OUTPUT_SAFETY_MARGIN = 1024;

/**
 * Floor for the derived output cap: the minimal useful output budget. The clamp never
 * emits a non-positive (or uselessly tiny) `max_tokens` — when the remaining window is
 * smaller than this, compaction should already have fired (its threshold sits
 * `COMPACTION_HEADROOM` below the window); if it hasn't (compaction disabled, or a
 * misconfigured window), a deterministic small cap is still better than sending a
 * negative/zero cap the provider rejects outright. Derived at half the margin so a
 * floored request still fits inside the window when the input estimate is accurate.
 */
export const MIN_OUTPUT_TOKENS = Math.floor(OUTPUT_SAFETY_MARGIN / 2);

/**
 * Headroom (tokens) reserved under the model window when deriving the effective compaction
 * threshold: one `OUTPUT_SAFETY_MARGIN` for the margin itself plus the same again (~1k)
 * for the summary request's own output — the compaction request runs through the same
 * per-request clamp, so at the trigger point its output budget is about
 * `COMPACTION_HEADROOM − OUTPUT_SAFETY_MARGIN` minus the compaction prompt; reserving less
 * would clamp the summary to the floor and truncate it. On a 32768 window this makes
 * compaction fire at ≈ 30720 instead of never (the previous default threshold of 128000
 * was unreachable inside the window).
 */
export const COMPACTION_HEADROOM = OUTPUT_SAFETY_MARGIN * 2;

/**
 * Flat allowance for one image input: provider vision token counts vary widely
 * (~100–2000+); counting a data URI's base64 characters instead would overestimate a
 * hundredfold.
 */
const IMAGE_TOKEN_ESTIMATE = 1600;

/**
 * Resolves a model entry's `context_window` to a usable number: a finite number at or
 * above {@link MIN_USABLE_CONTEXT_WINDOW} wins; anything else — unset, non-numeric,
 * non-positive, or implausibly small — is `undefined` ("unconfigured"). Callers decide
 * what unconfigured means for them: the output clamp switches itself off, the compaction
 * derivation falls back to {@link DEFAULT_CONTEXT_WINDOW}.
 */
export function resolveContextWindow(contextWindow: unknown): number | undefined {
  return typeof contextWindow === "number" &&
    Number.isFinite(contextWindow) &&
    contextWindow >= MIN_USABLE_CONTEXT_WINDOW
    ? contextWindow
    : undefined;
}

/**
 * Crude token estimate for a text: ASCII at ~4 characters per token, everything else
 * (CJK etc.) at 1 token per character. Deliberately a character heuristic, not a
 * tokenizer — it only ever feeds derivations that keep {@link OUTPUT_SAFETY_MARGIN} in
 * reserve, and the non-ASCII bucket errs high (safe direction: a high input estimate
 * shrinks the output cap, a low one risks a provider 400).
 */
export function approximateTokens(text: string): number {
  let ascii = 0;
  let wide = 0;
  for (const ch of text) {
    if ((ch.codePointAt(0) ?? 0) < 0x80) ascii += 1;
    else wide += 1;
  }
  return Math.ceil(ascii / 4) + wide;
}

/**
 * Token estimate for a batch of input messages: image content gets a flat allowance,
 * everything else is estimated from its serialized payload (covering user text, tool
 * outputs and tool calls uniformly; the JSON syntax counted along the way is a small
 * overestimate — the safe direction, and it also stands in for chat-template structure).
 *
 * Images appear in two shapes and both must bypass the character count: as a payload of
 * their own (`image_url` / `inline_data`), and as the `images` array of data URLs riding
 * on a tool output (complete or partial — `read_image` and screenshot-returning tools).
 * Serializing those data URLs would count every base64 character: a 1 MB image would
 * estimate ≈ 262k "tokens" (~163x over) and floor the next request's output cap even on a
 * 128k window (PR #235 review).
 */
export function approximateMessagesTokens(messages: OmniMessage[]): number {
  let total = 0;
  for (const msg of messages) {
    const p = msg.payload as { type?: string; images?: unknown };
    if (p.type === "image_url" || p.type === "inline_data") {
      total += IMAGE_TOKEN_ESTIMATE;
    } else if (Array.isArray(p.images)) {
      const { images, ...rest } = p as { images: unknown[] };
      total += images.length * IMAGE_TOKEN_ESTIMATE + approximateTokens(JSON.stringify(rest));
    } else {
      total += approximateTokens(JSON.stringify(msg.payload));
    }
  }
  return total;
}

/**
 * Effective output-token cap for one request:
 * `min(configured max_tokens, max(context_window − estimated input − OUTPUT_SAFETY_MARGIN,
 * MIN_OUTPUT_TOKENS))` — floor the remaining window, then never exceed the configured cap,
 * so the clamp only ever *lowers* a cap (a configured cap already below the floor, e.g. a
 * pinned meta budget, comes back verbatim).
 *
 * `undefined` when no positive cap is configured — the "no explicit cap" contract (`-1` /
 * unset) is preserved: the key stays off the wire and the provider's own default applies
 * (OpenAI-compatible servers, vLLM included, then bound the output by the remaining window
 * themselves). With no usable `contextWindow` the configured cap is returned unchanged:
 * a hard per-request clamp must not be derived from an assumption — a large-window model
 * whose entry simply omits `context_window` would otherwise get its outputs floored past
 * the assumed mark when compaction is disabled (PR #235 review). For big-window models the
 * subtraction stays far above the configured cap, so `min` returns it unchanged — a no-op
 * in practice.
 */
export function effectiveMaxOutputTokens(
  configured: number | undefined,
  contextWindow: number | undefined,
  estimatedInputTokens: number,
): number | undefined {
  if (configured === undefined || configured <= 0) return undefined;
  if (contextWindow === undefined) return configured;
  const remaining = contextWindow - estimatedInputTokens - OUTPUT_SAFETY_MARGIN;
  return Math.min(configured, Math.max(remaining, MIN_OUTPUT_TOKENS));
}

/**
 * Effective compaction threshold: the configured `compaction.max_context_length` capped at
 * `context_window − COMPACTION_HEADROOM` — the threshold must stay below the hard window
 * limit by enough to fit the compaction request itself (prompt + summary output + safety
 * margin), otherwise small-window models get rejected by the provider (a non-retryable
 * 400) before compaction even triggers. An unconfigured window (unset, or below
 * {@link MIN_USABLE_CONTEXT_WINDOW}) derives from {@link DEFAULT_CONTEXT_WINDOW}: unlike
 * the output clamp, a threshold derived from the assumption is harmless-to-helpful — it
 * only makes compaction fire by the assumed mark. Not clamped when `<=0` (compaction
 * disabled — the value keeps its "off" meaning); with every usable window at least
 * `MIN_USABLE_CONTEXT_WINDOW`, the derived threshold is always positive and can never
 * silently flip into the "disabled" contract.
 */
export function effectiveMaxContextLength(configured: number, contextWindow: unknown): number {
  if (configured <= 0) return configured;
  const window = resolveContextWindow(contextWindow) ?? DEFAULT_CONTEXT_WINDOW;
  return Math.min(configured, window - COMPACTION_HEADROOM);
}
