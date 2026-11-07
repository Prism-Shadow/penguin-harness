/**
 * Joining a run that is already under way: what a client that comes to a running Session
 * needs to render it without gaps or repeats, following the server's live-tail contract
 * (`MessagesResponse.live`, see MessagesLiveTail in the server API).
 *
 * The client subscribes to the Session's stream first and reads its history second, so every
 * event published after the history was captured is already on its stream. The live tail's
 * `fragments` carry each open streaming fragment's content so far, which the renderer is
 * seeded with; the stream then repeats some of what the history and the fragments already
 * hold, and `coveredFrames` names those frames: a partial published at or before the cursor
 * (its content is inside a fragment), and a complete record the history already holds (its
 * Trace append can land before the history read or after it, so the cursor cannot decide).
 */
import { isEventMessage, isPartialPayload, type AmspRecord } from "@prismshadow/penguin-core";
import type { SseFrame } from "./client.js";

/**
 * How many of the history's newest records a complete frame is checked against: a record
 * the stream repeats is one the history read just caught, so it is among the newest.
 */
const KNOWN_TAIL = 200;

/** A channel event id, `<epoch>-<seq>`; null for anything else. */
function parseEventId(id: string): { epoch: string; seq: number } | null {
  const sep = id.lastIndexOf("-");
  if (sep <= 0) return null;
  const seq = Number.parseInt(id.slice(sep + 1), 10);
  return Number.isInteger(seq) ? { epoch: id.slice(0, sep), seq } : null;
}

/** JSON with every object's keys in one order: the same record serialized by two writers compares equal. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** A record's identity: its envelope, without the Trace position a history read tags it with. */
function recordKey(msg: AmspRecord): string {
  const { tracePosition: _position, ...envelope } = msg as AmspRecord & {
    tracePosition?: unknown;
  };
  return canonical(envelope);
}

/**
 * The frames of a stream subscribed before `history` was read that repeat what the history
 * and the live tail (`cursor`) already hold. Server events always pass: they are state, not
 * transcript.
 */
export function coveredFrames(history: AmspRecord[], cursor: string): (frame: SseFrame) => boolean {
  const at = parseEventId(cursor);
  const known = new Set(history.slice(-KNOWN_TAIL).map(recordKey));
  return (frame) => {
    if (frame.event !== undefined) return false;
    let msg: AmspRecord;
    try {
      msg = JSON.parse(frame.data) as AmspRecord;
    } catch {
      return false;
    }
    if (isPartialPayload(msg.payload)) {
      const id = frame.id === undefined ? null : parseEventId(frame.id);
      return at !== null && id !== null && id.epoch === at.epoch && id.seq <= at.seq;
    }
    return known.has(recordKey(msg));
  };
}

/**
 * The records of the run still under way, from the history: its Task's, from the
 * `task_begin` no `task_end` has closed, or, for a compaction outside any Task (a manual
 * compaction, a model switch), its own, from the `compaction_begin` no `compaction_end` has
 * closed. Main-session boundaries decide; everything after the opener is kept, subagent
 * records included. Empty when nothing is open: a Trace written before Tasks were bracketed,
 * or a run whose first record has not reached the Trace yet.
 */
export function runningRecords(history: AmspRecord[]): AmspRecord[] {
  let task = -1;
  let compaction = -1;
  for (let i = 0; i < history.length; i++) {
    const msg = history[i]!;
    if ((msg.origin?.length ?? 0) > 0 || !isEventMessage(msg)) continue;
    const type = (msg.payload as { type?: string }).type;
    if (type === "task_begin") task = i;
    else if (type === "task_end") task = -1;
    else if (type === "compaction_begin") compaction = i;
    else if (type === "compaction_end") compaction = -1;
  }
  const from = task >= 0 ? task : compaction;
  return from >= 0 ? history.slice(from) : [];
}
