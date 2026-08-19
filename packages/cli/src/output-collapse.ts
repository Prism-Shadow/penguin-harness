/**
 * Display-only head/tail collapsing of long tool outputs (pure logic, unit-tested).
 *
 * The chat REPL floods the screen when a tool returns hundreds of lines (a long
 * `exec_command` result, a whole file from `read_file`). Collapsed rendering keeps the
 * first TOOL_OUTPUT_HEAD_LINES streaming live (so a long-running command still shows
 * immediate progress), holds the rest back, and settles at stream end: everything still
 * fits -> print it all (short outputs stay untouched); otherwise print one dim elision
 * marker (`… (+N lines …)`) followed by the last TOOL_OUTPUT_TAIL_LINES — the tail is
 * where an exec result carries its verdict. The marker never hides fewer than 2 lines
 * (hiding a single line would replace it with a marker line and save nothing).
 *
 * This is presentation only: the full output still reaches the model, the Trace, and the
 * Web App unchanged. The chat REPL turns it off with `--verbose` / the `/verbose` toggle;
 * `penguin run` keeps full output (piped runs — e.g. a nested CLI driven through
 * `exec_command` — must not lose lines).
 */

/** Completed head lines that keep streaming live before the hold-back starts. */
export const TOOL_OUTPUT_HEAD_LINES = 4;
/** Trailing lines shown after the elision marker when the stream ends. */
export const TOOL_OUTPUT_TAIL_LINES = 4;

/** Settled tail of one collapsed stream: the lines to print now and how many stay hidden (0 = nothing was elided). */
export interface CollapsedFlush {
  hidden: number;
  lines: string[];
}

/**
 * Collapse state machine for one streaming tool-output segment. `push` is fed each raw
 * chunk (chunks split lines arbitrarily) and returns the prefix to write through live;
 * `flush` settles the held-back remainder at stream end.
 */
export class ToolOutputCollapser {
  /** Completed lines still allowed to stream live (a line mid-stream stays live until its newline spends one). */
  private headRemaining: number;
  private readonly tail: number;
  /**
   * Held-back completed lines, bounded to tail+1: one more than the tail so `flush` can
   * tell "fits entirely" (<= tail+1 with nothing dropped -> print all) from "must elide"
   * (anything dropped -> hidden >= 2 by construction). Keeps memory bounded however long
   * the output runs.
   */
  private buffered: string[] = [];
  /** Lines pushed out of the bounded buffer (always hidden). */
  private dropped = 0;
  /** The held-back line still awaiting its newline (chunks split lines arbitrarily). */
  private partial = "";
  /** Head allowance spent: everything from here on is held back until flush. */
  private holding = false;

  constructor(head = TOOL_OUTPUT_HEAD_LINES, tail = TOOL_OUTPUT_TAIL_LINES) {
    this.headRemaining = head;
    this.tail = tail;
  }

  /** Feeds one streamed chunk; returns the prefix to write live (empty once the head allowance is spent). */
  push(chunk: string): string {
    let live = "";
    if (!this.holding) {
      let idx = 0;
      while (idx < chunk.length && this.headRemaining > 0) {
        const nl = chunk.indexOf("\n", idx);
        if (nl === -1) {
          // The current head line continues past this chunk: it stays live; its eventual
          // newline is what spends the allowance.
          idx = chunk.length;
          break;
        }
        idx = nl + 1;
        this.headRemaining -= 1;
      }
      live = chunk.slice(0, idx);
      chunk = chunk.slice(idx);
      if (chunk.length === 0) return live;
      this.holding = true;
    }
    const parts = (this.partial + chunk).split("\n");
    this.partial = parts.pop()!;
    for (const line of parts) this.bufferLine(line);
    return live;
  }

  private bufferLine(line: string): void {
    this.buffered.push(line);
    if (this.buffered.length > this.tail + 1) {
      this.buffered.shift();
      this.dropped += 1;
    }
  }

  /** Whether `flush` would print anything (any line was held back). */
  hasBuffered(): boolean {
    return this.buffered.length > 0 || this.partial.length > 0;
  }

  /**
   * Settles the held-back remainder at stream end. An unterminated final line counts as a
   * line. Nothing dropped -> everything held back still fits (at most tail+1 lines): print
   * it all, hidden 0 — a short output renders exactly as it would have uncollapsed. Anything
   * dropped -> print the last `tail` lines and report the rest hidden (always >= 2).
   */
  flush(): CollapsedFlush {
    if (this.partial.length > 0) {
      this.bufferLine(this.partial);
      this.partial = "";
    }
    let result: CollapsedFlush;
    if (this.dropped === 0) {
      result = { hidden: 0, lines: this.buffered };
    } else {
      result = {
        hidden: this.dropped + (this.buffered.length - this.tail),
        lines: this.buffered.slice(-this.tail),
      };
    }
    this.buffered = [];
    this.dropped = 0;
    return result;
  }
}

/** Head/tail split of one collapsed (non-streaming) output; `hidden` 0 = short enough, shown whole. */
export interface CollapsedLines {
  head: readonly string[];
  hidden: number;
  tail: readonly string[];
}

/**
 * Collapses an already-complete output (resumed-history rendering): same shape as the
 * streaming collapse — up to head + tail + 1 lines render whole (the marker must hide at
 * least 2 lines to earn its row), longer outputs keep the first `head` and last `tail`.
 */
export function collapseLines(
  lines: readonly string[],
  head = TOOL_OUTPUT_HEAD_LINES,
  tail = TOOL_OUTPUT_TAIL_LINES,
): CollapsedLines {
  if (lines.length <= head + tail + 1) return { head: lines, hidden: 0, tail: [] };
  return {
    head: lines.slice(0, head),
    hidden: lines.length - head - tail,
    tail: lines.slice(-tail),
  };
}
