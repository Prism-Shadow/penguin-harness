/**
 * Per-file record offsets for Trace JSONL, so a page of events costs one ranged read
 * instead of a parse of the whole file.
 *
 * The events endpoint used to read and parse the whole shard for every page it served: a
 * 25 MB shard walked in pages of 1000 was parsed fourteen times per panel open. Here each
 * file version is scanned once (the scan does parse every line, to decide which ones are
 * records), and every later page reads only the bytes of the records it returns.
 *
 * Ordinals equal `readTraceTolerant`'s, which is what `tracePosition` and the analysis'
 * `messageFrom`/`messageTo` are counted in: a line is a record iff its trimmed text is
 * non-empty and parses as JSON. A malformed middle line is skipped, as `parseTraceLines`
 * skips it. A final segment with no `\n` yet is a record exactly when it parses, as the
 * tolerant reader counts it; such a segment is never taken as scanned, so a crash-torn
 * tail that the writer later heals (with a leading `\n`, see core's `probeTornTail`) is
 * re-read and becomes the skipped middle line it then is.
 *
 * Versions: a file that only grew (same inode, larger size, mtime not earlier) is scanned
 * from where the last scan stopped; anything else (truncation, replacement, an in-place
 * rewrite of the same size) is scanned again from the start. The newest
 * `TRACE_LINE_INDEX_MAX_FILES` files are kept, and a file a caller retains is never dropped
 * while it is retained.
 *
 * The scan also keeps the file's `subagent` pointers (the records naming a child Session), so
 * finding a Session's children costs no read of its Trace once it is indexed.
 */
import fs from "node:fs/promises";
import type { AmspRecord } from "@prismshadow/penguin-core";

/**
 * How many files keep their index (least recently used is dropped first). Enough for a Session
 * with dozens of subagents to stay indexed between two reads of it: a working set larger than
 * this misses on every pass, since the least recently used file is always the next one asked.
 */
export const TRACE_LINE_INDEX_MAX_FILES = 256;

const NEWLINE = 0x0a;

/** One file version's record offsets. */
export interface TraceLineIndexEntry {
  ino: number;
  size: number;
  mtimeMs: number;
  /** Byte offset of each record's first byte; index = the record's ordinal. */
  starts: number[];
  /** One past each record's last byte (its `\n`, or the file's end for an unterminated last record). */
  ends: number[];
  /** Bytes scanned for good: one past the last `\n` seen. An unterminated tail lies beyond it. */
  scanned: number;
  /** The last record is an unterminated tail, re-read on the next growth. */
  provisionalTail: boolean;
  /** The `subagent` records, in file order: the ordinal, the child Session and when it was written. */
  pointers: Array<{ ordinal: number; sessionId: string; timestamp: string }>;
}

export interface TraceLineIndexOptions {
  maxFiles?: number;
  /** Test observability: every byte range read from disk, as [start, end). */
  observeRead?: (path: string, start: number, end: number) => void;
}

