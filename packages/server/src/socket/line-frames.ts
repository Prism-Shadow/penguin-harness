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

/** Most bytes of text one event carries. */
export const FRAME_TEXT_BUDGET = 32 * 1024;

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
export function frameBytes(_frame: LineFrame | PartFrame): Buffer {
  throw new Error("frameBytes: not implemented yet");
}

/**
 * Frames for `bytes`, which start at file offset `offset`: whole lines up to `budget` bytes of
 * text per frame, a line longer than that as parts. Bytes after the last `\n` (an unterminated
 * tail) are not framed: only whole lines leave.
 */
export function lineFrames(
  _bytes: Buffer,
  _offset: number,
  _budget: number = FRAME_TEXT_BUDGET,
): Iterable<LineFrame | PartFrame> {
  throw new Error("lineFrames: not implemented yet");
}

/** A run of whole lines the receiver may write at `off`. */
export interface CommittedLines {
  off: number;
  bytes: Buffer;
}

/**
 * The receiving side of one file's frames: whole lines pass through, parts are held until the
 * last one. A part that does not continue the held partial starts a new one (the sender
 * restarts a line from its first byte unless it was told of the partial).
 */
export class LineCommitter {
  /** The lines this frame completes, or null while a line is still partial. */
  push(_frame: LineFrame | PartFrame): CommittedLines | null {
    throw new Error("LineCommitter: not implemented yet");
  }

  /** The held partial line — where it starts and the bytes so far — or null. */
  partial(): { off: number; bytes: Buffer } | null {
    return null;
  }
}
