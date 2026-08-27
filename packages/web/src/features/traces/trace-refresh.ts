/**
 * The Trace panel's refresh rules (pure — unit-tested in test/trace-refresh.test.ts): WHEN the
 * panel re-fetches, and what a re-fetch must leave standing.
 *
 * Two edges re-fetch: the dock tab becoming visible, and a turn settling on the Session while
 * the tab IS visible (the chat page's settled-turn counter, the same one the Files panel reads
 * — the writes an Agent makes land as its turn ends, and a Trace file is appended to by the
 * very turn being watched). A settled turn that arrives while the tab is hidden is dropped
 * rather than queued: the dock keeps hidden tabs mounted, fetching for a tab nobody is looking
 * at is waste, and the hidden→visible edge re-fetches anyway — so the panel is current the
 * moment it is looked at again, however many turns went by meanwhile.
 *
 * The tracker only decides. The panel applies the decision by bumping the tick its fetch effect
 * is keyed on, and that split is load-bearing under StrictMode — see trace-panel.tsx.
 */

/** One observation of the panel's props, made per render by the panel's edge effect. */
export interface TraceRefreshObservation {
  /** Whether the dock tab is showing. */
  active: boolean;
  /** The chat page's settled-turn counter: ANY change of the number means "the turn ended — re-read". */
  signal: number;
}

/** Mutable tracker state, held in a ref by the panel. */
export interface TraceRefreshTracker {
  active: boolean;
  signal: number;
}

/**
 * Seeded from the panel's first render, so a mount is never itself an edge: the fetch effect
 * already loads on mount, and a tracker that started from `{ active: false, signal: 0 }` would
 * report a spurious edge for a panel mounted already showing.
 */
export function createTraceRefresh(obs: TraceRefreshObservation): TraceRefreshTracker {
  return { active: obs.active, signal: obs.signal };
}

/**
 * Advance the tracker with one observation and return whether the panel should re-fetch:
 *   - hidden → visible: yes. This is also what makes a signal dropped while hidden harmless —
 *     the re-show re-lists and re-reads, whatever happened in between.
 *   - the signal changed while visible: yes — the turn that just ended wrote to the file the
 *     panel is showing.
 *   - the signal changed while hidden: no. The change is still consumed (the tracker adopts
 *     it), so the re-show edge is what brings the panel current, not a queued backlog.
 *   - anything else, including going visible → hidden: no.
 * Both edges landing in ONE observation (a turn settling in the same commit that shows the
 * tab) is still a single re-fetch, not two.
 */
export function advanceTraceRefresh(
  state: TraceRefreshTracker,
  obs: TraceRefreshObservation,
): boolean {
  const shown = obs.active && !state.active;
  const settled = obs.signal !== state.signal;
  state.active = obs.active;
  state.signal = obs.signal;
  return shown || (settled && obs.active);
}

/**
 * The pill row's order: newest first, so the row and the default selection both read
 * left-to-right from the most recent context. Copies rather than sorting the response in place.
 */
export function sortTraceFiles<T extends { index: number }>(files: readonly T[]): T[] {
  return [...files].sort((a, b) => b.index - a.index);
}

/**
 * The selected file after a listing arrives: the user's pick while its file is still listed, the
 * newest file otherwise, and null only when the Session has no Trace at all. Selection is held
 * by index rather than by the listed object, so a re-list — which returns fresh objects, and
 * usually the SAME file at a larger size — leaves the pick where the user put it; a pick that
 * vanished (a Trace deleted out from under the panel) falls back instead of blanking the view.
 */
export function activeTraceFile<T extends { index: number }>(
  files: readonly T[],
  selected: number | null,
): T | null {
  return files.find((f) => f.index === selected) ?? files[0] ?? null;
}
