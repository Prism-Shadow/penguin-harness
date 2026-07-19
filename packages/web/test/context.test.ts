/**
 * context.ts unit tests: context window cap resolution (used for the ring
 * cap display) — positive numbers are used as-is, otherwise fall back to
 * the default 128000.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_CONTEXT_WINDOW, resolveContextWindow } from "../src/lib/context";

describe("resolveContextWindow", () => {
  it("正数原样返回", () => {
    expect(resolveContextWindow(200000)).toBe(200000);
    expect(resolveContextWindow(1)).toBe(1);
  });

  it("未配置（undefined / null）回退缺省 128000", () => {
    expect(resolveContextWindow(undefined)).toBe(128000);
    expect(resolveContextWindow(null)).toBe(DEFAULT_CONTEXT_WINDOW);
  });

  it("Trace 的 model_context_window 可能是字符串：数字串解析、`unknown` 回退", () => {
    expect(resolveContextWindow("200000")).toBe(200000);
    expect(resolveContextWindow("unknown")).toBe(128000);
    expect(resolveContextWindow("")).toBe(128000);
  });

  it("非正数（0 / 负数 / NaN）回退缺省", () => {
    expect(resolveContextWindow(0)).toBe(128000);
    expect(resolveContextWindow(-5)).toBe(128000);
    expect(resolveContextWindow(Number.NaN)).toBe(128000);
  });
});
