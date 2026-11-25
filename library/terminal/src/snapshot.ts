/**
 * Screen snapshot -> ANSI restore stream, plus plain-text capture.
 *
 * This is what makes a browser refresh (or a reconnect from a second device) show the
 * terminal exactly as it was: the daemon keeps an authoritative headless xterm per pty, and
 * on attach it *re-renders* that grid as an escape-sequence stream the client's real xterm
 * replays into an identical screen. That beats the two obvious alternatives:
 *
 * - Replaying the raw pty byte log: unbounded, and full-screen programs (vim, top) replay
 *   as a flicker of stale frames.
 * - Sending a JSON cell grid: a 200k-object payload per attach, parsed on the UI thread.
 *
 * Cursor alignment is the subtle part. The restore writes `scrollback + rows` lines, so the
 * client's viewport ends up holding exactly the server's viewport, and only then is the
 * cursor placed with a viewport-relative CUP. Trailing blank rows are therefore written on
 * purpose — dropping them would shift every subsequent row and land the cursor in the wrong
 * place.
 */
import type { IBufferCell, IBufferLine, Terminal } from "@xterm/headless";

/** How much scrollback a restore carries by default. Enough to scroll back through, small enough to stay instant. */
export const DEFAULT_RESTORE_SCROLLBACK_LINES = 400;
export const MAX_RESTORE_SCROLLBACK_LINES = 2000;

export interface RenderRestoreOptions {
  scrollbackLines?: number;
  /** Appended after the cursor is positioned; see TerminalInputModeTracker.preamble(). */
  inputModePreamble?: string;
}

/** SGR parameters describing a cell's style, or "" for the default style. */
function styleOf(cell: IBufferCell): string {
  const params: string[] = [];
  if (cell.isBold()) params.push("1");
  if (cell.isDim()) params.push("2");
  if (cell.isItalic()) params.push("3");
  if (cell.isUnderline()) params.push("4");
  if (cell.isBlink()) params.push("5");
  if (cell.isInverse()) params.push("7");
  if (cell.isInvisible()) params.push("8");
  if (cell.isStrikethrough()) params.push("9");
  if (cell.isOverline()) params.push("53");

  if (cell.isFgRGB()) {
    const rgb = cell.getFgColor();
    params.push(`38;2;${(rgb >> 16) & 0xff};${(rgb >> 8) & 0xff};${rgb & 0xff}`);
  } else if (cell.isFgPalette()) {
    params.push(`38;5;${cell.getFgColor()}`);
  }

  if (cell.isBgRGB()) {
    const rgb = cell.getBgColor();
    params.push(`48;2;${(rgb >> 16) & 0xff};${(rgb >> 8) & 0xff};${rgb & 0xff}`);
  } else if (cell.isBgPalette()) {
    params.push(`48;5;${cell.getBgColor()}`);
  }

  return params.join(";");
}

/**
 * An untouched cell: never written and carrying no styling.
 *
 * A written space is deliberately NOT blank here — `echo "a "` and a line that merely ends
 * early are different buffers, and copying a restored screen should give back what was
 * actually printed. Only the never-written tail is dropped.
 */
function isUntouched(cell: IBufferCell): boolean {
  return cell.getChars() === "" && cell.isAttributeDefault();
}

function renderLine(line: IBufferLine, cols: number, scratch: IBufferCell, start = 0): string {
  // The never-written tail carries no information; dropping it keeps a restore of a
  // mostly-empty screen small (and avoids painting a background colour the user never set).
  let lastMeaningful = -1;
  for (let x = start; x < cols; x += 1) {
    const cell = line.getCell(x, scratch);
    if (cell && !isUntouched(cell)) lastMeaningful = x;
  }
  if (lastMeaningful === -1) return "";

  let out = "";
  let currentStyle = "";
  for (let x = start; x <= lastMeaningful; x += 1) {
    const cell = line.getCell(x, scratch);
    if (!cell) continue;
    const width = cell.getWidth();
    if (width === 0) continue; // right half of a wide character: already emitted

    const style = styleOf(cell);
    if (style !== currentStyle) {
      // Always reset first: an SGR run is absolute, so a style that only *removes* an
      // attribute (bold -> plain) still has to be expressed.
      out += style === "" ? "\x1b[0m" : `\x1b[0;${style}m`;
      currentStyle = style;
    }
    const chars = cell.getChars();
    out += chars === "" ? " " : chars;
  }
  if (currentStyle !== "") out += "\x1b[0m";
  return out;
}

/**
 * Renders the terminal's current screen as a self-contained ANSI stream: reset + clear,
 * scrollback, viewport, cursor placement, input-mode preamble.
 *
 * The client must already be at the terminal's cols/rows — the caller resizes the pty from
 * the attaching client's geometry before calling this, so both sides agree on the width the
 * lines were laid out at.
 */
