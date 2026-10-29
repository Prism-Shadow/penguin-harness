/**
 * A history window as the Trace bytes it was read from, and back.
 *
 * Only a machine can cut a window of its own Session (the cut needs every earlier byte), but
 * the hub that caches that Session's Trace lines can rebuild the window's records from them.
 * So the machine sends the window as a layout — the ordered runs of each Trace file its records
 * come from (history-lines.ts) — and `assembleWindow` turns a layout plus the file bytes back
 * into exactly the records `TraceService.readMessagesPage` returned: the Session's own records
 * with their `tracePosition`, a child Session's with their `origin` chain.
 *
 * The layout is derived from the one implementation, never a second one: the trace service
 * reports the file and ordinal each record it returns was read from
 * (`TraceService.readHistoryWindow`'s `sources`), and `windowLayout` groups consecutive records
 * of one file into runs, with byte offsets from that file's line index.
 */
import type { AmspRecord } from "@prismshadow/penguin-core";
import type { HistoryFileKey, HistoryMessage, HistorySegment, HistoryStub } from "../api/types.js";

/** Where one returned record was read from. */
export interface RecordSource {
  agentId: string;
  sessionId: string;
  fileIndex: number;
  ordinal: number;
}

/** One file's record offsets by ordinal (trace-line-index.ts's `starts`/`ends`). */
export interface LineOffsets {
  starts: readonly number[];
  ends: readonly number[];
}

/** The runs a window's records were read from, in window order. */
export function windowLayout(
  _records: readonly AmspRecord[],
  _sources: readonly RecordSource[],
  _offsets: (k: HistoryFileKey) => LineOffsets | null,
): HistorySegment[] {
  throw new Error("windowLayout: not implemented yet");
}

/**
 * The window's records from its layout: each run's bytes parsed by the tolerant reader's rule,
 * the Session's own records given their `tracePosition`, a child's their `origin`. A record a
 * stub stands for is taken from the stub as it is, so a run need not be held where its heavy
 * lines are not. Null — never a wrong answer — when a run's bytes are not to be had or do not
 * hold the record count the layout names.
 */
export async function assembleWindow(
  _layout: readonly HistorySegment[],
  _bytes: (k: HistoryFileKey, start: number, end: number) => Promise<Buffer | null> | Buffer | null,
  _stubs: readonly HistoryStub[] = [],
): Promise<HistoryMessage[] | null> {
  throw new Error("assembleWindow: not implemented yet");
}
