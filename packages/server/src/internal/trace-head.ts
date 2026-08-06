/**
 * Bounded Trace-head reads (shared by the Session index's session_meta backfill and the
 * Trace listing's first-prompt title fallback): parse only the head window of a shard
 * instead of pulling a whole multi-MB file into memory.
 */
import { open } from "node:fs/promises";
import { parseTraceLinesSalvage, readTraceSalvage } from "@prismshadow/penguin-core";
import type { OmniMessage } from "@prismshadow/penguin-core";

/** Head window for Trace head reads: generous for a long system prompt, far below a whole multi-MB shard. */
export const TRACE_HEAD_BYTES = 256 * 1024;

/**
 * Parse a Trace file's head window only. session_meta is the first line core writes to
 * every shard (and the first user prompt follows right behind it in the earliest shard),
 * so a bounded read finds them without pulling the whole file into memory.
 * The window is cut at its last newline (the tail fragment is incomplete); a first line
 * larger than the whole window falls back to the full salvage read.
 * Parsing is salvage-based (corrupt lines skipped silently): head reads run on every
 * listing scan, and a shard corrupted before the Writer serialized appends (issue #215)
 * must not break the whole listing or spam a warning per scan.
 */
export async function readTraceHead(filePath: string): Promise<OmniMessage[]> {
  const fh = await open(filePath, "r");
  let text: string;
  let truncated: boolean;
  try {
    // allocUnsafe: only subarray(0, bytesRead) is ever read, so the uninitialized tail never leaks.
    const { buffer, bytesRead } = await fh.read(
      Buffer.allocUnsafe(TRACE_HEAD_BYTES),
      0,
      TRACE_HEAD_BYTES,
      0,
    );
    text = buffer.subarray(0, bytesRead).toString("utf8");
    truncated = bytesRead === TRACE_HEAD_BYTES;
  } finally {
    await fh.close();
  }
  if (!truncated) return parseTraceLinesSalvage(text).messages;
  const nl = text.lastIndexOf("\n");
  if (nl === -1) return (await readTraceSalvage(filePath)).messages;
  return parseTraceLinesSalvage(text.slice(0, nl + 1)).messages;
}
