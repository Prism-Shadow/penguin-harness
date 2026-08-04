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
 * onto localhost and `127.0.0.1` is reserved as the preview host, which rejects /api
 * (see design § "桌面端原型 · 进程模型").
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

/** Max automatic server restarts before giving up with an error dialog. */
export const MAX_SERVER_RESTARTS = 3;

/** Restart backoff: 1s, 2s, 4s (attempt is 0-based). */
export function restartDelayMs(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 8000);
}
