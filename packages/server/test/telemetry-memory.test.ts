/**
 * The memoryCost estimate (telemetry/memory.ts): it grows with content, counts a shared
 * object once, and terminates on a cycle.
 */
import { describe, expect, it } from "vitest";
import { estimateBytes } from "../src/telemetry/memory.js";

describe("estimateBytes", () => {
  it("grows with the content it holds", () => {
    const short = [{ role: "user", text: "hi" }];
    const long = [{ role: "user", text: "hi".repeat(1000) }];
    expect(estimateBytes(long) - estimateBytes(short)).toBe(2 * 2 * 999);
  });

  it("counts a shared object once and stops on a cycle", () => {
    const part = { text: "x".repeat(100) };
    expect(estimateBytes([part, part])).toBeLessThan(2 * estimateBytes([part]));
    const cyclic: Record<string, unknown> = { text: "y" };
    cyclic.self = cyclic;
    expect(estimateBytes(cyclic)).toBeGreaterThan(0);
  });
});
