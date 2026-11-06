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
 * always byte-exact. A part never cuts a UTF-8 sequence, and names the first byte of its line.
 * The receiver (`LineCommitter`) commits only whole lines — every committed run starts at a line
 * start and ends with `\n` — and holds each partial line, by its start, until its last part, so
 * a transfer cut anywhere resumes from `off + partial length` and the copy equals the source.
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
  /** The first byte of the line this piece belongs to. */
  line: number;
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
  /** Where the line starts: `offset` unless these bytes are the rest of a line. */
  lineStart: number = offset,
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
      line: lineStart,
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
 * The receiving side of one file's frames, kept for as long as the receiver keeps that file.
 * Whole-line frames commit as they are; a part is held with the other parts of its line (by the
 * line's first byte) until the last one, and only a line whose every byte from its start was
 * held commits. A part whose line's head is not held — the rest of a partial this receiver no
 * longer has — is dropped, never committed: a run always starts at a line start. Several lines
 * may be held at once (the rest of a heavy line resumed after a light line longer than a frame).
 */
export class LineCommitter {
  /** Lines held in part, by their first byte: the bytes so far. */
  readonly #held = new Map<number, { chunks: Buffer[]; length: number }>();
  /** The line most recently added to, for `partial()`. */
  #newest: number | null = null;

  /** The whole lines this frame completes, or null while a line is still partial. */
  push(frame: LineFrame | PartFrame): CommittedLines | null {
    const bytes = frameBytes(frame);
    if (!("last" in frame)) {
      // Whole lines: they commit, and a held line they cover is moot.
      const whole = bytes.lastIndexOf(NEWLINE) + 1;
      if (whole === 0) return null;
      for (const start of [...this.#held.keys()]) {
        if (start >= frame.off && start < frame.off + whole) this.#drop(start);
      }
      return { off: frame.off, bytes: bytes.subarray(0, whole) };
    }
    let held = this.#held.get(frame.line);
    if (frame.off === frame.line) {
      held = { chunks: [], length: 0 }; // the line from its first byte: whatever was held restarts
      this.#held.set(frame.line, held);
    } else if (held === undefined || frame.line + held.length !== frame.off) {
      return null; // not the next piece of a line held from its start
    }
    held.chunks.push(bytes);
    held.length += bytes.length;
    this.#newest = frame.line;
    if (!frame.last) return null;
    const run = Buffer.concat(held.chunks, held.length);
    this.#drop(frame.line);
    const whole = run.lastIndexOf(NEWLINE) + 1;
    return whole === 0 ? null : { off: frame.line, bytes: run.subarray(0, whole) };
  }

  #drop(start: number): void {
    this.#held.delete(start);
    if (this.#newest === start) this.#newest = null;
  }

  /** The line most recently held in part — where it starts and its bytes so far — or null. */
  partial(): { off: number; bytes: Buffer } | null {
    const start = this.#newest ?? [...this.#held.keys()].at(-1);
    if (start === undefined) return null;
    const held = this.#held.get(start)!;
    return { off: start, bytes: Buffer.concat(held.chunks, held.length) };
  }

  /** Every line held in part. */
  partials(): Array<{ off: number; bytes: Buffer }> {
    return [...this.#held].map(([off, held]) => ({
      off,
      bytes: Buffer.concat(held.chunks, held.length),
    }));
  }
}
