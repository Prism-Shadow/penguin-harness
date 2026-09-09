/**
 * context.ts unit tests: the two upper bounds the app draws against — the model's context
 * window (positive numbers as-is, otherwise the 128000 default) and the compaction threshold
 * the composer's ring fills against — plus the small-window notice's predicate.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONTEXT_WINDOW,
  configuredCompactionLimit,
  contextFillBasis,
  modelWindowBelowCompactionLimit,
  resolveContextWindow,
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
