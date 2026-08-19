/**
 * thinking-level.ts unit tests: the conversation-time pickers' short-name lookup and the
 * selectable list — both pickers offer only low/medium/high/xhigh/max (many models cannot disable
 * thinking; there is no "follow config" row — the session picker auto-follows the Agent
 * config by initializing its display to it), while "none" stays a displayable stored value;
 * "" (internally "untouched"/no override) and a legacy meta's "default" resolve to null so
 * callers substitute the config level or a placeholder.
 *
 * Plus the mid-chat switch guard (#310): when a pick has to be confirmed, and how the
 * dialog's "compact, then switch" choice decides — from the transcript alone — whether the
 * compaction it started completed (apply the pick), settled without completing (keep the
 * level and say so), or is still in flight.
 */
import { describe, expect, it } from "vitest";
import {
  SELECTABLE_THINKING_LEVELS,
  THINKING_LEVELS,
  compactionSettledSince,
  compactionTally,
  effectiveThinkingLevel,
  heldThinkingSwitch,
  needsThinkingSwitchConfirm,
  prefixCacheAtRisk,
  sessionThinkingLevel,
  thinkingLevelAtStep,
  thinkingLevelIndex,
  thinkingLevelLabel,
  thinkingLevelOptionsFor,
  thinkingLevelStepAtRatio,
  thinkingLevelStops,
} from "../src/features/chat/thinking-level";
import type { ThinkingSwitchItem } from "../src/features/chat/thinking-level";

/** Mirrors the shape of S.chat.thinkingLevelNames. */
const NAMES: Readonly<Record<string, string>> = {
  none: "none",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max",
};

