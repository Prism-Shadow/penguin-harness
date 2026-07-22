/**
 * thinking-level.ts unit tests: the conversation-time picker's option rows — labels fall back
 * to the default tag for "", and the "" (no override) row is selectable only when it already
 * is the current state (the agent-config API cannot persist a cleared level).
 */
import { describe, expect, it } from "vitest";
import { thinkingLevelChoices } from "../src/features/chat/thinking-level";

/** Mirrors the shape of S.agent.thinkingLevelOptions ([value, description] pairs). */
const OPTIONS: ReadonlyArray<readonly [string, string]> = [
  ["", "No override; follow the effective config."],
  ["none", "Extended reasoning off."],
  ["low", "Low."],
  ["medium", "Medium (seeded default)."],
  ["high", "High."],
  ["xhigh", "Extra high."],
];

describe("thinkingLevelChoices", () => {
  it("maps values and descriptions; '' renders the localized default tag", () => {
    const rows = thinkingLevelChoices(OPTIONS, "(default)", "medium");
    expect(rows).toHaveLength(6);
    expect(rows[0]).toMatchObject({ value: "", label: "(default)" });
    expect(rows[3]).toMatchObject({
      value: "medium",
      label: "medium",
      description: "Medium (seeded default).",
    });
  });

  it("disables the '' row unless it already is the current state (not persistable via the config API)", () => {
    // A concrete level is set: "" cannot be picked (the API's enum validator rejects it).
    const set = thinkingLevelChoices(OPTIONS, "(default)", "medium");
    expect(set[0]!.disabled).toBe(true);
    // No override yet: the "" row is the (checkable) current state; clicking it is a no-op.
    const unset = thinkingLevelChoices(OPTIONS, "(default)", "");
    expect(unset[0]!.disabled).toBe(false);
    // Concrete levels are never disabled in either state.
    for (const rows of [set, unset]) {
      expect(rows.slice(1).every((r) => !r.disabled)).toBe(true);
    }
  });
});
