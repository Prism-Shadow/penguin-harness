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
 * `TRACE_LINE_INDEX_MAX_FILES` files are kept.
 */
import fs from "node:fs/promises";
import type { OmniMessage } from "@prismshadow/penguin-core";

/** How many files keep their index (least recently used is dropped first). */
export const TRACE_LINE_INDEX_MAX_FILES = 32;

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
}

export interface TraceLineIndexOptions {
  maxFiles?: number;
  /** Test observability: every byte range read from disk, as [start, end). */
  observeRead?: (path: string, start: number, end: number) => void;
}

/** Whether bytes [from, to) of `buf` hold one Trace record (the tolerant reader's rule). */
function isRecord(buf: Buffer, from: number, to: number): boolean {
  const text = buf.toString("utf8", from, to).trim();
  if (text === "") return false;
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

export class TraceLineIndex {
  private readonly maxFiles: number;
  private readonly observeRead: ((path: string, start: number, end: number) => void) | undefined;
  /** Insertion order is recency: a hit moves its entry to the end. */
  private readonly entries = new Map<string, TraceLineIndexEntry>();
  /** Per-path refresh chain, so concurrent callers share one scan of a version. */
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(opts: TraceLineIndexOptions = {}) {
    this.maxFiles = Math.max(1, opts.maxFiles ?? TRACE_LINE_INDEX_MAX_FILES);
    this.observeRead = opts.observeRead;
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
  ): Promise<{ events: OmniMessage[]; total: number }> {
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
      const events: OmniMessage[] = [];
      try {
        for (let i = 0; i < starts.length; i++) {
          const text = buf.toString("utf8", starts[i]! - base, ends[i]! - base).trim();
          events.push(JSON.parse(text) as OmniMessage);
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
        };
        await this.scan(path, entry, stat.size);
      }
    }
    entry.mtimeMs = stat.mtimeMs;
    this.entries.delete(path);
    this.entries.set(path, entry);
    while (this.entries.size > this.maxFiles) {
      this.entries.delete(this.entries.keys().next().value!);
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
      entry.provisionalTail = false;
    }
    for (;;) {
      const nl = buf.indexOf(NEWLINE, pos);
      if (nl < 0) break;
      if (isRecord(buf, pos, nl)) {
        entry.starts.push(readFrom + pos);
        entry.ends.push(readFrom + nl + 1);
      }
      pos = nl + 1;
    }
    entry.scanned = readFrom + pos;
    if (pos < buf.length && isRecord(buf, pos, buf.length)) {
      entry.starts.push(readFrom + pos);
      entry.ends.push(readFrom + buf.length);
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
