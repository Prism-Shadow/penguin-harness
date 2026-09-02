import { describe, expect, it } from "vitest";
import { UNLIMITED_BUDGET, parseBudgetInput } from "../src/features/chat/goal-use";

describe("parseBudgetInput", () => {
  it("treats empty input as unlimited and parses k/m suffixes", () => {
    expect(parseBudgetInput("")).toBe(UNLIMITED_BUDGET);
    expect(parseBudgetInput("   ")).toBe(UNLIMITED_BUDGET);
    expect(parseBudgetInput("500k")).toBe(500_000);
    expect(parseBudgetInput("1.5M")).toBe(1_500_000);
    expect(parseBudgetInput("123456")).toBe(123456);
  });

  it("rejects malformed and non-positive values", () => {
    expect(parseBudgetInput("0")).toBeNull();
    expect(parseBudgetInput("-5")).toBeNull();
    expect(parseBudgetInput("banana")).toBeNull();
    expect(parseBudgetInput("5g")).toBeNull();
  });
});
