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
  MIN_USABLE_CONTEXT_WINDOW,
  OUTPUT_SAFETY_MARGIN,
  approximateMessagesTokens,
  approximateTokens,
  effectiveMaxContextLength,
  effectiveMaxOutputTokens,
  resolveContextWindow,
} from "../src/llm/context-limits.js";
import { DEFAULT_MAX_CONTEXT_LENGTH } from "../src/state/default-config.js";
import { toolCallOutput, userText } from "../src/omnimessage/index.js";
import type { OmniMessage } from "../src/omnimessage/index.js";

describe("constant derivation (one tunable: OUTPUT_SAFETY_MARGIN)", () => {
  it("derives the floor and headroom from the margin so their invariants cannot drift", () => {
    // Floor below the margin: a floored request still fits the window when the input
    // estimate is accurate. Headroom above the margin: at the compaction trigger the
    // summary request keeps a usable output budget (~1k), not just the floor.
    expect(MIN_OUTPUT_TOKENS).toBe(Math.floor(OUTPUT_SAFETY_MARGIN / 2));
    expect(COMPACTION_HEADROOM).toBe(OUTPUT_SAFETY_MARGIN * 2);
    expect(COMPACTION_HEADROOM - OUTPUT_SAFETY_MARGIN).toBeGreaterThanOrEqual(1000);
  });
});

