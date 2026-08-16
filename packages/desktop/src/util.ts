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
 * Whether a top-level navigation stays inside the app window: any `http://localhost:<port>`
 * origin — this machine's server, or another machine's server through a local tunnel.
 *
 * This is the ONE mechanism the shell contributes to machine switching (the capability
 * itself — host list, install, tunnel — is platform code reached over /api/machines): the
 * window may move between loopback penguin origins, and everything else still goes to the
 * system browser. `localhost` only, not 127.0.0.1: that host is the preview surface, which
 * belongs in preview windows (isLocalSurfaceUrl), never in the main window.
 */
export function isLoopbackAppUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" && parsed.hostname === "localhost";
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

/** Restart backoff: 1s, 2s, 4s (attempt is 0-based). */
export function restartDelayMs(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 8000);
}
