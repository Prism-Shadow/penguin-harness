/**
 * A finger dragging in a terminal that a full-screen program is drawing.
 *
 * xterm scrolls its own scrollback when a finger drags — but only while nothing has asked
 * for the mouse, and that is exactly the case this does not cover. A program on the
 * ALTERNATE SCREEN (Claude Code, and every TUI like it) has no scrollback in the terminal at
 * all: the transcript above the fold is the program's, it scrolls it itself, and the only
 * thing that ever asks it to is a wheel. So a phone, which has no wheel, could reach none of
 * it — the surface opened at the newest line and stayed there.
 *
 * The drag therefore becomes wheel reports at the finger's position (the wiring in
 * terminal-view.tsx dispatches them through xterm, so they are encoded in whatever mouse
 * protocol the program actually turned on). This module is the part with no DOM in it: how
 * far a finger has travelled, whether that is a scroll or a tap yet, and how many lines the
 * travel is worth.
 *
 * ONE LINE PER LINE OF TRAVEL, which is what makes it feel like the transcript is stuck to
 * the finger rather than flung by it: the cell height is the unit, the remainder is carried
 * to the next move, and the direction is the one every touch surface uses — a finger moving
 * up pulls later content into view, the same as a wheel rolled down.
 */

/**
 * How far a finger may travel before the gesture stops being a tap. Small enough that a
 * deliberate drag is never mistaken for a press, large enough that the jitter of a finger
 * leaving the glass is: below it nothing scrolls, and the browser's tap-to-click reaches the
 * program untouched.
 */
export const TOUCH_SLOP_PX = 8;

/**
 * One finger's travel, converted to wheel lines. Fed the raw touch coordinates by the view;
 * `start` / `end` bracket a gesture, and `move` answers with the lines that gesture has
 * earned since the last one.
 */
export class TouchScroll {
  /** Where the last move left the finger; null between gestures. */
  private lastY: number | null = null;
  /** Travel not yet paid out as whole lines, in pixels (positive = the finger moved up). */
  private pending = 0;
  private scrolling = false;

  /** Whether a gesture is being followed at all. */
  get started(): boolean {
    return this.lastY !== null;
  }

  /** Whether the travel has passed the slop, i.e. this is a scroll and no longer a tap. */
  get engaged(): boolean {
    return this.scrolling;
  }

  start(y: number): void {
    this.lastY = y;
    this.pending = 0;
    this.scrolling = false;
  }

  /**
   * The finger moved to `y`; answers the wheel lines it earned — positive for content
   * later in the transcript (a wheel rolled down), negative for earlier.
   *
   * Zero until the slop is passed, and zero for a cell height that is not yet measurable
   * (a terminal mid-attach): the travel is kept, so nothing is lost by asking early.
   */
  move(y: number, cellHeight: number): number {
    if (this.lastY === null) return 0;
    this.pending += this.lastY - y;
    this.lastY = y;
    if (!this.scrolling) {
      if (Math.abs(this.pending) < TOUCH_SLOP_PX) return 0;
      this.scrolling = true;
    }
    if (!(cellHeight > 0)) return 0;
    const lines = Math.trunc(this.pending / cellHeight);
    this.pending -= lines * cellHeight;
    return lines;
  }

  end(): void {
    this.lastY = null;
    this.pending = 0;
    this.scrolling = false;
  }
}
