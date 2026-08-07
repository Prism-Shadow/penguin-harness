/**
 * Window-derived request limits (llm/context-limits.ts, issue #218): the per-request
 * output-cap arithmetic, the input-size estimator it feeds on, and the window-derived
 * compaction threshold. All pure functions — no timers, no network.
 */
import { describe, expect, it } from "vitest";
import {
  COMPACTION_HEADROOM,
  DEFAULT_CONTEXT_WINDOW,
  MIN_OUTPUT_TOKENS,
  OUTPUT_SAFETY_MARGIN,
  approximateMessagesTokens,
  approximateTokens,
  effectiveMaxContextLength,
  effectiveMaxOutputTokens,
  resolveContextWindow,
} from "../src/llm/context-limits.js";
import { toolCallOutput, userText } from "../src/omnimessage/index.js";
import type { OmniMessage } from "../src/omnimessage/index.js";

describe("resolveContextWindow", () => {
  it("uses a positive number and falls back to the 128000 default otherwise", () => {
    expect(resolveContextWindow(32768)).toBe(32768);
    expect(resolveContextWindow(undefined)).toBe(DEFAULT_CONTEXT_WINDOW);
    expect(resolveContextWindow("unknown")).toBe(DEFAULT_CONTEXT_WINDOW);
    expect(resolveContextWindow(0)).toBe(DEFAULT_CONTEXT_WINDOW);
    expect(resolveContextWindow(-1)).toBe(DEFAULT_CONTEXT_WINDOW);
    expect(resolveContextWindow(Number.NaN)).toBe(DEFAULT_CONTEXT_WINDOW);
  });
});

describe("approximateTokens (character heuristic, not a tokenizer)", () => {
  it("counts ASCII at ~4 chars/token and non-ASCII at 1 token/char", () => {
    expect(approximateTokens("")).toBe(0);
    expect(approximateTokens("abcd")).toBe(1);
    expect(approximateTokens("abcde")).toBe(2); // ceil(5/4)
    // CJK errs high on purpose: underestimating input risks a provider 400.
    expect(approximateTokens("你好世界")).toBe(4);
    expect(approximateTokens("ab你好")).toBe(3); // ceil(2/4) + 2
  });
});

describe("approximateMessagesTokens", () => {
  it("estimates text-bearing payloads from their serialized size plus per-message overhead", () => {
    const text = userText("x".repeat(400));
    const est = approximateMessagesTokens([text]);
    // ~100 tokens of body + JSON envelope + the flat message overhead: a loose sanity
    // band, not an exact figure (the heuristic's contract is "close and erring high").
    expect(est).toBeGreaterThanOrEqual(100);
    expect(est).toBeLessThan(150);
    // Tool outputs go through the same serialized-payload path.
    const out = toolCallOutput({
      output: "y".repeat(400),
      toolCallId: "c1",
      stopReason: "completed",
    });
    expect(approximateMessagesTokens([out])).toBeGreaterThanOrEqual(100);
  });

  it("gives images a flat allowance instead of counting data-URI characters", () => {
    const image = {
      type: "model_msg",
      payload: {
        type: "image_url",
        role: "user",
        image_url: `data:image/png;base64,${"A".repeat(100_000)}`,
      },
    } as unknown as OmniMessage;
    const est = approximateMessagesTokens([image]);
    // 100k base64 chars would be ~25k "tokens" by the char heuristic; the flat allowance
    // stays in the low thousands so one pasted screenshot cannot floor the output cap.
    expect(est).toBeLessThan(2000);
    expect(est).toBeGreaterThan(1000);
  });
});