/** The record bytes [from, to) of `buf` hold (the tolerant reader's rule), or undefined for none. */
function recordAt(buf: Buffer, from: number, to: number): unknown {
  const text = buf.toString("utf8", from, to).trim();
  if (text === "") return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** The child Session a `subagent` pointer record names, or null for any other record. */
function pointerOf(record: unknown): { sessionId: string; timestamp: string } | null {
  const r = record as { type?: unknown; timestamp?: unknown; payload?: unknown } | null;
  if (r === null || typeof r !== "object" || r.type !== "event_msg") return null;
  const p = r.payload as { type?: unknown; session_id?: unknown } | null;
  if (p === null || typeof p !== "object" || p.type !== "subagent") return null;
  if (typeof p.session_id !== "string" || p.session_id === "") return null;
  return { sessionId: p.session_id, timestamp: typeof r.timestamp === "string" ? r.timestamp : "" };
}

export class TraceLineIndex {
  private readonly maxFiles: number;
  private readonly observeRead: ((path: string, start: number, end: number) => void) | undefined;
  /** Insertion order is recency: a hit moves its entry to the end. */
  private readonly entries = new Map<string, TraceLineIndexEntry>();
  /** Per-path refresh chain, so concurrent callers share one scan of a version. */
  private readonly queues = new Map<string, Promise<unknown>>();
  /** Files callers hold on to (`retain`), with how many hold each: never dropped meanwhile. */
  private readonly retained = new Map<string, number>();

  constructor(opts: TraceLineIndexOptions = {}) {
    this.maxFiles = Math.max(1, opts.maxFiles ?? TRACE_LINE_INDEX_MAX_FILES);
    this.observeRead = opts.observeRead;
  }

  /** Keeps `path`'s index from being dropped until the returned release is called. */
  retain(path: string): () => void {
    this.retained.set(path, (this.retained.get(path) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const n = (this.retained.get(path) ?? 1) - 1;
      if (n > 0) this.retained.set(path, n);
      else this.retained.delete(path);
    };
  }

  /** The index for the file as it is now: built on first sight, extended over appended bytes only. */
  async ensure(path: string): Promise<TraceLineIndexEntry> {
    const previous = this.queues.get(path) ?? Promise.resolve();
    const run = previous.catch(() => {}).then(() => this.refresh(path));
    this.queues.set(path, run);
    try {
      return await run;
    } finally {
      if (this.queues.get(path) === run) this.queues.delete(path);
    }
  }

  /**
   * Records [offset, offset + limit) of the file, in file order, read with one ranged read;
   * `total` is the file's record count. An offset at or past the end yields no events.
   */
  async readRange(
    path: string,
    offset: number,
    limit: number,
  ): Promise<{ events: AmspRecord[]; total: number }> {
    for (let attempt = 0; ; attempt++) {
      const entry = await this.ensure(path);
      const total = entry.starts.length;
      const from = Math.min(Math.max(0, offset), total);
      const to = Math.min(total, from + Math.max(0, limit));
      if (from >= to) return { events: [], total };
      // Copied before the read: a concurrent refresh may extend the arrays meanwhile.
      const starts = entry.starts.slice(from, to);
      const ends = entry.ends.slice(from, to);
      const base = starts[0]!;
      const buf = await this.readBytes(path, base, ends[ends.length - 1]!);
      const events: AmspRecord[] = [];
      try {
        for (let i = 0; i < starts.length; i++) {
          const text = buf.toString("utf8", starts[i]! - base, ends[i]! - base).trim();
          events.push(JSON.parse(text) as AmspRecord);
        }
      } catch (err) {
        // The bytes under a scanned record no longer parse: the file was replaced between the
        // stat and the read. Forget it and index the new file once; a second miss is real.
        this.entries.delete(path);
        if (attempt > 0) throw err;
        continue;
      }
      return { events, total };
    }
  }

  private async refresh(path: string): Promise<TraceLineIndexEntry> {
    const stat = await fs.stat(path);
    let entry = this.entries.get(path);
    const grownOnly =
      entry !== undefined &&
      stat.ino === entry.ino &&
      stat.size >= entry.size &&
      stat.mtimeMs >= entry.mtimeMs &&
      (stat.size > entry.size || stat.mtimeMs === entry.mtimeMs);
    if (entry === undefined || !grownOnly) {
      entry = {
        ino: stat.ino,
        size: 0,
        mtimeMs: stat.mtimeMs,
        starts: [],
        ends: [],
        scanned: 0,
        provisionalTail: false,
        pointers: [],
      };
      await this.scan(path, entry, stat.size);
    } else if (stat.size > entry.size) {
      if (!(await this.scan(path, entry, stat.size))) {
        // The byte before the scanned point is no longer a newline: not an append.
        entry = {
          ino: stat.ino,
          size: 0,
          mtimeMs: stat.mtimeMs,
          starts: [],
          ends: [],
          scanned: 0,
          provisionalTail: false,
          pointers: [],
        };
        await this.scan(path, entry, stat.size);
      }
    }
    entry.mtimeMs = stat.mtimeMs;
    this.entries.delete(path);
    this.entries.set(path, entry);
    if (this.entries.size > this.maxFiles) {
      // Least recently used first, passing over what a caller retains.
      for (const key of this.entries.keys()) {
        if (this.entries.size <= this.maxFiles) break;
        if (!this.retained.has(key)) this.entries.delete(key);
      }
    }
    return entry;
  }

  /**
   * Scans bytes [entry.scanned, size) into `entry`. Returns false, leaving `entry` untouched,
   * when the byte just before `scanned` is not the newline the last scan ended on.
   */
  private async scan(path: string, entry: TraceLineIndexEntry, size: number): Promise<boolean> {
    const from = entry.scanned;
    // One byte of overlap re-checks the newline the previous scan ended on.
    const readFrom = from > 0 ? from - 1 : 0;
    const buf = await this.readBytes(path, readFrom, size);
    let pos = from - readFrom;
    if (pos === 1 && buf[0] !== NEWLINE) return false;
    if (entry.provisionalTail) {
      entry.starts.pop();
      entry.ends.pop();
      if (entry.pointers.at(-1)?.ordinal === entry.starts.length) entry.pointers.pop();
      entry.provisionalTail = false;
    }
    const add = (record: unknown, start: number, end: number): void => {
      const pointer = pointerOf(record);
      if (pointer !== null) entry.pointers.push({ ordinal: entry.starts.length, ...pointer });
      entry.starts.push(start);
      entry.ends.push(end);
    };
    for (;;) {
      const nl = buf.indexOf(NEWLINE, pos);
      if (nl < 0) break;
      const record = recordAt(buf, pos, nl);
      if (record !== undefined) add(record, readFrom + pos, readFrom + nl + 1);
      pos = nl + 1;
    }
    entry.scanned = readFrom + pos;
    const tail = pos < buf.length ? recordAt(buf, pos, buf.length) : undefined;
    if (tail !== undefined) {
      add(tail, readFrom + pos, readFrom + buf.length);
      entry.provisionalTail = true;
    }
    entry.size = readFrom + buf.length;
    return true;
  }

  /** Bytes [start, end) of the file; fewer when the file is shorter than that now. */
  private async readBytes(path: string, start: number, end: number): Promise<Buffer> {
    this.observeRead?.(path, start, end);
    const length = Math.max(0, end - start);
    const buf = Buffer.allocUnsafe(length);
    const fh = await fs.open(path, "r");
    try {
      let filled = 0;
      while (filled < length) {
        const { bytesRead } = await fh.read(buf, filled, length - filled, start + filled);
        if (bytesRead === 0) break;
        filled += bytesRead;
      }
      return filled === length ? buf : buf.subarray(0, filled);
    } finally {
      await fh.close();
    }
  }
}
