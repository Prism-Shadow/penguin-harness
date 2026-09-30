/**
 * A frame's own height changes must not read as window resizes to the app inside it.
 *
 * The app closes its floating panels on a window resize (a menu, a listbox, a tooltip): the
 * panel was placed once against its trigger, and a resize may have moved the trigger. When the
 * page around a library frame grows the frame so an open menu fits, the frame's window gets a
 * `resize` too — and the menu would close the instant it was given room. Nothing moved: the
 * frame only grew at the bottom, and every trigger stays where it was. So a resize the frame
 * asked for itself is stopped here before the app's listeners hear it.
 *
 * The listener is registered before the app mounts, so it runs first; at the window (the
 * event's target) listeners run in registration order, and `stopImmediatePropagation` keeps
 * the rest from running. A resize the frame did not ask for — the reader resizing the browser
 * with a standalone board open — passes through as before. The page's own measurer still
 * needs to hear the frame's growth (a dialog's body opens up to the taller viewport and may
 * need more), so it subscribes through `onSelfResize` rather than the window event.
 */

/** How long a requested resize stays expected; a request the page never applied then lapses. */
const EXPECT_MS = 1000;

let expectedUntil = 0;
const listeners = new Set<() => void>();

/** Installs the guard on `win`. Call once, before the app mounts. */
export function installSelfResizeGuard(win: Window): void {
  win.addEventListener(
    "resize",
    (event) => {
      if (Date.now() > expectedUntil) return;
      expectedUntil = 0;
      event.stopImmediatePropagation();
      for (const listener of listeners) listener();
    },
    true,
  );
}

/** Hears the resizes the guard swallowed; returns the unsubscribe. */
export function onSelfResize(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The frame is about to be resized at its own request: the next resize is its own. */
export function expectSelfResize(): void {
  expectedUntil = Date.now() + EXPECT_MS;
}
