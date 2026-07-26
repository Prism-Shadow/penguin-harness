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
    expect(parseGoalTaskMessage(block(1))).toEqual({ round: 1, objective: "" });
    expect(parseGoalTaskMessage(block(12))).toEqual({ round: 12, objective: "" });
  });

  it("extracts and unescapes the objective (every round's bubble shows it)", () => {
    const withObjective = block(
      1,
      "intro\n<objective>\nfix a &amp; b &lt;now&gt;\n</objective>\nrules",
    );
    expect(parseGoalTaskMessage(withObjective)).toEqual({
      round: 1,
      objective: "fix a & b <now>",
    });
    // Multi-line objectives come back intact; &amp; unescapes LAST (an escaped literal
    // `&amp;lt;` must yield `&lt;`, not `<`).
    const multiline = block(2, "<objective>\nline one\nline two &amp;lt;\n</objective>");
    expect(parseGoalTaskMessage(multiline)).toEqual({
      round: 2,
      objective: "line one\nline two &lt;",
    });
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
