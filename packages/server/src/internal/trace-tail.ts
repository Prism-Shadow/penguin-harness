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
 * (everything before it is a partial line), and parse from there. The window doubles
 * until it holds enough lines, which is what keeps a single oversized line (this
 * corpus has one 97KB line among 583-byte averages) from forcing the full read.
 *
 * `fromEnd` counts back from the last complete line; `null` means "to the end of the
 * file", which is what a `before` cursor landing mid-shard asks for.
 */
import { open } from "node:fs/promises";
import { parseTraceLines, readTraceTolerant } from "@prismshadow/penguin-core";
import type { OmniMessage } from "@prismshadow/penguin-core";

/** First read window; grows geometrically until it holds enough lines or hits the whole file. */
const TAIL_WINDOW_MIN = 256 * 1024;
/** A window larger than this is read whole rather than grown further. */
const TAIL_WINDOW_MAX = 8 * 1024 * 1024;

/** Read at most `fromEnd` trailing lines (null = all of them). Returns them oldest-first. */
async function readTraceTail(filePath: string, fromEnd: number | null): Promise<OmniMessage[]> {
  const fh = await open(filePath, "r");
  try {
    const { size } = await fh.stat();
    if (size === 0) return [];
    // No cap requested, or the file is small enough to read outright.
    if (fromEnd === null || size <= TAIL_WINDOW_MIN) {
      const buf = Buffer.allocUnsafe(size);
      const { bytesRead } = await fh.read(buf, 0, size, 0);
      return parseTraceLines(buf.subarray(0, bytesRead).toString("utf8"));
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
      if (lines.length >= fromEnd || start === 0) return lines.slice(-fromEnd);
      window *= 4;
    }
    // Windowed attempts didn't cover it (or the file outgrew TAIL_WINDOW_MAX): fall back.
    const buf = Buffer.allocUnsafe(size);
    const { bytesRead } = await fh.read(buf, 0, size, 0);
    const lines = parseTraceLines(buf.subarray(0, bytesRead).toString("utf8"));
    return fromEnd === null ? lines : lines.slice(-fromEnd);
  } finally {
    await fh.close();
  }
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
): Promise<OmniMessage[]> {
  try {
    return await readTraceTail(filePath, fromEnd);
  } catch (err) {
    // A shard being appended to right now can end mid-line; the tolerant reader is
    // what has always handled that, so keep it as the fallback for parse-level damage.
    if (err instanceof SyntaxError) return readTraceTolerant(filePath);
    throw err;
  }
}
