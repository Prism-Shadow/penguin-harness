/**
 * Bounded Trace-TAIL reads.
 *
 * `readTraceTolerant` pulls a whole shard into memory, so a windowed history read
 * (`tailLimit` / `before`) still paid the full file cost and then threw most of it
 * away: a 42MB shard answered `tailLimit=8` with 26MB, because the only way to know
 * where the last N units start was to parse everything before them.
 *
 * A shard is an append-only JSONL file, so the last N lines are reachable without
 * reading the head: seek to `size - windowBytes`, walk forward to the first newline
 * (everything before it is a partial line), and parse from there. The window grows
 * geometrically until it holds enough lines, which is what keeps a single oversized
 * line (this corpus has one 97KB line among 583-byte averages) from forcing the full read.
 *
 * A truncated read is NOT a whole shard, so every caller needs to know how much of
 * the head the window skipped: `TraceTailRead.skippedUnits` is that count, and both the
 * ordinals a window reports and whether the window reached the file's first unit are
 * derived from it. Dropping it silently renumbers a window's units from 0 — which makes
 * every `tracePosition` in the page point at the wrong record, and makes a window that
 * stopped mid-shard indistinguishable from one that reached the beginning of history.
 *
 * `fromEnd` counts back from the last complete line; `null` means "to the end of the
 * file", which is what a `before` cursor landing mid-shard asks for.
 */
import { open } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { parseTraceLines, readTraceTolerant } from "@prismshadow/penguin-core";
import type { OmniMessage } from "@prismshadow/penguin-core";

/** First read window; grows geometrically until it holds enough lines or hits the whole file. */
const TAIL_WINDOW_MIN = 256 * 1024;
/** A window larger than this is read whole rather than grown further. */
const TAIL_WINDOW_MAX = 8 * 1024 * 1024;

/**
 * A bounded tail read: the trailing `messages`, and how many units were skipped off the
 * head of the shard to get them. `messages[i]` is shard unit `skippedUnits + i`.
 */
export interface TraceTailRead {
  messages: OmniMessage[];
  /** Units preceding `messages` in the shard; 0 when the read reached the first unit. */
  skippedUnits: number;
}

/** Read at most `fromEnd` trailing lines (null = all of them). Returns them oldest-first. */
async function readTraceTail(filePath: string, fromEnd: number | null): Promise<TraceTailRead> {
  const fh = await open(filePath, "r");
  try {
    const { size } = await fh.stat();
    if (size === 0) return { messages: [], skippedUnits: 0 };
    // No cap requested, or the file is small enough to read outright.
    if (fromEnd === null || size <= TAIL_WINDOW_MIN) {
      const buf = Buffer.allocUnsafe(size);
      const { bytesRead } = await fh.read(buf, 0, size, 0);
      return {
        messages: parseTraceLines(buf.subarray(0, bytesRead).toString("utf8")),
        skippedUnits: 0,
      };
    }

    let window = TAIL_WINDOW_MIN;
    while (window < size && window < TAIL_WINDOW_MAX) {
      const start = size - window;
      const buf = Buffer.allocUnsafe(window);
      const { bytesRead } = await fh.read(buf, 0, window, start);
      const text = buf.subarray(0, bytesRead).toString("utf8");
      // The first line in the window is almost certainly partial; drop it.
      const nl = text.indexOf("\n");
      const usable = nl === -1 ? "" : text.slice(nl + 1);
      const lines = usable === "" ? [] : parseTraceLines(usable);
      if (lines.length >= fromEnd) {
        // How many complete units precede the ones being returned. Counted, not guessed:
        // an undercount would report an ordinal past the shard's end, and an overcount
        // would claim the window reached a unit it never read.
        //
        // Two stretches sit before the returned units, and both count: everything in
        // the shard ahead of the window, plus the lines inside the window that
        // `slice` drops off its front. Forgetting the second renumbers every ordinal
        // the window reports, which is what puts a page's tracePositions on the wrong
        // records.
        const ahead = lines.length - fromEnd;
        const skipped = (await countUnitsBefore(fh, start + nl + 1)) + ahead;
        return { messages: lines.slice(-fromEnd), skippedUnits: skipped };
      }
      if (start === 0) {
        return { messages: lines, skippedUnits: 0 };
      }
      window *= 4;
    }
    // Windowed attempts didn't cover it (or the file outgrew TAIL_WINDOW_MAX): fall back.
    const buf = Buffer.allocUnsafe(size);
    const { bytesRead } = await fh.read(buf, 0, size, 0);
    const lines = parseTraceLines(buf.subarray(0, bytesRead).toString("utf8"));
    return { messages: fromEnd === null ? lines : lines.slice(-fromEnd), skippedUnits: 0 };
  } finally {
    await fh.close();
  }
}

/**
 * Units completed in the shard's first `end` bytes. Counts newlines rather than parsing:
 * this runs once per bounded read, over the head only, and must stay cheap even for the
 * 42MB shards that motivated the bounded read in the first place.
 */
async function countUnitsBefore(fh: FileHandle, end: number): Promise<number> {
  let count = 0;
  let pos = 0;
  const chunk = Buffer.allocUnsafe(1024 * 1024);
  while (pos < end) {
    const want = Math.min(chunk.length, end - pos);
    const { bytesRead } = await fh.read(chunk, 0, want, pos);
    if (bytesRead === 0) break;
    for (let i = 0; i < bytesRead; i++) if (chunk[i] === 0x0a) count += 1;
    pos += bytesRead;
  }
  return count;
}

/**
 * Parse only the last `fromEnd` units of a shard (`null` = the whole shard).
 *
 * Read errors are NOT swallowed here on purpose: the caller already treats a missing
 * or unreadable shard as fatal for the window, and silently degrading to a truncated
 * history would be worse than failing the request.
 */
export async function readTraceTailLines(
  filePath: string,
  fromEnd: number | null,
): Promise<TraceTailRead> {
  try {
    return await readTraceTail(filePath, fromEnd);
  } catch (err) {
    // A shard being appended to right now can end mid-line; the tolerant reader is
    // what has always handled that, so keep it as the fallback for parse-level damage.
    if (err instanceof SyntaxError) {
      return { messages: await readTraceTolerant(filePath), skippedUnits: 0 };
    }
    throw err;
  }
}
