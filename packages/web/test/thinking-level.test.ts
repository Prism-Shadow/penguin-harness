/**
 * thinking-level.ts unit tests: the conversation-time pickers' short-name lookup and the
 * selectable list — both pickers offer only low/medium/high/xhigh (many models cannot disable
 * thinking; there is no "follow config" row — the session picker auto-follows the Agent
 * config by initializing its display to it), while "none" stays a displayable stored value;
 * "" (internally "untouched"/no override) and a legacy meta's "default" resolve to null so
 * callers substitute the config level or a placeholder.
 */
import { describe, expect, it } from "vitest";
import {
  SELECTABLE_THINKING_LEVELS,
  THINKING_LEVELS,
  effectiveThinkingLevel,
  needsThinkingSwitchConfirm,
  prefixCacheAtRisk,
  thinkingLevelLabel,
  thinkingLevelOptionsFor,
} from "../src/features/chat/thinking-level";
import type { ThinkingSwitchItem } from "../src/features/chat/thinking-level";

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
  it("returns null for non-levels: '' (untouched/no override), a legacy meta's 'default', unknown, null", () => {
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

describe("effectiveThinkingLevel (draft picker display — mirrors core agent.ts)", () => {
  it("resolves Agent explicit > project default_chat > built-in medium, the same chain core applies", () => {
    // Agent's explicit level always wins — including over a set project default.
    expect(effectiveThinkingLevel("high", "low")).toBe("high");
    expect(effectiveThinkingLevel("none", "low")).toBe("none"); // a stored legacy "none" is explicit too
    // No explicit agent level ("") -> the project default.
    expect(effectiveThinkingLevel("", "low")).toBe("low");
    // Neither -> the built-in "medium" (the documented Agent default).
    expect(effectiveThinkingLevel("", undefined)).toBe("medium");
  });
});

describe("thinkingLevelOptionsFor (agent-settings dropdown assembly)", () => {
  /** Mirrors the shape of S.agent.thinkingLevelOptions after the none row's removal. */
  const OPTIONS: ReadonlyArray<readonly [string, string]> = [
    ["", "Send no override."],
    ["low", "Low tier."],
    ["medium", "Medium tier."],
    ["high", "High tier."],
    ["xhigh", "Extra-high tier."],
  ];

  it("filters the '' inherit row and keeps dictionary order; no none row normally", () => {
    for (const stored of [undefined, "", "medium", "xhigh"]) {
      const rows = thinkingLevelOptionsFor(OPTIONS, "legacy none", stored);
      expect(rows.map((r) => r.value)).toEqual(["low", "medium", "high", "xhigh"]);
      expect(rows.some((r) => r.value === "none")).toBe(false);
      expect(rows[0]).toMatchObject({
        triggerLabel: "low",
        label: "low",
        description: "Low tier.",
      });
    }
  });

  it("appends a display-only none row when the persisted config stores none (backward compat)", () => {
    const rows = thinkingLevelOptionsFor(OPTIONS, "legacy none", "none");
    expect(rows.map((r) => r.value)).toEqual(["low", "medium", "high", "xhigh", "none"]);
    expect(rows.at(-1)).toEqual({
      value: "none",
      triggerLabel: "none",
      label: "none",
      description: "legacy none",
    });
  });
});

/** Stream-item stubs for the mid-chat switch guard (structural ThinkingSwitchItem subset). */
const user: ThinkingSwitchItem = { kind: "user_text" };
const reply: ThinkingSwitchItem = { kind: "assistant_text" };
const stats: ThinkingSwitchItem = { kind: "task_stats" };
const compactionDone: ThinkingSwitchItem = {
  kind: "compaction",
  running: false,
  status: "completed",
};
const compactionFailed: ThinkingSwitchItem = {
  kind: "compaction",
  running: false,
  status: "failed",
};
const compactionRunning: ThinkingSwitchItem = { kind: "compaction", running: true };

describe("prefixCacheAtRisk (issue #310 — provider prefix cache over the existing history)", () => {
  it("empty transcript: nothing cached provider-side yet", () => {
    expect(prefixCacheAtRisk([])).toBe(false);
  });

  it("any conversation history puts the prefix cache at risk", () => {
    expect(prefixCacheAtRisk([user])).toBe(true);
    expect(prefixCacheAtRisk([user, reply, stats])).toBe(true);
  });

  it("a transcript ending in a successful compaction is safe (compact-then-switch is not re-warned)", () => {
    expect(prefixCacheAtRisk([user, reply, stats, compactionDone])).toBe(false);
  });

  it("a failed or still-running trailing compaction leaves the old context — still at risk", () => {
    expect(prefixCacheAtRisk([user, reply, compactionFailed])).toBe(true);
    expect(prefixCacheAtRisk([user, reply, compactionRunning])).toBe(true);
  });

  it("a failed retry after a successful trailing compaction changed nothing — still safe", () => {
    expect(prefixCacheAtRisk([user, reply, compactionDone, compactionFailed])).toBe(false);
  });

  it("new turns after a compaction re-arm the guard (only a TRAILING compaction is safe)", () => {
    expect(prefixCacheAtRisk([user, reply, compactionDone, user, reply])).toBe(true);
  });
});

describe("needsThinkingSwitchConfirm (mid-chat switch guard for the session picker)", () => {
  const history = [user, reply, stats];

  it("no dialog on a brand-new/empty session — the initial selection is free", () => {
    expect(needsThinkingSwitchConfirm([], "medium", "high")).toBe(false);
    expect(needsThinkingSwitchConfirm([], "", "high")).toBe(false);
  });

  it("dialog when history exists and the pick differs from the displayed level", () => {
    expect(needsThinkingSwitchConfirm(history, "medium", "high")).toBe(true);
  });

  it("re-picking the displayed level only pins it — never a dialog, history or not", () => {
    expect(needsThinkingSwitchConfirm(history, "high", "high")).toBe(false);
  });

  it("unknown displayed level ('' — config unset/still loading) with history: warn rather than silently invalidate", () => {
    expect(needsThinkingSwitchConfirm(history, "", "medium")).toBe(true);
  });

  it("no dialog right after a successful compaction (the advised flow: /compact, then switch)", () => {
    expect(needsThinkingSwitchConfirm([...history, compactionDone], "medium", "high")).toBe(false);
  });
});
