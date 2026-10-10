/**
 * The Agent settings page's pure helpers (features/agents/agent-settings-page.tsx). One file,
 * so the page module is imported once.
 *
 * - A runtime dropdown is built from the dictionary's [value, description] pairs in dictionary
 *   order, the "" inherit row dropped, each value labelling both the trigger and the row and
 *   the description carried through.
 * - The `?tab=` deep link passes a known tab key through and falls back to the default for an
 *   absent, empty, unknown or wrong-cased value, judged against the live tab list rather than a
 *   hard-coded one.
 */
import { describe, expect, it } from "vitest";
import { optionRows, resolveTabKey } from "../src/features/agents/agent-settings-page";

const ENTRIES: ReadonlyArray<readonly [string, string]> = [
  ["", "Send no override."],
  ["low", "Low tier."],
  ["medium", "Medium tier."],
  ["high", "High tier."],
  ["xhigh", "Extra-high tier."],
  ["max", "Max tier."],
];

describe("optionRows", () => {
  it("drops the '' inherit row and keeps dictionary order", () => {
    const rows = optionRows(ENTRIES);
    expect(rows.map((r) => r.value)).toEqual(["low", "medium", "high", "xhigh", "max"]);
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

const TABS = [{ key: "overview" }, { key: "tools" }, { key: "vault" }] as const;

describe("resolveTabKey", () => {
  it("passes a known tab key through", () => {
    expect(resolveTabKey("tools", TABS, "overview")).toBe("tools");
    expect(resolveTabKey("vault", TABS, "overview")).toBe("vault");
  });

  it("falls back for absent, empty, unknown, or wrong-cased values", () => {
    expect(resolveTabKey(null, TABS, "overview")).toBe("overview");
    expect(resolveTabKey("", TABS, "overview")).toBe("overview");
    expect(resolveTabKey("bogus", TABS, "overview")).toBe("overview");
    expect(resolveTabKey("Tools", TABS, "overview")).toBe("overview");
  });

  it("validates against the supplied keys, not a hardcoded list", () => {
    expect(resolveTabKey("skills", [...TABS, { key: "skills" }], "overview")).toBe("skills");
    expect(resolveTabKey("hooks", TABS, "overview")).toBe("overview");
    expect(resolveTabKey("hooks", [...TABS, { key: "hooks" }], "overview")).toBe("hooks");
  });
});
