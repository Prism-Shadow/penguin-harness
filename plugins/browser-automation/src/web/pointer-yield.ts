/**
 * When the built-in browser's pages let the pointer through to the app under them.
 *
 * A page is another document laid over the dock: while the pointer is on it, the app hears
 * nothing. So a press in the app turns the pages transparent to the pointer until it is released,
 * and a drag that starts outside a page (a dock resize, a tab drag, a text selection) keeps
 * reaching the app while it crosses one.
 *
 * A drag of one of the app's open pages (a running app's row, on its way to a conversation's
 * dock) is held the same way from its start to its end. The browser cancels the press the moment
 * such a drag begins, which would hand the pointer back to the page lying over the very dock the
 * row is dropped on. Every other drag keeps that release, so text or a link dragged from the app
 * can still be dropped into a page.
 */
import { isOpenPageDrag } from "@prismshadow/penguin-web-plugin";

/** Starts watching the window for `layer`, the element holding the pages; returns the stop. */
export function yieldPointerToApp(layer: HTMLElement): () => void {
  let dragging = false;
  const release = () => {
    if (!dragging) layer.style.pointerEvents = "";
  };
  const press = (event: PointerEvent) => {
    if (event.button === 0) layer.style.pointerEvents = "none";
  };
  const endDrag = () => {
    dragging = false;
    release();
  };
  // No pointer event is delivered during a drag, so a move with no button held means the press
  // or the drag is over, even when its own ending never reached this window.
  const move = (event: PointerEvent) => {
    if (event.buttons === 0 && layer.style.pointerEvents !== "") endDrag();
  };
  const startDrag = (event: DragEvent) => {
    if (!isOpenPageDrag(event.dataTransfer)) return;
    dragging = true;
    layer.style.pointerEvents = "none";
    // dragend is dispatched at the dragged element. One removed from the document during the
    // drag is no longer below the window, so its dragend is heard only on the element itself.
    event.target?.addEventListener("dragend", endDrag, { once: true });
  };
  window.addEventListener("pointerdown", press, true);
  window.addEventListener("pointerup", release, true);
  window.addEventListener("pointercancel", release, true);
  window.addEventListener("pointermove", move, true);
  window.addEventListener("blur", release);
  // Bubble phase: the row writes what it carries in its own dragstart handler.
  window.addEventListener("dragstart", startDrag);
  window.addEventListener("dragend", endDrag, true);
  window.addEventListener("drop", endDrag, true);
  return () => {
    window.removeEventListener("pointerdown", press, true);
    window.removeEventListener("pointerup", release, true);
    window.removeEventListener("pointercancel", release, true);
    window.removeEventListener("pointermove", move, true);
    window.removeEventListener("blur", release);
    window.removeEventListener("dragstart", startDrag);
    window.removeEventListener("dragend", endDrag, true);
    window.removeEventListener("drop", endDrag, true);
  };
}
