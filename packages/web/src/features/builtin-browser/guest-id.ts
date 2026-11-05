/**
 * A new page's tab id, as soon as its `<webview>` element knows it. The window claims the open
 * request with that id, and the claim is what makes the new tab the active one, lays it on
 * screen and lets the server answer the request.
 *
 * The element learns its webContents id when the app's request to create the guest answers, and
 * Electron usually reports the guest's first events (`did-attach`, `did-start-loading`) before
 * that answer arrives; asked then, the element throws. The next event is the page's commit, or
 * its `dom-ready`, which a slow page reaches only seconds later, and all that time the new tab
 * stayed off screen behind the previous one. So once an event finds no id yet, the element is
 * asked again every few milliseconds, since the answer is already on its way. Every later event
 * asks too.
 */

/** The part of Electron's `<webview>` element this needs. */
export interface GuestIdSource {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
  getWebContentsId(): number;
}

/** The element's events that may be the first to find the id. */
const EVENTS = ["did-attach", "did-start-loading", "load-commit", "dom-ready"] as const;

/** How often an element that has attached is asked again for its id (ms). */
export const GUEST_ID_RETRY_MS = 16;
/** How many times it is asked again at most: two seconds' worth. */
export const GUEST_ID_RETRIES = 125;

/** Calls `onId` once with the element's tab id, as early as it can; the returned function stops watching. */
export function watchGuestId(view: GuestIdSource, onId: (tabId: number) => void): () => void {
  let done = false;
  let retries = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function stop(): void {
    done = true;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    for (const name of EVENTS) view.removeEventListener(name, ask);
  }

  function ask(): void {
    if (done) return;
    let tabId: number;
    try {
      tabId = view.getWebContentsId();
    } catch {
      // Attached, but the element has not been told its id yet.
      if (timer === null && retries < GUEST_ID_RETRIES) {
        retries += 1;
        timer = setTimeout(() => {
          timer = null;
          ask();
        }, GUEST_ID_RETRY_MS);
      }
      return;
    }
    stop();
    onId(tabId);
  }

  for (const name of EVENTS) view.addEventListener(name, ask);
  return stop;
}
