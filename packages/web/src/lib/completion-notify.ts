/**
 * Task-completion detection over the tracked Session list (pure logic, node-testable —
 * the desktop notification hook in state/use-completion-notifications.ts drives it).
 *
 * A Session is "active" while running or compacting; a completion is the transition of
 * a KNOWN active Session to idle. First observations never fire — a freshly loaded list
 * only states where sessions already are, it doesn't witness a finish. Because the
 * transition flips the stored state, each run fires at most once (the per-session+run
 * dedupe); on top of that, a short per-session cooldown swallows the flap where a stale
 * list snapshot racing the live SSE flip briefly resurrects "running" and would
 * otherwise double-notify the same finish.
 */
import type { SessionStatus } from "@prismshadow/penguin-server/api";

export interface ObservedSession {
  sessionId: string;
  status: SessionStatus;
}

/** Whether a status counts as an in-flight run. */
function isActive(status: SessionStatus): boolean {
  return status === "running" || status === "compacting";
}

/** Minimum spacing between two completion firings of the same Session (see header). */
export const COMPLETION_COOLDOWN_MS = 10_000;

export interface CompletionTracker {
  /**
   * Feed the current Session list; returns the sessionIds whose run just completed.
   * `now` is injectable for tests (defaults to Date.now()).
   */
  observe(list: readonly ObservedSession[], now?: number): string[];
}

export function createCompletionTracker(
  cooldownMs: number = COMPLETION_COOLDOWN_MS,
): CompletionTracker {
  interface Entry {
    active: boolean;
    lastFiredAt: number | null;
  }
  const entries = new Map<string, Entry>();
  return {
    observe(list, now = Date.now()) {
      const completed: string[] = [];
      const seen = new Set<string>();
      for (const s of list) {
        // Defensive: the list is deduplicated upstream, but only the first occurrence
        // of an id may drive the state machine.
        if (seen.has(s.sessionId)) continue;
        seen.add(s.sessionId);
        const active = isActive(s.status);
        const prev = entries.get(s.sessionId);
        if (prev === undefined) {
          entries.set(s.sessionId, { active, lastFiredAt: null });
          continue;
        }
        if (prev.active && !active) {
          if (prev.lastFiredAt === null || now - prev.lastFiredAt >= cooldownMs) {
            completed.push(s.sessionId);
            prev.lastFiredAt = now;
          }
        }
        prev.active = active;
      }
      // Prune vanished sessions (deleted / Project switch): reappearing later counts as
      // a fresh first observation, which never fires.
      for (const id of [...entries.keys()]) {
        if (!seen.has(id)) entries.delete(id);
      }
      return completed;
    },
  };
}
