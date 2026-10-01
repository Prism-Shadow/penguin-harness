/**
 * How tall a library frame must be: tall enough for what is actually painted, not only for
 * the board. The app renders its overlays — menus, listboxes, tooltips, toasts, dialogs — in
 * portals on the body with fixed positioning, and a dropdown inside the board is absolutely
 * positioned below its trigger; none of them add to the board's own box, so a frame sized to
 * the board alone cut them off.
 *
 * The rule, pure so it is unit-tested (`frameHeight`):
 * - the board's box, or its overflowing content (a menu opened inside it) plus a margin;
 * - every floating overlay's bottom plus a margin, so a menu or a tooltip below its trigger
 *   is whole and a stack of toasts fits;
 * - an overlay that covers the viewport (a dialog's backdrop, a drawer, a sheet) is sized from
 *   the panel inside it — the tallest part of it that does not itself span the viewport — with
 *   a margin above and below, and never under `dialogMin`, so a dialog is never squeezed. A
 *   part spanning the viewport is left out because it follows the frame's height and would
 *   otherwise grow it without end.
 * The height shrinks back as soon as an overlay closes; it is a function of what is there.
 *
 * `measureFrameHeight` reads those rects off a document. The overlays are the direct children of
 * the body other than the app's root, and the outermost fixed-position boxes inside the board: a
 * panel the app renders in place rather than in a portal (the bottom sheet, the drawer) is
 * anchored to the viewport, not laid out in the board, so it is measured as an overlay. Counted as
 * board content, a sheet parked below the viewport before it slides in would put the board's
 * bottom near twice the frame's height, and the frame would double on every measure.
 */

export interface MeasuredMain {
  /** The board's own box bottom. */
  bottom: number;
  /** The lowest visible edge of anything inside the board, positioned or not. */
  contentBottom: number;
}

export interface MeasuredOverlay {
  /** The overlay's own bottom edge. */
  bottom: number;
  /** Whether it spans the viewport top to bottom: a dialog's backdrop, a drawer, a sheet. */
  covers: boolean;
  /** For a covering overlay: the tallest part inside it that does not span the viewport. */
  panelHeight: number;
}

export interface FrameHeightOptions {
  /** Room kept under a floating overlay, and above and below a dialog's panel, px. */
  margin: number;
  /** The least a frame shows while a covering overlay is open, px. */
  dialogMin: number;
}

export const FRAME_HEIGHT_OPTIONS: FrameHeightOptions = { margin: 16, dialogMin: 560 };

export function frameHeight(
  main: MeasuredMain,
  overlays: readonly MeasuredOverlay[],
  { margin, dialogMin }: FrameHeightOptions = FRAME_HEIGHT_OPTIONS,
): number {
  let height = main.bottom;
  if (main.contentBottom > main.bottom) height = Math.max(height, main.contentBottom + margin);
  for (const overlay of overlays) {
    height = overlay.covers
      ? Math.max(height, dialogMin, overlay.panelHeight + 2 * margin)
      : Math.max(height, overlay.bottom + margin);
  }
  return Math.ceil(Math.max(0, height));
}

/** A box spanning the viewport top to bottom, give or take a pixel of border. */
export function coversViewport(
  rect: { top: number; bottom: number },
  viewportHeight: number,
): boolean {
  return rect.top <= 1 && rect.bottom >= viewportHeight - 1;
}

/** A painted box: anything with no size is not on screen and says nothing about the height. */
const painted = (rect: DOMRect) => rect.width > 0 && rect.height > 0;

/** The lowest visible edge of an element and everything inside it, bar the `skip` subtrees. */
function lowestEdge(el: Element, skip: readonly Element[] = []): number {
  let bottom = -Infinity;
  const rect = el.getBoundingClientRect();
  if (painted(rect)) bottom = rect.bottom;
  for (const child of el.querySelectorAll("*")) {
    if (skip.some((s) => s.contains(child))) continue;
    const r = child.getBoundingClientRect();
    if (painted(r)) bottom = Math.max(bottom, r.bottom);
  }
  return bottom;
}

/** The tallest part inside a covering overlay that does not itself span the viewport. */
function panelHeightIn(el: Element, viewportHeight: number): number {
  let tallest = 0;
  for (const child of el.querySelectorAll("*")) {
    const r = child.getBoundingClientRect();
    if (painted(r) && r.height < viewportHeight - 1) tallest = Math.max(tallest, r.height);
  }
  return tallest;
}

/** The outermost fixed-position boxes inside an element, in document order. */
function fixedBoxesIn(el: Element): Element[] {
  const view = el.ownerDocument.defaultView;
  if (!view) return [];
  const found: Element[] = [];
  for (const child of el.querySelectorAll("*")) {
    if (found.some((f) => f.contains(child))) continue;
    if (view.getComputedStyle(child).position === "fixed") found.push(child);
  }
  return found;
}

/** Reads the board and the overlays off a document and applies the rule. */
export function measureFrameHeight(
  doc: Document,
  main: HTMLElement,
  root: HTMLElement,
  options: FrameHeightOptions = FRAME_HEIGHT_OPTIONS,
): number {
  const viewportHeight = doc.defaultView?.innerHeight ?? 0;
  const inPlace = fixedBoxesIn(main);
  const measuredMain: MeasuredMain = {
    bottom: main.getBoundingClientRect().bottom,
    contentBottom: lowestEdge(main, inPlace),
  };
  const portals = Array.from(doc.body.children).filter(
    (el) => el !== root && el.tagName !== "SCRIPT" && el.tagName !== "STYLE",
  );
  const overlays: MeasuredOverlay[] = [];
  for (const el of [...portals, ...inPlace]) {
    const rect = el.getBoundingClientRect();
    if (coversViewport(rect, viewportHeight)) {
      overlays.push({
        bottom: rect.bottom,
        covers: true,
        panelHeight: panelHeightIn(el, viewportHeight),
      });
    } else {
      const bottom = lowestEdge(el);
      if (bottom > -Infinity) overlays.push({ bottom, covers: false, panelHeight: 0 });
    }
  }
  return frameHeight(measuredMain, overlays, options);
}
