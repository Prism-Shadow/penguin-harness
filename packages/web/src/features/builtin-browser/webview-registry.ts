/**
 * The `<webview>` elements this window hosts, by guest key, so the dock panel can drive the
 * page on screen (back, reload, a typed address, DevTools) without owning the element.
 */
import { browserState } from "./browser-store";
import { guestForTab } from "./browser-state";

/** The partition every guest runs in: the built-in browser's own profile and sign-ins. */
export const BROWSER_PARTITION = "persist:penguin-browser";

/** The part of Electron's `<webview>` element API the app uses. */
export interface WebviewElement extends HTMLElement {
  getWebContentsId(): number;
  goBack(): void;
  goForward(): void;
  reload(): void;
  stop(): void;
  loadURL(url: string): Promise<void>;
  openDevTools(): void;
}

/**
 * Whether this window can host guests at all: Electron defines the `<webview>` element only
 * in the desktop app's main window. Everywhere else — a browser, a detached window — the
 * built-in browser is not offered.
 */
export function webviewSupported(): boolean {
  return typeof customElements !== "undefined" && customElements.get("webview") !== undefined;
}

const elements = new Map<string, WebviewElement>();

export function registerWebview(key: string, element: WebviewElement | null): void {
  if (element === null) elements.delete(key);
  else elements.set(key, element);
}

/** The element showing a tab in this window, if this window hosts it. */
export function webviewForTab(tabId: number | null): WebviewElement | null {
  const guest = guestForTab(browserState(), tabId);
  return guest === null ? null : (elements.get(guest.key) ?? null);
}
