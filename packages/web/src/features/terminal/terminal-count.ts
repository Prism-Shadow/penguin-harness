/**
 * Live count of the user's running terminals, as a tiny module-level store — the number
 * the toolbar badge shows (panels-toolbar.tsx).
 *
 * The server is the source of truth (`GET /api/terminals`, alive only); this store decides
 * *when* to look. There is no push channel for terminal lifecycle yet, so:
 * - every dock lifecycle step that can change the count calls refreshTerminalCount()
 *   directly (create, reattach, exit, detach);
 * - while anyone is subscribed, a slow poll plus a window-focus refresh catch changes this
 *   tab cannot see (a shell exiting on its own, terminals opened from another window).
 */

const POLL_MS = 30_000;

let count = 0;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();
let pollTimer: ReturnType<typeof setInterval> | null = null;

interface TerminalListResponse {
  terminals: Array<{ alive: boolean }>;
}

export function activeTerminalCount(): number {
  return count;
}

/** Re-reads the count from the server; concurrent calls share one request. */
export function refreshTerminalCount(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch("/api/terminals", { credentials: "same-origin" });
      if (!res.ok) return; // signed out or server unreachable: keep the last known count
      const data = (await res.json()) as TerminalListResponse;
      const next = data.terminals.filter((t) => t.alive).length;
      if (next !== count) {
        count = next;
        for (const listener of [...listeners]) listener();
      }
    } catch {
      // Network hiccup: the next poll/focus refresh will catch up.
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

const onFocus = (): void => void refreshTerminalCount();

export function subscribeTerminalCount(listener: () => void): () => void {
  if (listeners.size === 0) {
    void refreshTerminalCount();
    pollTimer = setInterval(() => void refreshTerminalCount(), POLL_MS);
    window.addEventListener("focus", onFocus);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
      window.removeEventListener("focus", onFocus);
    }
  };
}
