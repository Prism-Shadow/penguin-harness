/**
 * Opening a link a terminal printed.
 *
 * Two kinds arrive here and both used to be broken:
 *
 * - **A URL in the output**, found by the web-links addon. Its built-in handler opens a
 *   BLANK window first (`window.open()` with no argument), clears `opener`, then assigns
 *   `location.href`. In a browser that is a way to get an opener-less tab; inside the
 *   desktop shell it is a link to `about:blank`, which the shell's window-open handler sees
 *   as an external address and hands to the system browser — so the address bar said
 *   `about:` and the real link never opened. `noopener` on a real `window.open` does the
 *   same job in one step, and hands the shell the address it is actually meant to route.
 * - **An OSC 8 hyperlink**, which is how a program that knows it is on a capable terminal
 *   writes a link — `gh`, and the agent CLIs printing a pull request. xterm routes those to
 *   `linkHandler`, and with none set it falls back to a `confirm()` warning.
 *
 * The scheme check is the point, not decoration: a terminal's output is not trusted input.
 * A program can print `javascript:` or `data:` as easily as `https:`, and this is exactly
 * the sink xterm's own documentation warns to validate.
 *
 * ## Why the click is handled here and not left to xterm
 *
 * xterm activates a link when the link object under the pointer at mouseup is the SAME
 * object it saw at mousedown — and it drops that object whenever the buffer changes. A
 * full-screen program redraws every frame (a spinner, a status line: every agent CLI does
 * this), so any click a human can make spans a redraw, and the identity check fails every
 * time. Measured: a 0ms down/up activated the link, a 30ms one did not. Windows Terminal
 * resolves the link under the pointer at the moment of the click instead, and that is the
 * experience this reproduces: xterm's own providers still say WHERE the links are (their
 * hover callbacks hand over the text and the buffer range), and `LinkClickTracker` decides
 * whether a click landed on one by position — a fact that survives a redraw, since the
 * program redraws the same link in the same place.
 */

/** Whether a link a terminal printed may be opened at all. */
export function isOpenableLink(uri: string): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false; // Not absolute: nothing to navigate to.
  }
  return url.protocol === "http:" || url.protocol === "https:";
}

/**
 * Opens a link from terminal output in a new tab, or does nothing when it is not one of the
 * two schemes a page may be at. Silent on refusal: the output that produced it is a
 * program's, not the reader's, and there is nothing for them to act on.
 */
export function openTerminalLink(uri: string): void {
  if (!isOpenableLink(uri)) return;
  window.open(uri, "_blank", "noopener,noreferrer");
}

/** A cell in xterm's link coordinates: 1-based column, 1-based row plus the scroll offset. */
export interface LinkPosition {
  x: number;
  y: number;
}

/** A link's extent, as xterm's providers report it: both ends inclusive, in LinkPosition terms. */
export interface LinkRange {
  start: LinkPosition;
  end: LinkPosition;
}

/**
 * xterm's own containment rule, kept in the same shape it uses: the range and the point
 * are flattened to a cell index across the row width, so a link that wraps across rows is
 * one interval rather than a rectangle.
 */
export function rangeContains(range: LinkRange, cols: number, pos: LinkPosition): boolean {
  const start = range.start.y * cols + range.start.x;
  const end = range.end.y * cols + range.end.x;
  const at = pos.y * cols + pos.x;
  return start <= at && at <= end;
}

/**
 * Where a pointer event landed, in link coordinates, given the screen box and the size of
 * the terminal grid. The screen element is sized to exactly cols × rows cells, so the cell
 * size falls out of its box — no reach into xterm's renderer for its private dimensions.
 */
export function positionFromPointer(
  client: { x: number; y: number },
  screen: { left: number; top: number; width: number; height: number },
  grid: { cols: number; rows: number; viewportY: number },
): LinkPosition | null {
  if (grid.cols <= 0 || grid.rows <= 0 || screen.width <= 0 || screen.height <= 0) return null;
  const col = Math.floor(((client.x - screen.left) / screen.width) * grid.cols);
  const row = Math.floor(((client.y - screen.top) / screen.height) * grid.rows);
  if (col < 0 || col >= grid.cols || row < 0 || row >= grid.rows) return null;
  return { x: col + 1, y: row + 1 + grid.viewportY };
}

/** How far a pointer may travel between down and up and still be a click, not a drag. */
export const CLICK_SLOP_PX = 4;

/**
 * Turns hover reports and pointer events into "the reader clicked this link".
 *
 * The hover callbacks are xterm telling us where a link is. That knowledge is kept past
 * xterm's own `leave` — a redraw fires `leave` for a link that is still there — and is
 * retired only when the pointer is seen outside the range, or when a different link is
 * hovered. A click opens the remembered link when both its down and its up landed inside
 * that range, with the pointer having moved no further than a click allows.
 */
export class LinkClickTracker {
  #hovered: { text: string; range: LinkRange } | null = null;
  #down: { pos: LinkPosition; clientX: number; clientY: number } | null = null;

  constructor(private readonly cols: () => number) {}

  /** xterm found a link under the pointer. */
  hover(text: string, range: LinkRange): void {
    this.#hovered = { text, range };
  }

  /**
   * xterm stopped tracking a link. Deliberately not forgotten here: this fires on every
   * redraw of a still-present link, which is the very case the tracker exists for. The
   * pointer's own movement retires it (see `move`).
   */
  leave(): void {}

  /** The pointer moved to `pos` (null: off the grid). */
  move(pos: LinkPosition | null): void {
    if (this.#hovered === null) return;
    if (pos === null || !rangeContains(this.#hovered.range, this.cols(), pos)) {
      this.#hovered = null;
    }
  }

  /** Primary button went down at `pos`. */
  down(pos: LinkPosition | null, clientX: number, clientY: number): void {
    this.#down = pos === null ? null : { pos, clientX, clientY };
  }

  /**
   * Primary button came up at `pos`. Answers the link to open, or null. The down is
   * consumed either way: a mouseup never opens on the strength of an earlier click.
   */
  up(pos: LinkPosition | null, clientX: number, clientY: number): string | null {
    const down = this.#down;
    this.#down = null;
    const link = this.#hovered;
    if (down === null || pos === null || link === null) return null;
    const moved = Math.hypot(clientX - down.clientX, clientY - down.clientY);
    if (moved > CLICK_SLOP_PX) return null; // A drag, even a short one, is a selection.
    const cols = this.cols();
    if (!rangeContains(link.range, cols, down.pos)) return null;
    if (!rangeContains(link.range, cols, pos)) return null;
    return link.text;
  }
}
