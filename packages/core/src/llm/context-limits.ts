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
 */
import type { OmniMessage } from "../omnimessage/index.js";

/**
 * Assumed context window when a model entry has no positive `context_window` configured.
 * Mirrors the web app's display default (`packages/web/src/lib/context.ts`,
 * `DEFAULT_CONTEXT_WINDOW`) so every consumer of an unknown window reasons from the same
 * number. Models with a *smaller* real window still need `context_window` set on their
 * entry — no derivation can protect a window it doesn't know about.
 */
export const DEFAULT_CONTEXT_WINDOW = 128000;

/**
 * Safety margin (tokens) kept between `estimated input + output cap` and the window.
 * It absorbs what the estimate cannot see: provider-side chat-template and tool-schema
 * serialization overhead, and the error of the character heuristic on input appended since
 * the last real `token_usage`. 1024 comfortably covers those sources while staying
 * negligible against every real window (≥ 8k).
 */
export const OUTPUT_SAFETY_MARGIN = 1024;

/**
 * Floor for the derived output cap: the minimal useful output budget. The clamp never
 * emits a non-positive (or uselessly tiny) `max_tokens` — when the remaining window is
 * smaller than this, compaction should already have fired (its threshold sits
 * `COMPACTION_HEADROOM` below the window); if it hasn't (compaction disabled, or a
 * misconfigured window), a deterministic small cap is still better than sending a
 * negative/zero cap the provider rejects outright. Kept below `OUTPUT_SAFETY_MARGIN` so a
 * floored request still fits inside the window when the input estimate is accurate.
 */
export const MIN_OUTPUT_TOKENS = 512;

/**
 * Headroom (tokens) reserved under the model window when deriving the effective compaction
 * threshold: `OUTPUT_SAFETY_MARGIN` plus ~1k for the summary request's own output (the
 * compaction request runs through the same per-request clamp, so at the trigger point its
 * output budget is about `COMPACTION_HEADROOM − OUTPUT_SAFETY_MARGIN` minus the compaction
 * prompt — reserving less would clamp the summary to the floor and truncate it). On a 32768
 * window this makes compaction fire at ≈ 30720 instead of never (the previous default
 * threshold of 128000 was unreachable inside the window).
 */
export const COMPACTION_HEADROOM = 2048;

/** Flat allowance for an image input: provider vision token counts vary widely (~100–2000+); counting a data URI's base64 characters instead would overestimate a hundredfold. */
const IMAGE_TOKEN_ESTIMATE = 1600;

/** Per-message allowance for chat-template structure (role markers, separators). */
const MESSAGE_OVERHEAD_TOKENS = 8;

/** Resolves a model entry's `context_window` to a usable number: a positive finite number wins, anything else falls back to {@link DEFAULT_CONTEXT_WINDOW}. */
export function resolveContextWindow(contextWindow: unknown): number {
  return typeof contextWindow === "number" && Number.isFinite(contextWindow) && contextWindow > 0
    ? contextWindow
    : DEFAULT_CONTEXT_WINDOW;
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
 * Token estimate for a batch of input messages: images get a flat allowance, everything
 * else is estimated from its serialized payload (covering user text, tool outputs and tool
 * calls uniformly; the JSON syntax counted along the way is a small overestimate — the safe
 * direction), plus a per-message structural allowance.
 */
export function approximateMessagesTokens(messages: OmniMessage[]): number {
  let total = 0;
  for (const msg of messages) {
    const p = msg.payload as { type?: string };
    total += MESSAGE_OVERHEAD_TOKENS;
    if (p.type === "image_url" || p.type === "inline_data") total += IMAGE_TOKEN_ESTIMATE;
    else total += approximateTokens(JSON.stringify(msg.payload));
  }
  return total;
}

/**
 * Effective output-token cap for one request:
 * `min(configured max_tokens, context_window − estimated input − OUTPUT_SAFETY_MARGIN)`,
 * floored at {@link MIN_OUTPUT_TOKENS}.
 *
 * `undefined` when no positive cap is configured — the "no explicit cap" contract (`-1` /
 * unset) is preserved: the key stays off the wire and the provider's own default applies
 * (OpenAI-compatible servers, vLLM included, then bound the output by the remaining window
 * themselves). For big-window models the subtraction stays far above the configured cap, so
 * `min` returns the configured value unchanged — a no-op in practice.
 *
 * The clamp only ever *lowers* a cap: a configured cap already below the floor (a pinned
 * meta budget, say) is returned as-is — raising it would break the "budget is never
 * raised" contract of metaMaxTokens and user-pinned caps.
 */
export function effectiveMaxOutputTokens(
  configured: number | undefined,
  contextWindow: number,
  estimatedInputTokens: number,
): number | undefined {
  if (configured === undefined || configured <= 0) return undefined;
  const remaining = contextWindow - estimatedInputTokens - OUTPUT_SAFETY_MARGIN;
  return Math.max(Math.min(configured, remaining), Math.min(configured, MIN_OUTPUT_TOKENS));
}

/**
 * Effective compaction threshold: the configured `compaction.max_context_length` capped at
 * `context_window − COMPACTION_HEADROOM` — the threshold must stay below the hard window
 * limit by enough to fit the compaction request itself (prompt + summary output + safety
 * margin), otherwise small-window models get rejected by the provider (a non-retryable 400)
 * before compaction even triggers. An unknown window uses {@link DEFAULT_CONTEXT_WINDOW},
 * so even an entry without `context_window` compacts before the assumed 128k mark. Not
 * clamped when `<=0` (compaction disabled — the value keeps its "off" meaning). The derived
 * value is floored at half the window so an absurdly small window can never push the
 * threshold to `<=0` and silently *disable* compaction — the exact opposite of what a small
 * window needs.
 */
export function effectiveMaxContextLength(configured: number, contextWindow: unknown): number {
  if (configured <= 0) return configured;
  const window = resolveContextWindow(contextWindow);
  return Math.min(configured, Math.max(window - COMPACTION_HEADROOM, Math.ceil(window / 2)));
}
