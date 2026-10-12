/**
 * A framed app as the guest of a page that goes on scrolling around it — the public landing page,
 * which frames the app with `embed=1` (frame.ts). Until the reader clicks into the frame, the app
 * must not behave as if it owned the window:
 *
 * - **No focus.** The chat composer focuses itself on mount. That would move the page's focus
 *   into the frame: the keyboard would scroll the frame instead of the page, and a screen reader
 *   would land inside it. A focus call does nothing until the reader has been inside.
 * - **No scrolling outward.** `scrollIntoView` scrolls every ancestor document, so a list keeping
 *   its active row in view would move the page. It waits for the reader as well.
 * - **The wheel scrolls the page.** The app's transcript and lists are scroll containers of their
 *   own, and would take the wheel from the page while the pointer crosses the frame. The wheel is
 *   cancelled in the frame and scrolls the page by the same amount instead.
 *
 * Once the reader has clicked into the frame (its document has focus), all three behave as in the
 * app; a click back on the page makes the frame a guest again. Whoever has focus, a focus call
 * never scrolls the page (`preventScroll`), as in the gallery's own frames.
 */

/** Pixels per wheel line, the browsers' common figure, for a wheel that reports in lines. */
const LINE_PX = 16;

/** The pieces of a window this module touches: the frame's own, and its parent through it. */
export interface GuestWindow {
  document: Pick<Document, "hasFocus">;
  parent: Pick<Window, "scrollBy" | "innerHeight">;
  HTMLElement: { prototype: Pick<HTMLElement, "focus"> };
  Element: { prototype: Pick<Element, "scrollIntoView"> };
  addEventListener(
    type: "wheel",
    listener: (event: WheelEvent) => void,
    options: AddEventListenerOptions,
  ): void;
}

export function installGuestFrame(win: GuestWindow): void {
  const visited = () => win.document.hasFocus();

  const focus = win.HTMLElement.prototype.focus;
  win.HTMLElement.prototype.focus = function (this: HTMLElement, options?: FocusOptions) {
    if (!visited()) return;
    focus.call(this, { ...options, preventScroll: true });
  };

  const scrollIntoView = win.Element.prototype.scrollIntoView;
  win.Element.prototype.scrollIntoView = function (
    this: Element,
    arg?: boolean | ScrollIntoViewOptions,
  ) {
    if (visited()) scrollIntoView.call(this, arg);
  };

  win.addEventListener(
    "wheel",
    (event) => {
      // A zoom gesture (pinch, or Ctrl with the wheel) stays the browser's.
      if (visited() || event.ctrlKey) return;
      try {
        const page = win.parent;
        const unit = event.deltaMode === 1 ? LINE_PX : event.deltaMode === 2 ? page.innerHeight : 1;
        page.scrollBy({ left: event.deltaX * unit, top: event.deltaY * unit, behavior: "instant" });
      } catch {
        // A page of another origin cannot be scrolled from here: leave the wheel to the browser.
        return;
      }
      event.preventDefault();
    },
    { capture: true, passive: false },
  );
}
