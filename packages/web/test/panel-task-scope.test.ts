/**
 * advancePanelTaskScope unit tests: the subagents panel's TASK-SCOPED visibility rules —
 * entering a session and every new Task close the panel by default; the current task's first
 * live spawn auto-opens it (one attempt per task, so a manual close afterwards is respected
 * until the next boundary); a taskCount decrease is a defensive re-baseline, never a boundary.
 * The chat page feeds observations per render (session id + taskStartCount + live-spawn flag)
 * and applies the returned action under its own layout guards.
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

describe("advancePanelTaskScope (task-scoped panel visibility)", () => {
  it("entering a session closes by default; a mid-run entry with a live spawn auto-opens instead", () => {
    const s = createPanelTaskScope();
    expect(advancePanelTaskScope(s, obs("A", 3))).toBe("close");
    const mid = createPanelTaskScope();
    expect(advancePanelTaskScope(mid, obs("A", 3, true))).toBe("autoOpen");
  });

  it("a new Task closes the panel and RE-ARMS the auto-open; the task's own spawn then opens it once", () => {
    const s = createPanelTaskScope();
    advancePanelTaskScope(s, obs("A", 1)); // session entry
    expect(advancePanelTaskScope(s, obs("A", 1, true))).toBe("autoOpen"); // task 1 spawns
    expect(advancePanelTaskScope(s, obs("A", 1, true))).toBeNull(); // once per task
    expect(advancePanelTaskScope(s, obs("A", 2))).toBe("close"); // task 2 boundary
    expect(advancePanelTaskScope(s, obs("A", 2))).toBeNull(); // the boundary fires once
    expect(advancePanelTaskScope(s, obs("A", 2, true))).toBe("autoOpen"); // re-armed for task 2
    // Consumed again: a manual close mid-task stays respected until the next boundary.
    expect(advancePanelTaskScope(s, obs("A", 2, true))).toBeNull();
  });

  it("a boundary arriving together with the new task's spawn opens rather than closing (batched commit)", () => {
    const s = createPanelTaskScope();
    advancePanelTaskScope(s, obs("A", 1));
    expect(advancePanelTaskScope(s, obs("A", 2, true))).toBe("autoOpen");
  });

  it("a session switch resets the per-task guard", () => {
    const s = createPanelTaskScope();
    expect(advancePanelTaskScope(s, obs("A", 1, true))).toBe("autoOpen"); // consumed for A's task 1
    expect(advancePanelTaskScope(s, obs("B", 1))).toBe("close"); // B is entered closed
    expect(advancePanelTaskScope(s, obs("B", 1, true))).toBe("autoOpen"); // B's task 1 arms fresh
  });

  it("steady observations (steering, more output within the same task) do nothing", () => {
    const s = createPanelTaskScope();
    advancePanelTaskScope(s, obs("A", 2));
    expect(advancePanelTaskScope(s, obs("A", 2))).toBeNull();
    expect(advancePanelTaskScope(s, obs("A", 2))).toBeNull();
  });

  it("a taskCount decrease re-baselines silently: no boundary, no surprise reopen; the next real boundary works", () => {
    const s = createPanelTaskScope();
    advancePanelTaskScope(s, obs("A", 5));
    // A resync swapped in a smaller model while a spawn runs: neither close nor auto-open —
    // reopening a panel the user closed mid-task would be a surprise.
    expect(advancePanelTaskScope(s, obs("A", 3, true))).toBeNull();
    expect(advancePanelTaskScope(s, obs("A", 4))).toBe("close");
  });
});
