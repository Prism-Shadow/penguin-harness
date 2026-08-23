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
  return `${origin}/api/auth/desktop-login?token=${encodeURIComponent(token)}`;
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
  const loopback = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
  return loopback.has(target.hostname) && loopback.has(app.hostname);
}

/** Max automatic server restarts before giving up with an error dialog. */
export const MAX_SERVER_RESTARTS = 3;

/** Max automatic reloads after a renderer crash before the page is left for a manual one. */
export const MAX_RENDERER_RELOADS = 3;

/**
 * Whether a `render-process-gone` reason is a crash the shell should reload past.
 * `clean-exit` is the render process going away on purpose — the window closing, the app
 * quitting — where a reload would race the teardown instead of recovering anything.
 */
export function isRendererCrash(reason: string): boolean {
  return reason !== "clean-exit";
}

/** Restart backoff: 1s, 2s, 4s (attempt is 0-based). */
export function restartDelayMs(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 8000);
}
