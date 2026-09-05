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
 *   after mount." Programmatic sticks therefore go through stickToBottom, which reports the
 *   landed position synchronously: the snap's own scroll event only arrives at the next
 *   rendering update, and content growing in between (an image decoding, a font swap) would
 *   otherwise make that first event look like a historical position and wrongly exit follow.
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
  /** Explicit re-entry (the back-to-bottom button): resumes follow immediately — the caller scrolls to the bottom right after, and the resulting scroll event sees a bottom position, keeping it stuck. */
  resume(): void;
  /**
   * Explicit exit with no gesture behind it: the bottom the reader had reached was not
   * the live bottom (a detached history range just re-joined the live tail below it), so
   * a stick judged from that position must not carry over. The next scroll event
   * initializes from position again, as the very first one does.
   */
  park(): void;
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
    resume() {
      stick = true;
      // Forget the last position: the caller jumps to the bottom right after, and that large
      // downward scroll must not be judged against a stale historical scrollTop.
      lastTop = null;
    },
    park() {
      stick = false;
      lastTop = null;
    },
  };
}

/** Minimal mutable view of a scroll container (structurally satisfied by HTMLElement; fakeable in unit tests). */
export interface ScrollContainer {
  scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}

/**
 * Programmatic stick-to-bottom: snap the container to its bottom AND synchronously report the
 * landed position to the follow model. The report is the point (the fix for entering a
 * conversation occasionally not landing at the bottom): the browser dispatches the snap's
 * scroll event asynchronously at the next rendering update, and late content growth (an image
 * finishing decode, a font swap, a code block settling) can land in between. That event then
 * reads a live position ≥80px above the new bottom with an unchanged scrollTop, and — as the
 * first scrolled() call — the position initialization would misread it as the user parked at a
 * historical position and exit follow; every later re-snap is gated on `stick`, so the view
 * stayed off-bottom until manual scrolling. Reporting synchronously seeds the model with the
 * snap itself, so the delayed event goes down the ordinary no-regression path and follow
 * survives (growth with an unchanged scrollTop never exits).
 */
export function stickToBottom(el: ScrollContainer, follow: StreamFollow): void {
  el.scrollTop = el.scrollHeight; // The browser clamps to the real bottom; read back the clamped value below.
  follow.scrolled({
    scrollTop: el.scrollTop,
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  });
}