describe("resolveContextWindow", () => {
  it("takes a plausible configured window at face value, anything else is unconfigured", () => {
    expect(resolveContextWindow(32768)).toBe(32768);
    expect(resolveContextWindow(MIN_USABLE_CONTEXT_WINDOW)).toBe(MIN_USABLE_CONTEXT_WINDOW);
    expect(resolveContextWindow(undefined)).toBeUndefined();
    expect(resolveContextWindow("unknown")).toBeUndefined();
    expect(resolveContextWindow(0)).toBeUndefined();
    expect(resolveContextWindow(-1)).toBeUndefined();
    expect(resolveContextWindow(Number.NaN)).toBeUndefined();
    // Below the sane minimum = a typo'd window (no real model sits under 4096): treated as
    // unconfigured rather than clamping every request against a bogus number.
    expect(resolveContextWindow(2048)).toBeUndefined();
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
  it("estimates text-bearing payloads from their serialized size", () => {
    const text = userText("x".repeat(400));
    const est = approximateMessagesTokens([text]);
    // ~100 tokens of body + the JSON envelope: a loose sanity band, not an exact figure
    // (the heuristic's contract is "close and erring high").
    expect(est).toBeGreaterThanOrEqual(100);
    expect(est).toBeLessThan(150);
    // Tool outputs go through the same serialized-payload path; a genuinely huge text
    // output still counts as text.
    const big = toolCallOutput({
      output: "y".repeat(120_000),
      toolCallId: "c1",
      stopReason: "completed",
    });
    expect(approximateMessagesTokens([big])).toBeGreaterThanOrEqual(30_000);
  });

  it("gives image payloads a flat allowance instead of counting data-URI characters", () => {
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

  it("counts a tool output's `images` data URLs at the flat allowance, not as base64 text", () => {
    // read_image-style outputs carry the image as tool_call_output.images (data URLs). A
    // 1 MB base64 string serialized as text would estimate ~262k "tokens" (~163x over)
    // and floor the NEXT request's cap even on a 128k window.
    const withImage = toolCallOutput({
      output: "Read image OK (1024x768).",
      toolCallId: "c1",
      stopReason: "completed",
      images: [`data:image/png;base64,${"A".repeat(1_000_000)}`],
    });
    const est = approximateMessagesTokens([withImage]);
    expect(est).toBeLessThan(2000); // flat image allowance + a small text payload
    expect(est).toBeGreaterThan(1600 - 1);
    // Two images: two allowances.
    const twoImages = toolCallOutput({
      output: "ok",
      toolCallId: "c2",
      stopReason: "completed",
      images: [
        `data:image/png;base64,${"A".repeat(500_000)}`,
        `data:image/jpeg;base64,${"B".repeat(500_000)}`,
      ],
    });
    expect(approximateMessagesTokens([twoImages])).toBeLessThan(3400);
    expect(approximateMessagesTokens([twoImages])).toBeGreaterThan(3200 - 1);
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

  it("does not clamp without a configured window: no hard cap from an assumption", () => {
    // An entry without context_window used to derive a clamp from the assumed 128000;
    // with compaction disabled that pinned the cap to the floor past ~127k of real
    // context on a model that used to work. Unconfigured window = configured cap as-is.
    expect(effectiveMaxOutputTokens(32000, undefined, 500_000)).toBe(32000);
    expect(effectiveMaxOutputTokens(32000, undefined, 10)).toBe(32000);
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
    // A 32k window compacts at ~30.7k rather than at a configured threshold it can never reach.
    expect(effectiveMaxContextLength(128000, 32768)).toBe(32768 - COMPACTION_HEADROOM);
    expect(effectiveMaxContextLength(128000, 200000)).toBe(128000); // ample window: unchanged
    expect(effectiveMaxContextLength(8000, 32768)).toBe(8000); // tighter user setting wins
    // A window at the sanity minimum still derives a positive threshold, so a usable
    // window can never flip the value into the "<=0 disables" contract.
    expect(effectiveMaxContextLength(128000, MIN_USABLE_CONTEXT_WINDOW)).toBe(
      MIN_USABLE_CONTEXT_WINDOW - COMPACTION_HEADROOM,
    );
  });

  it("derives from DEFAULT_CONTEXT_WINDOW when the window is unconfigured or implausible", () => {
    expect(effectiveMaxContextLength(128000, undefined)).toBe(
      DEFAULT_CONTEXT_WINDOW - COMPACTION_HEADROOM,
    );
    expect(effectiveMaxContextLength(128000, "unknown")).toBe(
      DEFAULT_CONTEXT_WINDOW - COMPACTION_HEADROOM,
    );
    // A typo'd tiny window counts as unconfigured (resolveContextWindow's sanity
    // threshold): the threshold derives from the assumption instead of collapsing to a
    // near-zero value that would compact after every request.
    expect(effectiveMaxContextLength(128000, 2048)).toBe(
      DEFAULT_CONTEXT_WINDOW - COMPACTION_HEADROOM,
    );
  });

  // The seeded threshold is deliberately larger than any current model window: what actually
  // bounds compaction is the model's own context_window, so this covers the shipped value
  // rather than a stand-in for it.
  it("backstops the seeded default threshold with the model's context window", () => {
    // Windows smaller than the seeded threshold: the window decides, and always leaves
    // COMPACTION_HEADROOM for the summary request itself.
    expect(effectiveMaxContextLength(DEFAULT_MAX_CONTEXT_LENGTH, 32768)).toBe(
      32768 - COMPACTION_HEADROOM,
    );
    expect(effectiveMaxContextLength(DEFAULT_MAX_CONTEXT_LENGTH, 200000)).toBe(
      200000 - COMPACTION_HEADROOM,
    );
    // No usable window on the entry: the assumed window backstops it just the same, which is
    // where the two 128000s must not be confused — this is DEFAULT_CONTEXT_WINDOW, not a
    // threshold default.
    expect(effectiveMaxContextLength(DEFAULT_MAX_CONTEXT_LENGTH, undefined)).toBe(
      DEFAULT_CONTEXT_WINDOW - COMPACTION_HEADROOM,
    );
    expect(effectiveMaxContextLength(DEFAULT_MAX_CONTEXT_LENGTH, 2048)).toBe(
      DEFAULT_CONTEXT_WINDOW - COMPACTION_HEADROOM,
    );
    // A window roomier than the threshold leaves it alone — the only case where the
    // configured number is what fires.
    expect(effectiveMaxContextLength(DEFAULT_MAX_CONTEXT_LENGTH, 1_000_000)).toBe(
      DEFAULT_MAX_CONTEXT_LENGTH,
    );
    expect(DEFAULT_MAX_CONTEXT_LENGTH).toBeGreaterThan(DEFAULT_CONTEXT_WINDOW);
  });

  it("keeps <=0 as 'compaction disabled'", () => {
    expect(effectiveMaxContextLength(-1, 32768)).toBe(-1); // off: no clamping
    expect(effectiveMaxContextLength(0, 32768)).toBe(0); // off: no clamping
  });
});