describe("effectiveMaxOutputTokens (per-request output clamp)", () => {
  it("is a no-op for big-window models: the configured cap comes back unchanged", () => {
    expect(effectiveMaxOutputTokens(32000, 1_000_000, 50_000)).toBe(32000);
    expect(effectiveMaxOutputTokens(32000, DEFAULT_CONTEXT_WINDOW, 10_000)).toBe(32000);
  });

  it("keeps the no-explicit-cap contract: unset or non-positive stays undefined", () => {
    expect(effectiveMaxOutputTokens(undefined, 32768, 1000)).toBeUndefined();
    expect(effectiveMaxOutputTokens(-1, 32768, 1000)).toBeUndefined();
    expect(effectiveMaxOutputTokens(0, 32768, 1000)).toBeUndefined();
  });

  it("clamps so estimated input + cap + margin fits the window (the issue #218 report)", () => {
    // The reported failure: window 32768, configured cap 32000, prompt ~769 tokens —
    // the fixed cap overflowed the window on the very first request.
    const cap = effectiveMaxOutputTokens(32000, 32768, 769)!;
    expect(cap).toBe(32768 - 769 - OUTPUT_SAFETY_MARGIN);
    expect(769 + cap + OUTPUT_SAFETY_MARGIN).toBeLessThanOrEqual(32768);
    // The margin binds exactly: one token less input buys one token more cap.
    expect(effectiveMaxOutputTokens(32000, 32768, 768)).toBe(cap + 1);
  });

  it("floors at MIN_OUTPUT_TOKENS instead of emitting a non-positive cap (degenerate case)", () => {
    // Remaining window smaller than the floor — compaction should have fired long before
    // this point; the deterministic floor beats sending max_tokens <= 0.
    expect(effectiveMaxOutputTokens(32000, 32768, 32_500)).toBe(MIN_OUTPUT_TOKENS);
    expect(effectiveMaxOutputTokens(32000, 32768, 99_999)).toBe(MIN_OUTPUT_TOKENS);
    // The floor stays below the safety margin, so a floored request still fits the window
    // whenever the input estimate is accurate.
    expect(MIN_OUTPUT_TOKENS).toBeLessThanOrEqual(OUTPUT_SAFETY_MARGIN);
  });

  it("only ever lowers a cap: a configured cap below the floor is never raised", () => {
    // A pinned meta budget (metaMaxTokens can hand a cap as small as the user pinned it)
    // must come back verbatim — the clamp lowers caps, it never raises them.
    expect(effectiveMaxOutputTokens(128, 1_000_000, 100)).toBe(128);
    expect(effectiveMaxOutputTokens(128, 32768, 99_999)).toBe(128); // degenerate: still the configured cap
  });
});

describe("effectiveMaxContextLength (window-derived compaction threshold)", () => {
  it("caps the configured threshold at context_window − COMPACTION_HEADROOM", () => {
    // 32k window: compaction now fires at ~30.7k instead of never (the 128000 default was
    // unreachable inside the window).
    expect(effectiveMaxContextLength(128000, 32768)).toBe(32768 - COMPACTION_HEADROOM);
    expect(effectiveMaxContextLength(128000, 200000)).toBe(128000); // ample window: unchanged
    expect(effectiveMaxContextLength(8000, 32768)).toBe(8000); // tighter user setting wins
  });

  it("derives from the 128000 default when the window is unknown", () => {
    expect(effectiveMaxContextLength(128000, undefined)).toBe(
      DEFAULT_CONTEXT_WINDOW - COMPACTION_HEADROOM,
    );
    expect(effectiveMaxContextLength(128000, "unknown")).toBe(
      DEFAULT_CONTEXT_WINDOW - COMPACTION_HEADROOM,
    );
  });

  it("keeps <=0 as 'compaction disabled' and never derives a threshold that disables it", () => {
    expect(effectiveMaxContextLength(-1, 32768)).toBe(-1); // off: no clamping
    expect(effectiveMaxContextLength(0, 32768)).toBe(0); // off: no clamping
    // An absurdly small window must not push the derived threshold to <=0 (which would
    // silently *disable* compaction): the derivation floors at half the window.
    expect(effectiveMaxContextLength(128000, 2048)).toBe(1024);
    expect(effectiveMaxContextLength(128000, COMPACTION_HEADROOM)).toBeGreaterThan(0);
  });

  it("keeps the headroom large enough for a usable summary at the trigger point", () => {
    // At the trigger the compaction request's own output budget is about
    // COMPACTION_HEADROOM − OUTPUT_SAFETY_MARGIN (minus the compaction prompt): the
    // reserve must leave a usable summary budget (~1k), not just the floor.
    expect(COMPACTION_HEADROOM - OUTPUT_SAFETY_MARGIN).toBeGreaterThanOrEqual(1000);
  });
});
