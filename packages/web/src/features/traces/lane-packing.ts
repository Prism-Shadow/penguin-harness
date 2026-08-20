/**
 * Lane packing for the trace timeline's tool rows: calls of the **same tool
 * name** whose time ranges don't overlap share one row, so a burst of serial
 * calls to one tool no longer costs one row each. A row never mixes tool
 * names, and overlapping same-name calls (parallel execution) still split
 * into as many rows as the overlap requires.
 */

/** A packable interval; for a still-open span the caller passes the task end as `endMs`. */
export interface PackableSpan {
  name: string;
  startMs: number;
  endMs: number;
}

/** One output row: every span in it has the same `name` and none overlap. */
export interface PackedLane<T> {
  name: string;
  spans: T[];
}

/**
 * Greedy first-fit packing: spans are processed in start order; each goes into
 * the first existing lane of its name whose last span ends at or before this
 * one's start (touching endpoints don't count as overlap), otherwise a new
 * lane opens for that name. Lanes are returned grouped by name in order of
 * each name's earliest start, with the lanes of one name adjacent.
 */
export function packToolLanes<T extends PackableSpan>(spans: readonly T[]): PackedLane<T>[] {
  const byName = new Map<string, { spans: T[]; lastEnd: number }[]>();
  const sorted = [...spans].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  for (const s of sorted) {
    let lanes = byName.get(s.name);
    if (!lanes) {
      lanes = [];
      byName.set(s.name, lanes);
    }
    const lane = lanes.find((l) => s.startMs >= l.lastEnd);
    if (lane) {
      lane.spans.push(s);
      lane.lastEnd = Math.max(lane.lastEnd, s.endMs);
    } else {
      lanes.push({ spans: [s], lastEnd: s.endMs });
    }
  }
  const out: PackedLane<T>[] = [];
  for (const [name, lanes] of byName) {
    for (const lane of lanes) out.push({ name, spans: lane.spans });
  }
  return out;
}
