/**
 * The contract between the code components and whatever highlights for them. Types only, so the
 * engine (highlighter-core.ts), a worker's message protocol and the React components can all name
 * it without pulling in each other.
 */

/**
 * A character range of one line wrapped in an element of its own: `line` is 0-based, `start` and
 * `end` are UTF-16 offsets into that line, end exclusive. The diff viewer marks changed words so.
 */
export interface CodeMark {
  line: number;
  start: number;
  end: number;
  className: string;
}

export interface HighlightOptions {
  /**
   * Emit each line as a block with no newline between them, for a surface that draws a line-number
   * gutter or lays lines out itself.
   */
  blockLines?: boolean;
  /** Ranges to wrap in their own element; they must not overlap. */
  marks?: readonly CodeMark[];
}

/**
 * Turns code into Shiki's dual-theme HTML, or undefined when the language is not one it carries.
 * May reject; a caller shows the code unhighlighted either way. The Web App's is worker-backed; any
 * function with this shape serves, and none at all leaves every surface plain.
 */
export type CodeHighlighter = (
  code: string,
  language: string,
  options?: HighlightOptions,
) => Promise<string | undefined>;
