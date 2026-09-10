/**
 * context.ts unit tests: the two upper bounds the app draws against — the model's context
 * window (positive numbers as-is, otherwise the 128000 default) and the compaction threshold
 * the composer's ring fills against — the small-window notice's predicate, and the arithmetic
 * behind the context panel's threshold cutter (pointer to tokens, tokens to bar position).
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONTEXT_WINDOW,
  MIN_COMPACTION_THRESHOLD,
  configuredCompactionLimit,
  contextFillBasis,
  modelWindowBelowCompactionLimit,
  resolveContextWindow,
  snapThreshold,
  thresholdCappedByWindow,
  thresholdFraction,
  thresholdFromPointer,
} from "../src/lib/context";

describe("resolveContextWindow", () => {
  it("positive numbers return as-is", () => {
    expect(resolveContextWindow(200000)).toBe(200000);
    expect(resolveContextWindow(1)).toBe(1);
  });

  it("unset (undefined / null) falls back to the default 128000", () => {
    expect(resolveContextWindow(undefined)).toBe(128000);
    expect(resolveContextWindow(null)).toBe(DEFAULT_CONTEXT_WINDOW);
  });

  it("Trace's model_context_window may be a string: numeric strings parse, `unknown` falls back", () => {
    expect(resolveContextWindow("200000")).toBe(200000);
    expect(resolveContextWindow("unknown")).toBe(128000);
    expect(resolveContextWindow("")).toBe(128000);
  });

  it("non-positive (0 / negative / NaN) falls back to the default", () => {
    expect(resolveContextWindow(0)).toBe(128000);
    expect(resolveContextWindow(-5)).toBe(128000);
    expect(resolveContextWindow(Number.NaN)).toBe(128000);
  });
});

describe("configuredCompactionLimit", () => {
  it("passes a configured threshold through and fills in core's seeded default for none", () => {
    expect(configuredCompactionLimit(120000)).toBe(120000);
    expect(configuredCompactionLimit(undefined)).toBe(256000);
    // "Off" is a configured value like any other and must not be replaced by the default.
    expect(configuredCompactionLimit(0)).toBe(0);
  });
});

describe("contextFillBasis", () => {
  it("is the threshold, not the window, when the window has room for it", () => {
    // The case the ring exists for: a 1M-window model whose Agent compacts at 128k.
    expect(contextFillBasis(128000, 1000000)).toBe(128000);
  });

  it("is the window minus the compaction headroom when the threshold does not fit", () => {
    expect(contextFillBasis(256000, 32768)).toBe(32768 - 2048);
  });

  it("derives from the assumed 128000 window when the model has none", () => {
    expect(contextFillBasis(256000, undefined)).toBe(128000 - 2048);
  });

  it("falls back to the window when compaction is off", () => {
    expect(contextFillBasis(0, 200000)).toBe(200000);
    expect(contextFillBasis(-1, undefined)).toBe(DEFAULT_CONTEXT_WINDOW);
  });

  it("falls back to the window when no Agent config is at hand (the subagent composer)", () => {
    expect(contextFillBasis(undefined, 200000)).toBe(200000);
    expect(contextFillBasis(undefined, undefined)).toBe(DEFAULT_CONTEXT_WINDOW);
  });
});

describe("modelWindowBelowCompactionLimit", () => {
  it("holds when the model cannot reach the Agent's configured threshold", () => {
    expect(modelWindowBelowCompactionLimit(32768, 256000)).toBe(true);
  });

  it("does not hold when the window has room, or the two are equal", () => {
    expect(modelWindowBelowCompactionLimit(1000000, 256000)).toBe(false);
    expect(modelWindowBelowCompactionLimit(256000, 256000)).toBe(false);
  });

  it("stays down with nothing to compare: no window, no config, compaction off", () => {
    expect(modelWindowBelowCompactionLimit(undefined, 256000)).toBe(false);
    expect(modelWindowBelowCompactionLimit(32768, undefined)).toBe(false);
    expect(modelWindowBelowCompactionLimit(32768, 0)).toBe(false);
  });
});

describe("snapThreshold", () => {
  it("rounds onto the 1,000-token lattice", () => {
    expect(snapThreshold(127431, 1000000)).toBe(127000);
    expect(snapThreshold(127500, 1000000)).toBe(128000);
  });

  it("never proposes 0 — that is the configured value meaning 'compaction off'", () => {
    expect(snapThreshold(0, 1000000)).toBe(MIN_COMPACTION_THRESHOLD);
    expect(snapThreshold(-50000, 1000000)).toBe(MIN_COMPACTION_THRESHOLD);
  });

  it("stops at the window itself, not at the nearest step below it", () => {
    // A 32768 window would otherwise leave its own right edge unreachable at 32,000.
    expect(snapThreshold(32768, 32768)).toBe(32768);
    expect(snapThreshold(999999, 32768)).toBe(32768);
  });
});

describe("thresholdFraction", () => {
  it("is the plain ratio against the bar's window scale", () => {
    expect(thresholdFraction(250000, 1000000)).toBe(0.25);
  });

  it("pins a threshold past the window to the right edge instead of dropping the cutter off the bar", () => {
    expect(thresholdFraction(256000, 32768)).toBe(1);
    expect(thresholdFraction(-1, 200000)).toBe(0);
  });
});

describe("thresholdFromPointer", () => {
  it("reads the pointer against the bar's box and snaps the result", () => {
    // Half way along a 200px bar on a 1M window.
    expect(thresholdFromPointer(140, 40, 200, 1000000)).toBe(500000);
  });

  it("clamps a pointer that ran off either end of the bar", () => {
    expect(thresholdFromPointer(1000, 40, 200, 1000000)).toBe(1000000);
    expect(thresholdFromPointer(-1000, 40, 200, 1000000)).toBe(MIN_COMPACTION_THRESHOLD);
  });

  it("an unmeasurable bar yields the floor rather than NaN", () => {
    expect(thresholdFromPointer(140, 40, 0, 1000000)).toBe(MIN_COMPACTION_THRESHOLD);
  });
});

describe("thresholdCappedByWindow", () => {
  it("names the value actually in force when the window cuts the typed one down", () => {
    expect(thresholdCappedByWindow(256000, 32768)).toBe(32768 - 2048);
  });

  it("is null when the typed value is what will run", () => {
    expect(thresholdCappedByWindow(128000, 1000000)).toBeNull();
  });
});
