/**
 * thinking-level.ts unit tests: the conversation-time picker's short-name lookup and the
 * selectable list — the picker offers only low/medium/high/xhigh (many models cannot disable
 * thinking), while "none" stays a displayable stored value; "" (no override yet) and
 * session_meta's "default" resolve to null (trigger shows a placeholder; the session tag hides).
 */
import { describe, expect, it } from "vitest";
import {
  SELECTABLE_THINKING_LEVELS,
  THINKING_LEVELS,
  thinkingLevelLabel,
} from "../src/features/chat/thinking-level";

/** Mirrors the shape of S.chat.thinkingLevelNames. */
const NAMES: Readonly<Record<string, string>> = {
  none: "None",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extreme High",
};

describe("thinking level lists", () => {
  it("offers only low/medium/high/xhigh — no 'none' (many models cannot disable thinking)", () => {
    expect(SELECTABLE_THINKING_LEVELS).toEqual(["low", "medium", "high", "xhigh"]);
    expect(SELECTABLE_THINKING_LEVELS).not.toContain("none");
  });

  it("keeps all five stored levels displayable (a legacy 'none' is shown, never offered)", () => {
    expect(THINKING_LEVELS).toEqual(["none", "low", "medium", "high", "xhigh"]);
    expect(THINKING_LEVELS.map((l) => thinkingLevelLabel(NAMES, l))).toEqual([
      "None",
      "Low",
      "Medium",
      "High",
      "Extreme High",
    ]);
  });
});

describe("thinkingLevelLabel", () => {
  it("returns null for non-levels: '' (no override yet), session_meta's 'default', unknown, null", () => {
    expect(thinkingLevelLabel(NAMES, "")).toBeNull();
    expect(thinkingLevelLabel(NAMES, "default")).toBeNull();
    expect(thinkingLevelLabel(NAMES, "ultra")).toBeNull();
    expect(thinkingLevelLabel(NAMES, null)).toBeNull();
    expect(thinkingLevelLabel(NAMES, undefined)).toBeNull();
  });

  it("falls back to the raw value if the name table misses a level (defensive)", () => {
    expect(thinkingLevelLabel({}, "medium")).toBe("medium");
  });
});
