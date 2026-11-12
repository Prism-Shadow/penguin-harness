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
 * `OUTPUT_SAFETY_MARGIN` is the tunable of the per-request margin: the output floor is derived
 * from it (PR #235 review), so the floor cannot drift above the margin. The compaction room
 * under the window ({@link compactionReserve}, {@link COMPACTION_ROUND_ROOM}) is its own fact,
 * as are `DEFAULT_CONTEXT_WINDOW`, `DEFAULT_MAX_CONTEXT_LENGTH` and `IMAGE_TOKEN_ESTIMATE`.
 *
 * Thinking-level interaction (considered, out of scope): on a high-reasoning session a
 * small derived cap can be consumed by thinking tokens before any visible answer, ending
 * the request as length -> failed. The arithmetic has no notion of the thinking level;
 * the compaction threshold firing the reserve below the window keeps caps from staying
 * small for long, which bounds the exposure.
 */
import type { AmspRecord } from "@prismshadow/amsp/records";

/**
 * Assumed context window when a model entry has no usable `context_window` configured.
 * Mirrors the web app's display default (`packages/web/src/lib/context.ts`,
 * `DEFAULT_CONTEXT_WINDOW`) so every consumer of an unknown window reasons from the same
 * number. Only the compaction-threshold derivation uses this assumption; the per-request
 * output clamp is disabled without a configured window (see effectiveMaxOutputTokens).
 * Models with a *smaller* real window still need `context_window` set on their entry —
 * no derivation can protect a window it doesn't know about.
 *
 * Not {@link DEFAULT_MAX_CONTEXT_LENGTH}, the compaction-threshold default below — a separate
 * number that happens to concern the same axis. The seeded threshold sits above this
 * assumption, so an entry without a usable `context_window` effectively compacts at
 * `DEFAULT_CONTEXT_WINDOW − compactionReserve(DEFAULT_CONTEXT_WINDOW)` (112000).
 */
export const DEFAULT_CONTEXT_WINDOW = 128000;

/**
 * Seeded `compaction.max_context_length`: the context-token threshold newly created Agents
 * start with, and the value {@link effectiveMaxContextLength}'s callers substitute for an Agent
 * whose config carries none. Set high on purpose, because the model's own `context_window` is
 * the backstop: the effective threshold is the smaller of this value and the window minus
 * {@link compactionReserve}, taken at use. A window with no room for this value plus that
 * reserve therefore decides the trigger point, so a small-window model still compacts inside
 * its window rather than never; on a roomier window (288768 tokens and up) this value is what
 * fires. A model entry with no usable `context_window` falls back to
 * {@link DEFAULT_CONTEXT_WINDOW}, which is a different number from this one and must not be
 * conflated with it.
 *
 * Lives beside the derivation rather than with the rest of the seeded config, so that both
 * halves of the threshold rule — the default and the cap applied to it — reach a browser
 * bundle through one dependency-free module: the web app draws the composer's context ring
 * against this same effective threshold and must not re-derive either number.
 *
 * Persisted per-agent in system_config.yaml — existing agents keep their stored value.
 */
export const DEFAULT_MAX_CONTEXT_LENGTH = 256000;

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
 * {@link compactionReserve} below the window); if it hasn't (compaction disabled, or a
 * misconfigured window), a deterministic small cap is still better than sending a
 * negative/zero cap the provider rejects outright. Derived at half the margin so a
 * floored request still fits inside the window when the input estimate is accurate.
 */
export const MIN_OUTPUT_TOKENS = Math.floor(OUTPUT_SAFETY_MARGIN / 2);

/** Smallest {@link compactionReserve}: what a 64k window or a smaller one keeps under it. */
export const COMPACTION_RESERVE_MIN = 8192;
/** Largest {@link compactionReserve}: what a 256k window or a larger one keeps under it. */
export const COMPACTION_RESERVE_MAX = 32768;

/**
 * Room under the window a compaction needs: the turn's pending outputs, the Prompt, the margin,
 * and output for a sectioned summary and hand-off files rather than the floor (the compaction
 * request runs through the same per-request clamp as any other). On a 32768 window this makes
 * compaction fire at 24576 instead of never — the seeded default threshold
 * ({@link DEFAULT_MAX_CONTEXT_LENGTH}, 256000) sits far outside such a window, so without this cap
 * the window's hard limit would always be hit first.
 */
export function compactionReserve(window: number): number {
  const reserve = Math.min(
    COMPACTION_RESERVE_MAX,
    Math.max(COMPACTION_RESERVE_MIN, Math.floor(window / 8)),
  );
  // Never more than half the window: the smallest usable windows (4096–16384) keep a positive
  // threshold instead of falling into the `<= 0` range that means compaction is off.
  return Math.min(reserve, Math.floor(window / 2));
}

/** Room a tool round needs to leave for the summary that follows it. */
export const COMPACTION_ROUND_ROOM = 12288;

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
 * on a tool output (complete or partial — `read_file` on an image and screenshot-returning tools).
 * Serializing those data URLs would count every base64 character: a 1 MB image would
 * estimate ≈ 262k "tokens" (~163x over) and floor the next request's output cap even on a
 * 128k window (PR #235 review).
 */
export function approximateMessagesTokens(messages: AmspRecord[]): number {
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
 * `context_window − compactionReserve(context_window)` — the threshold must stay below the
 * hard window limit by enough to fit the compaction itself, otherwise small-window models get
 * rejected by the provider (a non-retryable 400) before compaction even triggers, or their
 * summary is clamped to a stub. An unconfigured window (unset, or below
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
  return Math.min(configured, window - compactionReserve(window));
}

/**
 * The context size past which a compaction opens no further tool round
 * (`CompactionSettings.roundLimit`); `undefined` for an unconfigured window — like the output
 * clamp, a hard rule is not derived from an assumption (`compaction.max_rounds` still bounds).
 */
export function compactionRoundLimit(contextWindow: unknown): number | undefined {
  const window = resolveContextWindow(contextWindow);
  return window === undefined ? undefined : window - COMPACTION_ROUND_ROOM;
}
