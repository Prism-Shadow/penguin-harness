/**
 * Where a Trace file's thinking level changes, and how a change reads (pure — unit-tested in
 * test/trace-levels.test.ts).
 *
 * Every request's `request_begin` records the level it went out at, and the analysis copies it
 * onto that request's span (`RequestSpan.thinkingLevel`). Walking the requests in file order, a
 * request whose level is known and differs from the request before it is a change point: the
 * first level the file states is one (from nothing), a switch mid-file is one. A request with
 * no level — a Trace written before the field, or a request sent with no level at all — is
 * unknown, so it marks nothing, and the step back from it to a known level counts as that level
 * being stated again.
 */
import type { RequestSpan } from "@prismshadow/penguin-server/api";

/** One change point: the level before (null where the file states its first) and the level after. */
export interface LevelChange {
  from: string | null;
  to: string;
}

export interface LevelChanges {
  /** By the request's `beginTs`: the `request_begin` row that marks a change. */
  byBeginTs: ReadonlyMap<string, LevelChange>;
}

/**
 * A change as the request row's summary spells it, in recorded values: the level alone where the
 * file states its first, `from → to` where it switches (`thinking_level=medium → high`).
 */
export function levelChangeText(change: LevelChange): string {
  return change.from === null ? change.to : `${change.from} → ${change.to}`;
}

export function thinkingLevelChanges(requests: readonly RequestSpan[]): LevelChanges {
  const byBeginTs = new Map<string, LevelChange>();
  let prev: string | undefined;
  for (const r of requests) {
    const level = r.thinkingLevel;
    if (level !== undefined && level !== prev) {
      byBeginTs.set(r.beginTs, { from: prev ?? null, to: level });
    }
    prev = level;
  }
  return { byBeginTs };
}