export function renderRestoreAnsi(terminal: Terminal, options: RenderRestoreOptions = {}): string {
  const buffer = terminal.buffer.active;
  const scratch = buffer.getNullCell();
  const rows = terminal.rows;
  const cols = terminal.cols;
  const isAlternate = buffer.type === "alternate";

  const requested = Math.min(
    Math.max(options.scrollbackLines ?? DEFAULT_RESTORE_SCROLLBACK_LINES, 0),
    MAX_RESTORE_SCROLLBACK_LINES,
  );
  // The alternate buffer (vim, less, top) has no scrollback by definition, and a full-screen
  // program repaints on its own terms — restore only its viewport.
  const scrollbackLines = isAlternate ? 0 : Math.min(requested, buffer.baseY);
  const firstLine = buffer.baseY - scrollbackLines;
  const lastLine = buffer.baseY + rows - 1;

  const parts: string[] = [];
  // Reset attributes, leave the alternate buffer if we are in it, then clear screen +
  // scrollback so a reattach can never stack two copies of the screen.
  parts.push("\x1b[0m\x1b[?1049l\x1b[H\x1b[2J\x1b[3J");
  if (isAlternate) parts.push("\x1b[?1049h\x1b[H");

  // A resync may start with autowrap disabled by a TUI. The input mode preamble below
  // restores the program's choice after painting.
  parts.push("\x1b[?7h");
  let emptyMarginStyle: string | undefined;
  for (let y = firstLine; y <= lastLine; y += 1) {
    const line = buffer.getLine(y);
    const content = line ? renderLine(line, cols, scratch) : "";
    if (y > firstLine) {
      if (!line?.isWrapped) {
        parts.push("\r\n");
      } else if (emptyMarginStyle !== undefined) {
        // A wide glyph wrapped early, or the program erased the previous row's tail.
        // A double-width space printed in the last column wraps without filling that tail.
        // Erase it on the new row before rendering the actual continuation.
        parts.push(`\x1b[${cols}G`);
        if (emptyMarginStyle) parts.push(`\x1b[0;${emptyMarginStyle}m`);
        parts.push("\u3000\r");
        if (emptyMarginStyle) parts.push("\x1b[0m");
        parts.push("\x1b[2X");
      } else if (!content) {
        // Even an erased continuation needs a printable cell to trigger the pending wrap.
        parts.push(" \r\x1b[X");
      }
    }
    parts.push(content);
    const edge = line?.getCell(cols - 1, scratch);
    emptyMarginStyle = edge?.getWidth() === 1 && edge.getChars() === "" ? styleOf(edge) : undefined;
  }

  // CUP can address the last column, but cannot leave a wrap pending just beyond it.
  // Reprint the rightmost glyph when the next live byte should start a continuation.
  let cursorColumn = buffer.cursorX;
  let cursorGlyph = "";
  if (cursorColumn === cols) {
    const line = buffer.getLine(buffer.baseY + buffer.cursorY);
    if (line) {
      cursorColumn = line.getCell(cols - 1, scratch)?.getWidth() === 0 ? cols - 2 : cols - 1;
      cursorGlyph = renderLine(line, cols, scratch, cursorColumn);
    }
  }
  parts.push(`\x1b[${buffer.cursorY + 1};${cursorColumn + 1}H`, cursorGlyph);
  if (options.inputModePreamble) parts.push(options.inputModePreamble);
  return parts.join("");
}

export interface CaptureLinesOptions {
  /** Line index into scrollback+viewport; negative counts from the end (-1 = last line). */
  start?: number;
  end?: number;
}

export interface CaptureLinesResult {
  lines: string[];
  totalLines: number;
}

function resolveIndex(value: number | undefined, total: number, fallback: "start" | "end"): number {
  if (total === 0) return fallback === "start" ? 0 : -1;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback === "start" ? 0 : total - 1;
  }
  const resolved = value < 0 ? total + value : value;
  if (resolved < 0) return 0;
  if (resolved >= total) return total - 1;
  return resolved;
}

/**
 * Plain-text view of the screen. This is the read path for
 * anything that is not a rendering client — tests, and later agents that need to see what a
 * command printed without parsing escape sequences.
 */
export function captureLines(
  terminal: Terminal,
  options: CaptureLinesOptions = {},
): CaptureLinesResult {
  const buffer = terminal.buffer.active;
  const totalLines = buffer.baseY + terminal.rows;
  const all: string[] = [];
  for (let y = 0; y < totalLines; y += 1) {
    all.push(buffer.getLine(y)?.translateToString(true) ?? "");
  }
  const startIndex = resolveIndex(options.start, totalLines, "start");
  const endIndex = resolveIndex(options.end, totalLines, "end");
  if (totalLines === 0 || startIndex > endIndex) return { lines: [], totalLines };
  return { lines: all.slice(startIndex, endIndex + 1), totalLines };
}
