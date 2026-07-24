import { describe, expect, it } from "vitest";
import { UNLIMITED_BUDGET } from "@prismshadow/penguin-core";
import { parseGoalCommand, parseTokenBudget } from "../src/goal-command.js";

describe("parseTokenBudget", () => {
  it("parses plain numbers and k/m suffixes (case-insensitive)", () => {
    expect(parseTokenBudget("123456")).toBe(123456);
    expect(parseTokenBudget("500k")).toBe(500_000);
    expect(parseTokenBudget("500K")).toBe(500_000);
    expect(parseTokenBudget("2m")).toBe(2_000_000);
    expect(parseTokenBudget("1.5M")).toBe(1_500_000);
    expect(parseTokenBudget(" 42k ")).toBe(42_000);
  });

  it("rejects non-positive, malformed, and unit-less garbage", () => {
    expect(parseTokenBudget("0")).toBeNull();
    expect(parseTokenBudget("0k")).toBeNull();
    expect(parseTokenBudget("-5")).toBeNull();
    expect(parseTokenBudget("5g")).toBeNull();
    expect(parseTokenBudget("k")).toBeNull();
    expect(parseTokenBudget("1..5m")).toBeNull();
    expect(parseTokenBudget("")).toBeNull();
  });
});

describe("parseGoalCommand", () => {
  it("parses an objective without a budget as unlimited", () => {
    expect(parseGoalCommand("/goal fix the tests")).toEqual({
      ok: true,
      budget: UNLIMITED_BUDGET,
      objective: "fix the tests",
    });
  });

  it("parses a budget riding on the command token", () => {
    expect(parseGoalCommand("/goal:500k raise coverage to 80%")).toEqual({
      ok: true,
      budget: 500_000,
      objective: "raise coverage to 80%",
    });
  });

  it("keeps a multi-line objective intact", () => {
    const r = parseGoalCommand("/goal:2m first line\nsecond line");
    expect(r).toEqual({ ok: true, budget: 2_000_000, objective: "first line\nsecond line" });
  });

  it("rejects a missing objective as a usage error", () => {
    expect(parseGoalCommand("/goal")).toEqual({ ok: false, reason: "usage" });
    expect(parseGoalCommand("/goal:500k")).toEqual({ ok: false, reason: "usage" });
    expect(parseGoalCommand("/goal   ")).toEqual({ ok: false, reason: "usage" });
  });

  it("rejects an invalid budget, reporting the offending token", () => {
    expect(parseGoalCommand("/goal:banana do things")).toEqual({
      ok: false,
      reason: "budget",
      value: "banana",
    });
  });
});
