/**
 * Prints the ```a2ui blocks of a streaming assistant reply as their text fallback.
 *
 * The Web App draws these blocks (a choice, a form, steps, a callout) as components. A terminal
 * cannot, so the CLI prints the readable Markdown each block stands for: core's
 * `toFallbackMarkdown`, the same text a messaging channel receives. A choice becomes numbered
 * options the user answers by typing. The reply arrives in small deltas, and a block is JSON that
 * means nothing until it is whole, so the filter reads the stream line by line. Text and other
 * code fences pass straight through. An a2ui fence is held from its opening line to its closing
 * one and then printed converted. The only other thing held back is a partial line that could
 * still become an a2ui opener, and only until its next characters rule that out, so ordinary
 * text never waits for its line to end.
 *
 * A line inside another fence is never read as an opener: a reply that shows a2ui syntax inside
 * a Markdown example prints the example as written.
 *
 * No language is passed to the fallback. `PENGUIN_LANG` defaults to English whatever the user
 * writes in, and the fallback's few labels sit inside the reply, so they follow the reply's own
 * language.
 */
import { toFallbackMarkdown } from "@prismshadow/penguin-core/a2ui";

/** An open fence: its character and run length, which a closing line must match or exceed. */
interface Fence {
  char: "`" | "~";
  size: number;
}

/** An opening fence line: up to three spaces, a run of 3+ backticks or tildes, the info string. */
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
/** The info string of an a2ui opener: the word alone. */
const A2UI_INFO = /^[ \t]*a2ui[ \t]*$/;
/**
 * A partial line that may still turn into an a2ui opener: indent, a run of one fence character,
 * then, once the run is three long, the start of the info string.
 */
const A2UI_OPEN_PREFIX = /^ {0,3}(?:`*|~*|(?:`{3,}|~{3,})[ \t]*(?:a|a2|a2u|a2ui[ \t]*)?)$/;
/** A closing fence line: indent, a run, and nothing after it but blanks. */
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

/**
 * The fence a line opens, or null. A backtick run followed by another backtick on the line is
 * inline code, not a fence.
 */
function fenceOpenedBy(line: string): { fence: Fence; info: string } | null {
  const m = FENCE_OPEN.exec(line);
  if (m === null) return null;
  const run = m[1]!;
  const info = m[2]!;
  if (run[0] === "`" && info.includes("`")) return null;
  return { fence: { char: run[0] as Fence["char"], size: run.length }, info };
}

function closes(line: string, fence: Fence): boolean {
  const m = FENCE_CLOSE.exec(line);
  return m !== null && m[1]![0] === fence.char && m[1]!.length >= fence.size;
}

export class A2uiStreamFilter {
  /** Where the reply is: ordinary text, inside another fence, or inside an a2ui fence. */
  private mode: "text" | "code" | "a2ui" = "text";
  /** The open fence while `mode` is not "text". */
  private fence: Fence | null = null;
  /** The current line so far, its newline included once that arrives. */
  private line = "";
  /** How much of `line` has already been passed through. */
  private passed = 0;
  /** An a2ui block's source, opener included, held until its closing fence. */
  private block = "";
  /**
   * A converted block is printed without its trailing newline, which is owed to whatever
   * follows. At the end of the reply the renderer's own line ending pays it, so a reply that
   * ends with a block ends exactly as a raw one would.
   */
  private newlineOwed = false;
  /** What the current push or flush releases. */
  private out = "";

  /** Takes one delta of the reply; returns what to print now, possibly nothing. */
  push(delta: string): string {
    let rest = delta;
    while (rest !== "") {
      const nl = rest.indexOf("\n");
      if (nl === -1) {
        this.line += rest;
        rest = "";
        this.partialLine();
      } else {
        this.line += rest.slice(0, nl + 1);
        rest = rest.slice(nl + 1);
        this.completeLine();
      }
    }
    return this.release();
  }

  /** The reply ended or was cut off: everything still held, including a block that never closed. */
  flush(): string {
    if (this.mode === "a2ui") {
      this.emit(toFallbackMarkdown(this.block + this.line).replace(/\n+$/, ""));
    } else {
      this.emit(this.line.slice(this.passed));
    }
    const out = this.release();
    this.mode = "text";
    this.fence = null;
    this.line = "";
    this.passed = 0;
    this.block = "";
    this.newlineOwed = false;
    return out;
  }

  private partialLine(): void {
    if (this.mode === "a2ui") return;
    // A CRLF reply's carriage return arrives before its newline and must not rule an opener out.
    const content = this.line.replace(/\r$/, "");
    if (this.mode === "text" && this.passed === 0 && A2UI_OPEN_PREFIX.test(content)) return;
    this.passThrough();
  }

  private completeLine(): void {
    const content = this.line.replace(/\r?\n$/, "");
    if (this.mode === "a2ui") {
      this.block += this.line;
      if (closes(content, this.fence!)) {
        this.emit(toFallbackMarkdown(this.block).replace(/\n+$/, ""));
        this.newlineOwed = true;
        this.block = "";
        this.mode = "text";
        this.fence = null;
      }
    } else if (this.mode === "code") {
      this.passThrough();
      if (closes(content, this.fence!)) {
        this.mode = "text";
        this.fence = null;
      }
    } else {
      const opened = fenceOpenedBy(content);
      if (opened !== null && this.passed === 0 && A2UI_INFO.test(opened.info)) {
        this.mode = "a2ui";
        this.fence = opened.fence;
        this.block = this.line;
      } else {
        if (opened !== null) {
          this.mode = "code";
          this.fence = opened.fence;
        }
        this.passThrough();
      }
    }
    this.line = "";
    this.passed = 0;
  }

  /** Passes the rest of the current line through. */
  private passThrough(): void {
    this.emit(this.line.slice(this.passed));
    this.passed = this.line.length;
  }

  private emit(text: string): void {
    if (text === "") return;
    if (this.newlineOwed) {
      this.out += "\n";
      this.newlineOwed = false;
    }
    this.out += text;
  }

  private release(): string {
    const out = this.out;
    this.out = "";
    return out;
  }
}
