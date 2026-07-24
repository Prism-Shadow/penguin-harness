import { describe, expect, it } from "vitest";
import {
  UNLIMITED_BUDGET,
  parseBudgetInput,
  parseGoalTaskMessage,
} from "../src/features/chat/goal-use";

describe("parseGoalTaskMessage", () => {
  const block = (round: number, body = "work toward the goal") =>
    `<goal_task>\nround: ${round}\n${body}\n</goal_task>`;

  it("recognizes a goal round block and extracts the round", () => {
    expect(parseGoalTaskMessage(block(1))).toEqual({ round: 1 });
    expect(parseGoalTaskMessage(block(12))).toEqual({ round: 12 });
  });

  it("rejects non-goal messages, mid-text blocks, and malformed rounds", () => {
    expect(parseGoalTaskMessage("hello")).toBeNull();
    expect(parseGoalTaskMessage(`prefix\n${block(1)}`)).toBeNull();
    expect(parseGoalTaskMessage("<goal_task>\nround: zero\nx\n</goal_task>")).toBeNull();
    expect(parseGoalTaskMessage("<goal_task>\nround: 1\nunclosed")).toBeNull();
  });
});

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
