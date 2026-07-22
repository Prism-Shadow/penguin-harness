/**
 * agent-settings-page.ts optionRows unit tests: the runtime dropdowns build from the
 * dictionary's [value, description] pairs with the "" (inherit) row dropped and dictionary
 * order kept — pinned so a future reconciliation (e.g. with the no-none branch's option
 * assembly) cannot silently regress the filter.
 */
import { describe, expect, it } from "vitest";
import { optionRows } from "../src/features/agents/agent-settings-page";

const ENTRIES: ReadonlyArray<readonly [string, string]> = [
  ["", "Send no override."],
  ["low", "Low tier."],
  ["medium", "Medium tier."],
  ["high", "High tier."],
  ["xhigh", "Extra-high tier."],
];

describe("optionRows", () => {
  it("drops the '' inherit row and keeps dictionary order", () => {
    const rows = optionRows(ENTRIES);
    expect(rows.map((r) => r.value)).toEqual(["low", "medium", "high", "xhigh"]);
    expect(rows.some((r) => r.value === "")).toBe(false);
  });

  it("maps value into both labels and carries the description through", () => {
    const rows = optionRows([["summarize", "Summarize old context."]]);
    expect(rows[0]).toEqual({
      value: "summarize",
      triggerLabel: "summarize",
      label: "summarize",
      description: "Summarize old context.",
    });
  });
});
