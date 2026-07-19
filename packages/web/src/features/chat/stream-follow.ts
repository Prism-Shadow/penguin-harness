/**
 * Follow-decision logic for auto-stick-to-bottom in the message stream (pure logic,
 * unit-testable; issue #75).
 *
 * "Exiting follow" and "resuming follow" are two independent judgments:
 * - Exit: any user intent to scroll up takes effect immediately — detected from the input event
 *   itself for wheel-up / touch-drag-down (even if position doesn't change, e.g. already at the
 *   top), and from a scrollTop regression for scrollbar-drag-up / keyboard. This doesn't rely on
 *   an "80px from bottom" threshold — otherwise a short scroll area with less than 80px of
 *   scrollable slack could never exit, and streaming updates would keep fighting the upward
 *   gesture back and forth.
 * - Resume: only resumes once the user brings the viewport back near the bottom (within 80px).
 *   Programmatic stick-to-bottom only happens while following (idempotent); content shrinking
 *   (e.g. a group collapsing) that clamps scrollTop downward while still touching the bottom
 *   (≤1px) doesn't count as scrolling up and doesn't change intent.
 * - The first scroll event has no direction to judge from, so it initializes from position
 *   (≥80px from bottom is treated as being at a historical position, i.e. not following) — this
 *   doesn't depend on the call-ordering guarantee of "must stick to bottom programmatically right
 *   after mount."
 */
export interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

export interface StreamFollow {
  /** Whether it should currently auto-stick to bottom on streaming updates. */
  readonly stick: boolean;
  /** wheel: deltaY < 0 is scroll-up intent, exits follow immediately. */
  wheel(deltaY: number): void;
  touchStart(clientY: number): void;
  /** Touch drag: finger moving down = content scrolling up, exits follow. */
  touchMove(clientY: number): void;
  touchEnd(): void;
  /** scroll event (user scrolling and programmatic stick-to-bottom share this path): moving up exits; otherwise nearing the bottom resumes; the first event initializes from position. */
  scrolled(m: ScrollMetrics): void;
}

export function createStreamFollow(): StreamFollow {
  let stick = true;
  let lastTop: number | null = null;
  let touchY: number | null = null;
  return {
    get stick() {
      return stick;
    },
    wheel(deltaY) {
      if (deltaY < 0) stick = false;
    },
    touchStart(clientY) {
      touchY = clientY;
    },
    touchMove(clientY) {
      if (touchY !== null && clientY > touchY) stick = false;
      touchY = clientY;
    },
    touchEnd() {
      touchY = null;
    },
    scrolled(m) {
      const dist = m.scrollHeight - m.scrollTop - m.clientHeight;
      const prev = lastTop;
      lastTop = m.scrollTop;
      if (prev === null) {
        stick = dist < 80;
        return;
      }
      if (m.scrollTop < prev && dist > 1) {
        stick = false;
        return;
      }
      if (dist < 80) stick = true;
    },
  };
}
