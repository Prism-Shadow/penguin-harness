/**
 * CLI input-layer helpers: multi-line input and paste support.
 *
 * - `PasteFilter`: a Transform inserted between stdin and readline. Once terminal bracketed
 *   paste mode is enabled, pasted content is wrapped in `\x1b[200~` … `\x1b[201~`; this
 *   Transform strips that pair of markers, withholds the pasted content in between (not
 *   forwarded to readline, so internal newlines aren't split into multiple submissions), and
 *   emits it as a whole via a `paste` event. All other keystrokes are forwarded to readline
 *   unchanged, preserving line editing and Ctrl-C.
 * - `LineComposer`: assembles "line-by-line input + paste blocks" into one complete message.
 *   A single trailing backslash `\` means line continuation; a paste block goes into the
 *   pending buffer as a whole and is sent on Enter.
 */
import { Transform, type TransformCallback } from "node:stream";

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

/**
 * Return the trailing part of `data` that could be a prefix of `marker` (hold, kept for
 * concatenation with the next chunk); the rest is ready to process immediately (emit). Handles
 * the case where a marker straddles a data-chunk boundary.
 */
export function splitTrailingPartial(data: string, marker: string): { emit: string; hold: string } {
  const max = Math.min(marker.length - 1, data.length);
  for (let k = max; k > 0; k--) {
    if (data.endsWith(marker.slice(0, k))) {
      return { emit: data.slice(0, data.length - k), hold: data.slice(data.length - k) };
    }
  }
  return { emit: data, hold: "" };
}

export class PasteFilter extends Transform {
  private inPaste = false;
  private pasteBuf = "";
  private leftover = "";

  override _transform(chunk: Buffer | string, _enc: BufferEncoding, cb: TransformCallback): void {
    let data = this.leftover + chunk.toString("utf8");
    this.leftover = "";

    while (data.length > 0) {
      if (!this.inPaste) {
        const i = data.indexOf(PASTE_START);
        if (i === -1) {
          const { emit, hold } = splitTrailingPartial(data, PASTE_START);
          if (emit) this.push(emit);
          this.leftover = hold;
          data = "";
        } else {
          if (i > 0) this.push(data.slice(0, i));
          data = data.slice(i + PASTE_START.length);
          this.inPaste = true;
          this.pasteBuf = "";
        }
      } else {
        const j = data.indexOf(PASTE_END);
        if (j === -1) {
          const { emit, hold } = splitTrailingPartial(data, PASTE_END);
          this.pasteBuf += emit;
          this.leftover = hold;
          data = "";
        } else {
          this.pasteBuf += data.slice(0, j);
          data = data.slice(j + PASTE_END.length);
          this.inPaste = false;
          const text = this.pasteBuf;
          this.pasteBuf = "";
          this.emit("paste", text);
        }
      }
    }
    cb();
  }
}

/** Whether the line ends in a continuation (an odd number of trailing backslashes; an even count is treated as escaped literal backslashes). */
export function endsWithContinuation(line: string): boolean {
  const trailing = line.match(/(\\+)$/)?.[1] ?? "";
  return trailing.length % 2 === 1;
}

/**
 * Assembles line-by-line input and paste blocks into a complete message.
 * `pushTypedLine` returns `{ message }` when a message is ready, or `{}` while still
 * continuing/pending.
 */
export class LineComposer {
  private pending: string[] = [];

  pushTypedLine(line: string): { message?: string } {
    if (endsWithContinuation(line)) {
      this.pending.push(line.slice(0, -1));
      return {};
    }
    if (this.pending.length > 0) {
      const lines = line === "" ? this.pending : [...this.pending, line];
      this.pending = [];
      return { message: lines.join("\n") };
    }
    return { message: line };
  }

  /** Accept a paste block (strip trailing blank lines, normalize newlines); it goes into the pending buffer as a whole, waiting to be sent on Enter. */
  pushPaste(text: string): { lineCount: number; normalized: string } {
    const norm = text.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
    if (norm.length === 0) return { lineCount: 0, normalized: "" };
    const lines = norm.split("\n");
    this.pending.push(...lines);
    return { lineCount: lines.length, normalized: norm };
  }

  hasPending(): boolean {
    return this.pending.length > 0;
  }

  reset(): void {
    this.pending = [];
  }
}
