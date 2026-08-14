/**
 * The user's live terminals, as a tiny module-level store — the dock's tab strip renders
 * this list, and the toolbar badge (panels-toolbar.tsx) shows its length.
 *
 * The server is the source of truth (`GET /api/terminals`, alive only); this store decides
 * *when* to look. There is no push channel for terminal lifecycle yet, so:
 * - every dock lifecycle step that can change the list calls refreshTerminals() directly
 *   (create, reattach, kill, exit);
 * - while anyone is subscribed, a slow poll plus a window-focus refresh catch changes this
 *   tab cannot see (a shell exiting on its own, terminals opened from another window).
 */
import type { TerminalInfo } from "./terminal-view";

const POLL_MS = 30_000;

/** Stable snapshot (same reference until contents change) for useSyncExternalStore. */
let terminals: TerminalInfo[] = [];
let fingerprint = "";
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();
let pollTimer: ReturnType<typeof setInterval> | null = null;

/** Live terminals, ordered by creation time (the server's list order). */
export function liveTerminals(): TerminalInfo[] {
  return terminals;
}

export function liveTerminalCount(): number {
  return terminals.length;
}

/** Re-reads the list from the server; concurrent calls share one request. */
export function refreshTerminals(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch("/api/terminals", { credentials: "same-origin" });
      if (!res.ok) return; // signed out or server unreachable: keep the last known list
      const data = (await res.json()) as { terminals: TerminalInfo[] };
      const next = data.terminals.filter((t) => t.alive);
      const nextFingerprint = JSON.stringify(next);
      if (nextFingerprint !== fingerprint) {
        terminals = next;
        fingerprint = nextFingerprint;
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

const onFocus = (): void => void refreshTerminals();

export function subscribeTerminals(listener: () => void): () => void {
  if (listeners.size === 0) {
    void refreshTerminals();
    pollTimer = setInterval(() => void refreshTerminals(), POLL_MS);
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

/**
 * Kills a terminal and re-syncs. The DELETE only signals the shell — `alive` flips when
 * the pty actually exits a moment later — so a couple of short delayed refreshes follow
 * the immediate one to let the tab (and badge) settle without waiting for the slow poll.
 */
export async function killTerminal(id: string): Promise<void> {
  try {
    await fetch(`/api/terminals/${encodeURIComponent(id)}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
  } catch {
    // Refresh below still reconciles with whatever the server thinks.
  }
  await refreshTerminals();
  for (const delay of [300, 1200]) {
    setTimeout(() => void refreshTerminals(), delay);
  }
}
