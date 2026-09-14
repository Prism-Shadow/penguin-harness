/**
 * The `<webview>` guest: the one place the app embeds a page it does not own.
 *
 * React is not asked to render this element. Everything that makes the guest work — it has to be
 * in the document before Electron upgrades it (asking an unattached `createElement("webview")` for
 * `loadURL` answers "not an API" even in a shell that supports it), its attributes are a different
 * vocabulary from HTML's, and its events (`dom-ready`, `did-fail-load`, `console-message`) have no
 * React counterpart. So the module owns a plain DOM node and the panel adopts it, the same way the
 * terminal pool adopts its xterm containers.
 *
 * Outside the desktop shell there is no such element at all: a plain browser tab gets an unknown
 * element, which is what `desktopShell()` exists to tell the panel apart from a shell that simply
 * failed to create a guest.
 */

/** The slice of Electron's `<webview>` element this panel uses. The real element has much more. */
export interface GuestElement extends HTMLElement {
  src: string;
  loadURL(url: string): Promise<void>;
  getURL(): string;
  reload(): void;
  stop(): void;
  executeJavaScript(code: string): Promise<unknown>;
}

export interface GuestFailEvent extends Event {
  errorCode: number;
  errorDescription: string;
  validatedURL: string;
  isMainFrame: boolean;
}

/** `did-start-navigation`: which document is starting to load — subframes raise it too. */
export interface GuestNavigateEvent extends Event {
  url: string;
  isMainFrame: boolean;
  isSameDocument: boolean;
}

export interface GuestConsoleEvent extends Event {
  message: string;
}

/**
 * Whether this window is the desktop shell's. The workbench is the only feature that needs to
 * know: with no shell there is no guest element and no way to read the user's page, and saying so
 * is better than a preview pane that stays blank for reasons the user cannot see.
 */
export function desktopShell(): boolean {
  return typeof navigator !== "undefined" && navigator.userAgent.includes("Electron");
}

/**
 * Create a guest pointed at `url` and put it in `container`, sized to fill it.
 *
 * `src` is written **before** the element enters the document, and that order is measured, not
 * stylistic: attaching starts the guest's own navigation to the `src` it was attached with, and a
 * `src` written later in the same turn as the attach is silently undone — the attribute reads back
 * `about:blank`, no `did-fail-load` fires, and the panel reports a connected blank page. (A `src`
 * one frame after the attach does take, as does `loadURL`, but only once `dom-ready` has fired:
 * Electron throws "must be attached to the DOM and the dom-ready event emitted" before that.)
 */
export function createGuest(container: HTMLElement, url: string): GuestElement {
  const guest = document.createElement("webview") as GuestElement;
  guest.setAttribute("src", url);
  guest.style.width = "100%";
  guest.style.height = "100%";
  guest.style.display = "flex";
  container.appendChild(guest);
  return guest;
}

/**
 * Whether the element is a working guest rather than an inert unknown tag. Electron installs the
 * element's API when it is inserted, so this is asked after insertion, and again on the next frame
 * if the first answer was no — asking synchronously is how the first probe in the M1 measurements
 * came back "unsupported" on a shell that worked.
 */
export function guestReady(el: GuestElement): boolean {
  return typeof el.loadURL === "function";
}

export function destroyGuest(el: GuestElement): void {
  try {
    el.stop();
  } catch {
    // A guest already gone throws here; there is nothing left to stop.
  }
  el.remove();
}
