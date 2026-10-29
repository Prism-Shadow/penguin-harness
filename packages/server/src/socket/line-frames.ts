/**
 * Line-delimited bytes as socket frames, and the receiver that commits them whole.
 *
 * A route that ships a JSONL file (a Trace) over a stream cuts it into events of at most
 * `FRAME_TEXT_BUDGET` of text: whole lines where they fit, and a line longer than the budget as
 * `part`s that join byte-exact on the other side. Small events are what keeps a slow link
 * shared: with the credit window (stream-answer.ts), whatever else rides the same socket — or
 * the same ssh session under it — waits behind a couple of seconds of bytes at most.
 *
 * Offsets are file byte offsets; `text` is the bytes as UTF-8, or base64 (`b64`) for the rare
 * run of bytes that is not valid UTF-8 (a crash-torn line a later write healed), so a copy is
 * always byte-exact. A part never cuts a UTF-8 sequence. The receiver (`LineCommitter`) commits
 * only whole lines — every committed run ends with `\n` — and holds a partial line until its
 * last part, so a transfer cut anywhere resumes from `off + partial length` and the copy equals
 * the source.
 */

import { isUtf8 } from "node:buffer";

/** Most bytes of text one event carries. */
export const FRAME_TEXT_BUDGET = 32 * 1024;

const NEWLINE = 0x0a;

/** Whole lines: bytes [off, off + byte length) of the file, ending with `\n`. */
export interface LineFrame {
  off: number;
  text: string;
  /** `text` is base64, not UTF-8. */
  b64?: true;
}

/** A piece of one line longer than the budget, in order; `last` ends the line. */
export interface PartFrame {
  off: number;
  text: string;
  last: boolean;
  b64?: true;
}

/** The file bytes a frame carries. */
export function frameBytes(frame: LineFrame | PartFrame): Buffer {
  return Buffer.from(frame.text, frame.b64 === true ? "base64" : "utf8");
}

/** `bytes` as frame text: UTF-8 when it round-trips, base64 when it would not. */
function asText(bytes: Buffer): { text: string; b64?: true } {
  return isUtf8(bytes)
    ? { text: bytes.toString("utf8") }
    : { text: bytes.toString("base64"), b64: true };
}

/**
 * Frames for `bytes`, which start at file offset `offset`: whole lines up to `budget` bytes of
 * text per frame, a line longer than that as parts. Bytes after the last `\n` (an unterminated
 * tail) are not framed: only whole lines leave.
 */
export function* lineFrames(
  bytes: Buffer,
  offset: number,
  budget: number = FRAME_TEXT_BUDGET,
): Iterable<LineFrame | PartFrame> {
  const end = bytes.lastIndexOf(NEWLINE) + 1;
  let pos = 0;
  while (pos < end) {
    const firstEnd = bytes.indexOf(NEWLINE, pos) + 1;
    if (firstEnd - pos > budget) {
      yield* partFrames(bytes.subarray(pos, firstEnd), offset + pos, budget);
      pos = firstEnd;
      continue;
    }
    let cut = firstEnd;
    while (cut < end) {
      const next = bytes.indexOf(NEWLINE, cut) + 1;
      if (next - pos > budget) break;
      cut = next;
    }
    yield { off: offset + pos, ...asText(bytes.subarray(pos, cut)) };
    pos = cut;
  }
}

/**
 * Bytes of one line (or the rest of one, from `offset`) as parts of at most `budget` bytes,
 * never cutting a UTF-8 sequence; the last part is the one that reaches the bytes' end.
 */
export function* partFrames(
  line: Buffer,
  offset: number,
  budget: number = FRAME_TEXT_BUDGET,
): Iterable<PartFrame> {
  const utf8 = isUtf8(line);
  let pos = 0;
  while (pos < line.length) {
    let cut = Math.min(line.length, pos + budget);
    if (utf8) {
      // Back off to a character's first byte: a continuation byte reads 10xxxxxx.
      while (cut < line.length && cut > pos + 1 && (line[cut]! & 0xc0) === 0x80) cut -= 1;
    }
    const piece = line.subarray(pos, cut);
    yield {
      off: offset + pos,
      text: utf8 ? piece.toString("utf8") : piece.toString("base64"),
      last: cut === line.length,
      ...(utf8 ? {} : { b64: true as const }),
    };
    pos = cut;
  }
}

/** A run of whole lines the receiver may write at `off`. */
export interface CommittedLines {
  off: number;
  bytes: Buffer;
}

/**
 * The receiving side of one file's frames, kept for as long as the receiver keeps that file:
 * whole lines pass through, and the bytes of a line not yet ended are held until its `\n`
 * arrives. Whole-line frames for other places in the file pass through and leave a held line
 * alone (a window's light lines come before the rest of a heavy line held from an earlier
 * stream); a part that does not continue the held line starts a line afresh, and what was held
 * is given up — the sender restarts a line from its first byte unless it was told of the
 * partial, so a part never continues anything but the held line.
 */
export class LineCommitter {
  #held: { off: number; chunks: Buffer[]; length: number } | null = null;

  /** The whole lines this frame completes, or null while a line is still partial. */
  push(frame: LineFrame | PartFrame): CommittedLines | null {
    const bytes = frameBytes(frame);
    const held = this.#held;
    if (held !== null && held.off + held.length === frame.off) {
      if (!bytes.includes(NEWLINE)) {
        // Still inside the line: kept as a chunk, joined once when the line ends.
        held.chunks.push(bytes);
        held.length += bytes.length;
        return null;
      }
      return this.#settle(
        held.off,
        Buffer.concat([...held.chunks, bytes], held.length + bytes.length),
      );
    }
    if (!("last" in frame)) {
      // Whole lines elsewhere: they pass through. A trailing piece (a sender that framed bytes
      // not ending with `\n`) is the newest partial and replaces any held one.
      const whole = bytes.lastIndexOf(NEWLINE) + 1;
      if (whole < bytes.length) {
        this.#held = {
          off: frame.off + whole,
          chunks: [bytes.subarray(whole)],
          length: bytes.length - whole,
        };
      }
      return whole === 0 ? null : { off: frame.off, bytes: bytes.subarray(0, whole) };
    }
    return this.#settle(frame.off, bytes);
  }

  /** Commits `run` (at `off`) up to its last `\n` and holds the rest. */
  #settle(off: number, run: Buffer): CommittedLines | null {
    const whole = run.lastIndexOf(NEWLINE) + 1;
    this.#held =
      whole < run.length
        ? { off: off + whole, chunks: [run.subarray(whole)], length: run.length - whole }
        : null;
    return whole === 0 ? null : { off, bytes: run.subarray(0, whole) };
  }

  /** The held partial line — where it starts and the bytes so far — or null. */
  partial(): { off: number; bytes: Buffer } | null {
    const held = this.#held;
    if (held === null) return null;
    return { off: held.off, bytes: Buffer.concat(held.chunks, held.length) };
  }
}
