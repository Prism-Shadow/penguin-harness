/**
 * Pure helpers for the desktop shell — no Electron imports, so they unit-test under
 * plain vitest.
 */

/** Parses the server's port-announcement file: a decimal port on the first line. */
export function parsePortFile(content: string): number | null {
  const m = /^(\d{1,5})\s*$/.exec(content.trim());
  if (!m) return null;
  const port = Number(m[1]);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

/**
 * The App origin for a port. Always `localhost`: on loopback the App is canonicalized
 * onto localhost and `127.0.0.1` is reserved as the preview host, which rejects /api.
 */
export function appOriginFor(port: number): string {
  return `http://localhost:${port}`;
}

/** The window's first navigation: redeems the shell's one-shot token for a cookie session. */
export function desktopLoginUrl(origin: string, token: string): string {
  return `${origin}/api/auth/claim?token=${encodeURIComponent(token)}`;
}

/**
 * Whether a navigation target stays inside the app window. Only the app origin itself
 * qualifies; everything else (external sites, and Workspace previews on the 127.0.0.1
 * counterpart host) opens in the system browser.
 */
export function isAppUrl(url: string, origin: string | null): boolean {
  if (origin === null) return false;
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * The host Workspace previews are served from. On loopback the server always puts the App on
 * `localhost` and previews on this name (loopbackHostRoles in the server's preview-token
 * service), and the desktop always loads the App on `localhost` (appOriginFor, attach mode).
 */
const PREVIEW_HOST = "127.0.0.1";

/**
 * Whether a URL belongs to this instance's local surface: the app origin itself or its
 * loopback counterpart on the same port, which is where Workspace previews are served.
 * Preview windows navigate freely within it; anything else is external and belongs in
 * the system browser.
 */
export function isLocalSurfaceUrl(url: string, origin: string | null): boolean {
  if (origin === null) return false;
  let target: URL;
  let app: URL;
  try {
    target = new URL(url);
    app = new URL(origin);
  } catch {
    return false;
  }
  if (target.protocol !== app.protocol || target.port !== app.port) return false;
  return LOOPBACK_HOSTS.has(target.hostname) && LOOPBACK_HOSTS.has(app.hostname);
}

/** "Open in a new tab" for a Workspace HTML file: mints a preview token, then 302s to the preview host. */
const PREVIEW_REDIRECT_PATH = /^\/api\/sessions\/[^/]+\/files\/preview-redirect$/;

/** A terminal detached from the dock into a window of its own. */
const TERMINAL_PATH = "/terminal";

/**
 * Whether a URL may be handed to the operating system: a web page or a mail link. Never a
 * file, a script or a custom protocol handler — a preview window runs Agent-written HTML, and
 * `shell.openExternal` on such a URL launches whatever the OS has registered for it.
 */
export function isExternalScheme(url: string): boolean {
  let protocol: string;
  try {
    protocol = new URL(url).protocol;
  } catch {
    return false;
  }
  return protocol === "http:" || protocol === "https:" || protocol === "mailto:";
}

/** What a window-open request may do; see classifyWindowOpen. */
export type WindowOpenAction = "window" | "external" | "deny";

/**
 * Routes a request to open a new window — a `target="_blank"` link or a `window.open` call,
 * from the main window or from any window it opened.
 *
 * `window`, a window of this app, is for the three URL shapes that cannot work anywhere else:
 * - the Workspace preview hand-off, `/api/sessions/<id>/files/preview-redirect` on the app
 *   origin. It mints its token with the session cookie, so the system browser would get a 401;
 * - a preview page, `/preview/…` on the preview host, which is where a preview's own links and
 *   `window.open` calls land;
 * - a detached terminal, `/terminal` on the app origin: the page needs the session, and the
 *   opener watches the window it gets back to return the tab to the dock when it closes.
 *
 * `external`, the system browser, is for an http(s) or mailto URL that is not this instance —
 * another site, or another port on this machine, such as a dev server a conversation started.
 *
 * `deny` is everything else. Every other path on the app origin serves the SPA, and the
 * preview host redirects every non-preview path back to it, so a relative link in a chat reply
 * (`/chat/x.html`) would boot a second copy of the App in a new window on a page that does not
 * exist — one more window per click. Other schemes (`file:`, custom protocol handlers) are
 * refused outright rather than handed to the OS (isExternalScheme). With no origin, which no
 * window ever sees, everything is refused.
 *
 * `about:blank` — `window.open()` with no URL — is refused with the other schemes, and that is
 * load-bearing: a blank window inherits its opener's origin, so the opener can script it, and a
 * handler is not told which frame asked. The Files panel previews Agent-written HTML in an
 * iframe that allows popups, so a blank window allowed for any purpose would be a hidden window
 * that HTML could own. The Web App therefore asks for none when it is drawn by this shell's
 * renderer (it reads `Electron/` in the user agent, whatever session it holds): it opens
 * Penguin Go's authorization URL directly, which this rule routes to the system browser.
 */
export function classifyWindowOpen(url: string, origin: string | null): WindowOpenAction {
  if (origin === null || !isExternalScheme(url)) return "deny";
  const target = new URL(url);
  if (!isLocalSurfaceUrl(url, origin)) return "external";
  // Parses: isLocalSurfaceUrl answers false for an origin that does not.
  const appHost = new URL(origin).hostname;
  if (target.hostname === appHost) {
    return PREVIEW_REDIRECT_PATH.test(target.pathname) || target.pathname === TERMINAL_PATH
      ? "window"
      : "deny";
  }
  return target.hostname === PREVIEW_HOST && target.pathname.startsWith("/preview/")
    ? "window"
    : "deny";
}

/**
 * What a window of this app looks like, whatever the page that opened it asked for.
 *
 * Electron builds a new window's options as `{ show: true, width: 800, height: 600,
 * ...featuresFromThePage, ...override }` (lib/browser/guest-window-manager.ts), and the
 * page's `window.open` feature string may set `show`, `skipTaskbar`, `opacity`, `transparent`,
 * `focusable`, a position and size limits (allowedWindowOptions in
 * lib/browser/parse-features-string.ts). A preview page is Agent-written HTML, and a window it
 * is allowed to open must never be one the user cannot see: with `show=no`, `skipTaskbar=yes`
 * or `opacity=0` the "window" a `/preview/` URL earns would be as hidden as the blank one
 * classifyWindowOpen refuses, and same-origin with the preview that opened it. So every key
 * that can hide, dim, or shrink a window to nothing is spelled out here, and the override
 * spreads this last. Position is not an option — `left`/`top` land as `x`/`y` — so the window
 * is centered after creation, and a page's `moveTo`/`resizeTo` is refused (see
 * guardOpenedWindow in main.ts). The size limits are the defaults restated: 0 is Electron's
 * "no maximum".
 */
export const APP_WINDOW_OPTIONS = {
  width: 1100,
  height: 800,
  minWidth: 320,
  minHeight: 240,
  maxWidth: 0,
  maxHeight: 0,
  show: true,
  skipTaskbar: false,
  opacity: 1,
  transparent: false,
  focusable: true,
  hiddenInMissionControl: false,
  enableLargerThanScreen: false,
  autoHideMenuBar: true,
} as const;

/**
 * A URL as a log line may show it: origin and path for a web URL, the scheme alone for any
 * other. A query or a fragment can carry a token, and neither says where the request went.
 */
export function urlForLog(url: string): string {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return "an unparsable URL";
  }
  return target.protocol === "http:" || target.protocol === "https:"
    ? `${target.origin}${target.pathname}`
    : `a ${target.protocol} URL`;
}

/** Max automatic server restarts before giving up with an error dialog. */
export const MAX_SERVER_RESTARTS = 3;

/** Restart backoff: 1s, 2s, 4s (attempt is 0-based). */
export function restartDelayMs(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 8000);
}

/**
 * Whether closing the main window hides it into the tray instead of destroying it.
 *
 * All three conditions are load-bearing. A quit already under way never hides — the close
 * that Electron runs on the way out has to complete. `trayShown` matters because without
 * an icon there is no way back to a hidden window: the close must proceed instead, which
 * leaves the app in the Dock on macOS and quits it on Windows and Linux through
 * window-all-closed. A running app with no window and no tray icon is a state the user
 * cannot escape, so it is one this must never produce.
 */
export function hidesOnClose(state: {
  quitting: boolean;
  trayShown: boolean;
  closeToTray: boolean;
}): boolean {
  return !state.quitting && state.trayShown && state.closeToTray;
}
