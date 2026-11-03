/**
 * The subagents panel's auto-open tracker (pure — unit-tested in
 * test/panel-task-scope.test.ts): the current Task's first live spawn opens the panel
 * once, re-armed at each task boundary, so a manual close mid-task is respected. The chat
 * page observes the stream and applies the decision through the dock store.
 */

/**
 * Mutable tracker state, held in a ref by the chat page. `taskCount` is the number of
 * Task-starting user items observed in the session's stream (taskStartCount in
 * agent-topology.ts); an increase IS the "user started a new Task" boundary.
 */
export interface PanelTaskScope {
  sessionId: string | null;
  taskCount: number;
  /** Task ordinal (the taskCount value) whose one auto-open attempt was already consumed; null = armed. */
  autoOpenedAt: number | null;
}

export function createPanelTaskScope(): PanelTaskScope {
  return { sessionId: null, taskCount: 0, autoOpenedAt: null };
}

/**
 * Advance the tracker with one observation of the current session's stream and return whether
 * the panel should auto-open:
 *   - a live spawn in the current task → "autoOpen", at most once per task, so a manual close
 *     afterwards is respected until the next boundary;
 *   - a boundary (a Session switch, or a new Task within the session) RE-ARMS that one attempt
 *     but is never itself an action — an open panel is not closed here. Entering a
 *     session mid-run therefore auto-opens on the spawn that is already live, which reads as
 *     that spawn introducing itself;
 *   - anything else (steering, compaction, more messages in the same task) → null.
 * A taskCount DECREASE is a defensive re-baseline (a resync swapped in a smaller model):
 * adopted silently, with the auto-open attempt marked consumed so a rebuild can never
 * surprise-open a panel the user closed mid-task.
 * The caller applies "autoOpen" under its own guards (not already shown); the attempt is
 * consumed here regardless, so a suppressed attempt never retriggers within the same task.
 */
export function advancePanelTaskScope(
  state: PanelTaskScope,
  obs: { sessionId: string | null; taskCount: number; liveSpawn: boolean },
): "autoOpen" | null {
  const switched = obs.sessionId !== state.sessionId;
  const rebaseline = !switched && obs.taskCount < state.taskCount;
  if (switched || obs.taskCount !== state.taskCount) {
    state.sessionId = obs.sessionId;
    state.taskCount = obs.taskCount;
    // A real boundary re-arms the auto-open; the defensive re-baseline marks it consumed.
    state.autoOpenedAt = rebaseline ? obs.taskCount : null;
  }
  if (obs.liveSpawn && state.autoOpenedAt !== state.taskCount) {
    state.autoOpenedAt = state.taskCount;
    return "autoOpen";
  }
  return null;
}
