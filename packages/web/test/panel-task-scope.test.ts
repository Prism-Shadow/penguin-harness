/**
 * advancePanelTaskScope unit tests: the subagents panel's AUTO-OPEN rule — the current task's
 * first live spawn opens the panel once, re-armed at every boundary (Session switch or new
 * Task) so a manual close is respected until the next one; boundaries themselves never close
 * the panel (an open panel survives a switch, like the Files panel); a taskCount decrease is a
 * defensive re-baseline that consumes the attempt instead of arming it. The chat page feeds
 * observations per render (session id + taskStartCount + live-spawn flag) and applies the
 * returned action under its own layout guards.
 */
import { describe, expect, it } from "vitest";
import {
  advancePanelTaskScope,
  createPanelTaskScope,
} from "../src/features/chat/use-subagents-panel";

const obs = (sessionId: string | null, taskCount: number, liveSpawn = false) => ({
  sessionId,
  taskCount,
  liveSpawn,
});

describe("advancePanelTaskScope (subagents panel auto-open)", () => {
  it("entering a session does nothing on its own; a mid-run entry with a live spawn auto-opens", () => {
    const s = createPanelTaskScope();
    expect(advancePanelTaskScope(s, obs("A", 3))).toBeNull();
    const mid = createPanelTaskScope();
    expect(advancePanelTaskScope(mid, obs("A", 3, true))).toBe("autoOpen");
  });

  it("a new Task RE-ARMS the auto-open without closing; the task's own spawn then opens it once", () => {
    const s = createPanelTaskScope();
    advancePanelTaskScope(s, obs("A", 1)); // session entry
    expect(advancePanelTaskScope(s, obs("A", 1, true))).toBe("autoOpen"); // task 1 spawns
    expect(advancePanelTaskScope(s, obs("A", 1, true))).toBeNull(); // once per task
    expect(advancePanelTaskScope(s, obs("A", 2))).toBeNull(); // task 2 boundary: no close
    expect(advancePanelTaskScope(s, obs("A", 2, true))).toBe("autoOpen"); // re-armed for task 2
    // Consumed again: a manual close mid-task stays respected until the next boundary.
    expect(advancePanelTaskScope(s, obs("A", 2, true))).toBeNull();
  });

  it("a boundary arriving together with the new task's spawn opens in the same observation", () => {
    const s = createPanelTaskScope();
    advancePanelTaskScope(s, obs("A", 1));
    expect(advancePanelTaskScope(s, obs("A", 2, true))).toBe("autoOpen");
  });

  it("a session switch resets the per-task guard but leaves visibility alone", () => {
    const s = createPanelTaskScope();
    expect(advancePanelTaskScope(s, obs("A", 1, true))).toBe("autoOpen"); // consumed for A's task 1
    expect(advancePanelTaskScope(s, obs("B", 1))).toBeNull(); // B inherits the open state
    expect(advancePanelTaskScope(s, obs("B", 1, true))).toBe("autoOpen"); // B's task 1 arms fresh
  });

  it("steady observations (steering, more output within the same task) do nothing", () => {
    const s = createPanelTaskScope();
    advancePanelTaskScope(s, obs("A", 2));
    expect(advancePanelTaskScope(s, obs("A", 2))).toBeNull();
    expect(advancePanelTaskScope(s, obs("A", 2))).toBeNull();
  });

  it("a taskCount decrease re-baselines silently: no surprise reopen, and the next real boundary still arms", () => {
    const s = createPanelTaskScope();
    advancePanelTaskScope(s, obs("A", 5));
    // A resync swapped in a smaller model while a spawn runs: no auto-open — reopening a panel
    // the user closed mid-task would be a surprise.
    expect(advancePanelTaskScope(s, obs("A", 3, true))).toBeNull();
    expect(advancePanelTaskScope(s, obs("A", 4))).toBeNull(); // boundary itself is silent
    expect(advancePanelTaskScope(s, obs("A", 4, true))).toBe("autoOpen"); // but it re-armed
  });
});
