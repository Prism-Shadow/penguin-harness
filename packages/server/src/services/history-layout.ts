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
import { historyFileKey, parseHistoryFileKey } from "./history-wire.js";
import type { HistoryFileKey, HistoryMessage, HistorySegment, HistoryStub } from "../api/types.js";

/** Where one returned record was read from. */
export interface RecordSource {
  agentId: string;
  sessionId: string;
  fileIndex: number;
  ordinal: number;
  /**
   * The origin chain the history expansion prepended to the line's own `origin`, outer to
   * inner; null for the Session's own records, which carry a `tracePosition` instead.
   */
  chain: string[] | null;
}

/** One file's record offsets by ordinal (trace-line-index.ts's `starts`/`ends`). */
export interface LineOffsets {
  starts: readonly number[];
  ends: readonly number[];
}

/** The runs a window's records were read from, in window order. */
export function windowLayout(
  records: readonly AmspRecord[],
  sources: readonly RecordSource[],
  offsets: (k: HistoryFileKey) => LineOffsets | null,
): HistorySegment[] {
  const out: HistorySegment[] = [];
  let open: { segment: HistorySegment; lastOrdinal: number; chainKey: string } | null = null;
  for (let i = 0; i < records.length; i++) {
    const source = sources[i];
    if (source === undefined) throw new Error("a window record has no source");
    const k = historyFileKey(source.agentId, source.sessionId, source.fileIndex);
    const lines = offsets(k);
    const start = lines?.starts[source.ordinal];
    const end = lines?.ends[source.ordinal];
    if (start === undefined || end === undefined) {
      throw new Error(`no line offsets for record ${source.ordinal} of ${k}`);
    }
    const chainKey = source.chain === null ? "" : JSON.stringify(source.chain);
    if (
      open !== null &&
      open.segment.k === k &&
      open.chainKey === chainKey &&
      open.lastOrdinal + 1 === source.ordinal
    ) {
      open.segment.to = [end, source.ordinal + 1];
      open.lastOrdinal = source.ordinal;
      continue;
    }
    const segment: HistorySegment = {
      k,
      from: [start, source.ordinal],
      to: [end, source.ordinal + 1],
      origin: source.chain === null ? null : [...source.chain],
    };
    out.push(segment);
    open = { segment, lastOrdinal: source.ordinal, chainKey };
  }
  return out;
}

/** Records in `bytes` by the tolerant reader's rule: a line is one iff it parses as JSON. */
function parseRecords(bytes: Buffer): AmspRecord[] {
  const out: AmspRecord[] = [];
  for (const line of bytes.toString("utf8").split("\n")) {
    const text = line.trim();
    if (text === "") continue;
    try {
      out.push(JSON.parse(text) as AmspRecord);
    } catch {
      // A malformed line is no record, as readTraceTolerant skips it.
    }
  }
  return out;
}

/** A run's records as the window holds them: its own with their position, a child's with its chain. */
function placed(
  segment: HistorySegment,
  fileIndex: number,
  ordinal: number,
  raw: AmspRecord,
): HistoryMessage {
  if (segment.origin === null) return { ...raw, tracePosition: { fileIndex, ordinal } };
  return { ...raw, origin: [...segment.origin, ...(raw.origin ?? [])] };
}

/**
 * The window's records from its layout: each run's bytes parsed by the tolerant reader's rule,
 * the Session's own records given their `tracePosition`, a child's their `origin`. A record a
 * stub stands for is taken from the stub as it is, so a run need not be held where its heavy
 * lines are not. Null — never a wrong answer — when a run's bytes are not to be had or do not
 * hold the record count the layout names.
 */
export async function assembleWindow(
  layout: readonly HistorySegment[],
  bytes: (k: HistoryFileKey, start: number, end: number) => Promise<Buffer | null> | Buffer | null,
  stubs: readonly HistoryStub[] = [],
): Promise<HistoryMessage[] | null> {
  const stubsOf = new Map<HistoryFileKey, HistoryStub[]>();
  for (const stub of stubs) {
    const list = stubsOf.get(stub.k) ?? [];
    list.push(stub);
    stubsOf.set(stub.k, list);
  }
  for (const list of stubsOf.values()) list.sort((a, b) => a.ordinal - b.ordinal);
  const out: HistoryMessage[] = [];
  for (const segment of layout) {
    const file = parseHistoryFileKey(segment.k);
    if (file === null) return null;
    const [fromOffset, fromOrdinal] = segment.from;
    const [toOffset, toOrdinal] = segment.to;
    const inside = (stubsOf.get(segment.k) ?? []).filter(
      (s) => s.ordinal >= fromOrdinal && s.ordinal < toOrdinal,
    );
    // The run between the stubs, gap by gap: [offset, ordinal) up to each stub, then past it.
    let offset = fromOffset;
    let ordinal = fromOrdinal;
    const gap = async (endOffset: number, endOrdinal: number): Promise<boolean> => {
      if (endOrdinal === ordinal) return true;
      const run = await bytes(segment.k, offset, endOffset);
      if (run === null) return false;
      const records = parseRecords(run);
      if (records.length !== endOrdinal - ordinal) return false;
      records.forEach((raw, i) => out.push(placed(segment, file.fileIndex, ordinal + i, raw)));
      return true;
    };
    for (const stub of inside) {
      if (!(await gap(stub.offset, stub.ordinal))) return null;
      out.push(stub.record);
      offset = stub.offset + stub.length;
      ordinal = stub.ordinal + 1;
    }
    if (!(await gap(toOffset, toOrdinal))) return null;
  }
  return out;
}