describe("thinking level lists", () => {
  it("offers only low/medium/high/xhigh/max — no 'none' (many models cannot disable thinking)", () => {
    expect(SELECTABLE_THINKING_LEVELS).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(SELECTABLE_THINKING_LEVELS).not.toContain("none");
  });

  it("keeps every stored level displayable (a legacy 'none' is shown, never offered)", () => {
    expect(THINKING_LEVELS).toEqual(["none", "low", "medium", "high", "xhigh", "max"]);
    expect(THINKING_LEVELS.map((l) => thinkingLevelLabel(NAMES, l))).toEqual([
      "none",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
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
    ["max", "Max tier."],
  ];

  it("filters the '' inherit row and keeps dictionary order; no none row normally", () => {
    for (const stored of [undefined, "", "medium", "xhigh", "max"]) {
      const rows = thinkingLevelOptionsFor(OPTIONS, "legacy none", stored);
      expect(rows.map((r) => r.value)).toEqual(["low", "medium", "high", "xhigh", "max"]);
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
    expect(rows.map((r) => r.value)).toEqual(["low", "medium", "high", "xhigh", "max", "none"]);
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

describe("compactionSettledSince (has the compaction we started finished?)", () => {
  const history = [user, reply, stats];
  /** The tally taken when the user picks "compact, then switch". */
  const at = (items: ThinkingSwitchItem[]) => compactionTally(items);

  it("counts settled compactions and their completed subset (a running one is not settled yet)", () => {
    expect(compactionTally([])).toEqual({ settled: 0, completed: 0 });
    expect(compactionTally([user, reply])).toEqual({ settled: 0, completed: 0 });
    expect(compactionTally([user, compactionRunning])).toEqual({ settled: 0, completed: 0 });
    expect(compactionTally([user, compactionFailed, reply, compactionDone])).toEqual({
      settled: 2,
      completed: 1,
    });
  });

  it("pending while the compaction is still running", () => {
    const baseline = at(history);
    expect(compactionSettledSince(history, baseline)).toBe("pending");
    expect(compactionSettledSince([...history, compactionRunning], baseline)).toBe("pending");
  });

  it("completed once one finishes", () => {
    const baseline = at(history);
    expect(compactionSettledSince([...history, compactionDone], baseline)).toBe("completed");
  });

  it("failed when one ends without completing (failed / aborted)", () => {
    const baseline = at(history);
    expect(compactionSettledSince([...history, compactionFailed], baseline)).toBe("failed");
    expect(
      compactionSettledSince(
        [...history, { kind: "compaction", running: false, status: "aborted" }],
        baseline,
      ),
    ).toBe("failed");
  });

  it("compactions already on record when the choice was made don't settle the wait", () => {
    // A failed compaction sitting in the transcript is exactly why the dialog opened
    // (prefixCacheAtRisk stays true) — it must not be read as "our compaction failed".
    const before = [...history, compactionFailed];
    const baseline = at(before);
    expect(compactionSettledSince(before, baseline)).toBe("pending");
    expect(compactionSettledSince([...before, compactionDone], baseline)).toBe("completed");
  });

  it("a failed retry after our compaction completed still reads as completed", () => {
    const baseline = at(history);
    expect(compactionSettledSince([...history, compactionDone, compactionFailed], baseline)).toBe(
      "completed",
    );
  });

  it("items appended after the completed compaction (e.g. a queued follow-up) don't hide it", () => {
    const baseline = at(history);
    expect(compactionSettledSince([...history, compactionDone, user, reply], baseline)).toBe(
      "completed",
    );
  });
});

describe("heldThinkingSwitch (releasing the pick behind 'compact, then switch')", () => {
  const history = [user, reply, stats];
  const compacting = {
    phase: "compacting",
    level: "high",
    baseline: compactionTally(history),
  } as const;

  it("waits while the dialog is open", () => {
    expect(heldThinkingSwitch({ phase: "ask", level: "high" }, history)).toEqual({ act: "wait" });
  });

  it("waits while the compaction is still running", () => {
    expect(heldThinkingSwitch(compacting, [...history, compactionRunning])).toEqual({
      act: "wait",
    });
  });

  it("applies the pick after a completed compaction, announcing the cheap path", () => {
    expect(heldThinkingSwitch(compacting, [...history, compactionDone])).toEqual({
      act: "apply",
      level: "high",
      notice: "compacted",
    });
  });

  it("STILL applies the pick when the compaction failed — the user asked to switch", () => {
    expect(heldThinkingSwitch(compacting, [...history, compactionFailed])).toEqual({
      act: "apply",
      level: "high",
      notice: "compaction-failed",
    });
    expect(
      heldThinkingSwitch(compacting, [
        ...history,
        { kind: "compaction", running: false, status: "aborted" },
      ]),
    ).toEqual({ act: "apply", level: "high", notice: "compaction-failed" });
  });

  it("applies the pick when the compaction never started (the server refused it)", () => {
    // The refusal toast already said why, so there is no notice of our own.
    expect(heldThinkingSwitch({ phase: "settle", level: "low" }, history)).toEqual({
      act: "apply",
      level: "low",
      notice: "none",
    });
  });
});

describe("sessionThinkingLevel (what the in-session picker shows and sends)", () => {
  it("a brand-new session follows the Agent config", () => {
    expect(sessionThinkingLevel("", "medium")).toBe("medium");
  });

  it("a level pinned on the Session wins, so a later Agent-config edit cannot move it", () => {
    expect(sessionThinkingLevel("high", "medium")).toBe("high");
    // The pin is read back off the Session row, so a reload computes this same value —
    // that is what makes the picked level survive a refresh.
    expect(sessionThinkingLevel("high", "low")).toBe("high");
  });

  it("nothing pinned and no config yet (still loading): no level to display", () => {
    expect(sessionThinkingLevel("", "")).toBe("");
  });
});

describe("thinking level slider geometry", () => {
  it("runs the selectable ladder left (shallowest) to right (deepest)", () => {
    expect(thinkingLevelStops("medium")).toEqual(["low", "medium", "high", "xhigh", "max"]);
    // Left-to-right must mean more thinking: that is the whole premise of the control.
    expect(thinkingLevelStops("medium").at(-1)).toBe("max");
  });

  it("prepends a stored 'none' so the value on disk stays reachable, and only then", () => {
    expect(thinkingLevelStops("none")).toEqual(["none", "low", "medium", "high", "xhigh", "max"]);
    // Anyone not already on "none" is never offered it — many models cannot disable thinking.
    for (const current of ["low", "max", "", null, undefined]) {
      expect(thinkingLevelStops(current)).not.toContain("none");
    }
  });

  it("indexes the current level, and reports -1 when there is no position to show", () => {
    const stops = thinkingLevelStops("medium");
    expect(thinkingLevelIndex(stops, "low")).toBe(0);
    expect(thinkingLevelIndex(stops, "max")).toBe(4);
    // "" = an Agent with no explicit override; null = config still loading; "none" is off
    // this ladder. None of them may park the thumb on a level the user never chose.
    for (const level of ["", null, undefined, "none", "bogus"]) {
      expect(thinkingLevelIndex(stops, level)).toBe(-1);
    }
  });

  it("clamps a step to the ladder, so an arrow key at either end stays put", () => {
    const stops = thinkingLevelStops("medium");
    expect(thinkingLevelAtStep(stops, 0)).toBe("low");
    expect(thinkingLevelAtStep(stops, 4)).toBe("max");
    expect(thinkingLevelAtStep(stops, -1)).toBe("low");
    expect(thinkingLevelAtStep(stops, 99)).toBe("max");
  });

  it("picks the nearest stop for a pointer ratio, clamping outside the track", () => {
    const stops = thinkingLevelStops("medium");
    expect(thinkingLevelStepAtRatio(stops, 0)).toBe(0);
    expect(thinkingLevelStepAtRatio(stops, 1)).toBe(4);
    // Nearest, not "the one already passed": just past the midpoint of a gap rounds up.
    expect(thinkingLevelStepAtRatio(stops, 0.26)).toBe(1);
    expect(thinkingLevelStepAtRatio(stops, 0.24)).toBe(1);
    expect(thinkingLevelStepAtRatio(stops, 0.12)).toBe(0);
    // A drag past either edge stays on the ladder.
    expect(thinkingLevelStepAtRatio(stops, -3)).toBe(0);
    expect(thinkingLevelStepAtRatio(stops, 4.2)).toBe(4);
  });

  it("keeps the stop set stable while a stored 'none' is displayed, so a drag cannot resize it", () => {
    // The component derives stops from the DISPLAYED value, never from the drag position:
    // a six-stop ladder must not collapse to five mid-drag and teleport the thumb.
    const stops = thinkingLevelStops("none");
    expect(stops).toHaveLength(6);
    expect(thinkingLevelAtStep(stops, 0)).toBe("none");
    expect(thinkingLevelStepAtRatio(stops, 1)).toBe(5);
    expect(thinkingLevelAtStep(stops, 5)).toBe("max");
  });
});
