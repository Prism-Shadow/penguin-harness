/**
 * context.ts unit tests: context window cap resolution (used for the ring
 * cap display) — positive numbers are used as-is, otherwise fall back to
 * the default 128000.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_CONTEXT_WINDOW, resolveContextWindow } from "../src/lib/context";

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
