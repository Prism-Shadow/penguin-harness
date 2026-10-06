/**
 * "The request was dropped and the engine is waiting to try again" — pure logic over the items
 * the open Session has rendered (node-testable; use-transcript-notifications.ts drives it).
 *
 * A retry ladder is minutes in which the conversation produces nothing, and the row that says so
 * (message-item.tsx's reconnect line) is a countdown *in the transcript* — no help at all to
 * someone who walked away from the window while the model was answering. This decides when a
 * ladder starts waiting; the hook turns it into one system notification, and the click lands on
 * the line that carries the cause, the live countdown and the two controls (retry now, give up).
 * That is why the notice itself stays bare: attempt number and the wait the engine announced.
 *
 * **One announcement per ladder, not per attempt.** A ladder reuses its item id as it climbs
 * (stream-model.ts's continuedLadder keeps it so the row updates instead of remounting), so the
 * first waiting sighting claims the id and the attempts after it — seconds apart off the backoff
 * — are silent. A ladder that exhausts itself is not silenced by this either: the run ends
 * there, which is a completion, and the task-completion notification already covers it.
 *
 * **First observation never fires**, and **known means consumed** — the same two rules as
 * ask-notify.ts, and for the same reasons: a page load or a Session switch only states where the
 * conversation already was, and a retry the user watched begin must not be announced the moment
 * they switch to another app. The cooldown is shared with that module's reasoning too: a resync
 * that rebuilds the view model renumbers items, and a renumbered ladder would otherwise read as
 * a second incident.
 */
import type { ChatItem } from "../../lib/omni/stream-model";

/** A reconnect item that has announced a wait and has not sent its next attempt yet. */
export interface ObservedReconnect {
  /** Stream item id — one ladder is one incident (see the header). */
  itemId: number;
  /** Which retry attempt comes next (the core's 1-based `request_end.attempt`). */
  attempt: number;
  /** The wait the engine announced before that attempt, when the event carried one. */
  plannedDelayMs?: number;
}

/** What to announce: the Session, and where its ladder stands. */
export interface RetryNotification {
  sessionId: string;
  attempt: number;
  plannedDelayMs?: number;
}

/** Minimum spacing between two announcements of the same Session (see the header). */
export const RETRY_NOTIFY_COOLDOWN_MS = 10_000;

export interface RetryTracker {
  /**
   * Feed the ladders the open Session currently shows; returns the one to announce, or null when
   * there is nothing new (first observation, none waiting, cooldown). `sessionId` null = no
   * Session is open. `now` is injectable for tests.
   */
  observe(
    sessionId: string | null,
    waiting: readonly ObservedReconnect[],
    now?: number,
  ): RetryNotification | null;
  /** Forget everything (called while the transcript is loading, so the load's own history is baselined again). */
  reset(): void;
}

export function createRetryTracker(cooldownMs: number = RETRY_NOTIFY_COOLDOWN_MS): RetryTracker {
  let session: string | null = null;
  const known = new Set<number>();
  let lastFiredAt: number | null = null;

  const forget = (): void => {
    session = null;
    known.clear();
    lastFiredAt = null;
  };

  return {
    reset: forget,
    observe(sessionId, waiting, now = Date.now()) {
      if (sessionId === null) {
        forget();
        return null;
      }
      if (sessionId !== session) {
        // A different Session: its transcript is not what this tracker was watching, and its
        // ladders are where the user left them — baseline, never announce.
        session = sessionId;
        known.clear();
        lastFiredAt = null;
        for (const w of waiting) known.add(w.itemId);
        return null;
      }
      const fresh = waiting.filter((w) => !known.has(w.itemId));
      for (const w of waiting) known.add(w.itemId);
      if (fresh.length === 0) return null;
      if (lastFiredAt !== null && now - lastFiredAt < cooldownMs) return null;
      lastFiredAt = now;
      // One transcript runs one ladder at a time (the engine retries the request it is on), so
      // the first unseen one is the incident being announced.
      const ladder = fresh[0]!;
      return {
        sessionId,
        attempt: ladder.attempt,
        plannedDelayMs: ladder.plannedDelayMs,
      };
    },
  };
}

/**
 * The ladders among the rendered items that are waiting for their next attempt. An item that is
 * `retrying` (the attempt has been sent) or `gaveUp` (the ladder exhausted itself) is not waiting
 * for anything, so it is not collected — and because it is then also not marked known, a ladder
 * first sighted mid-flight is still announced at its next wait rather than passed over in
 * silence.
 *
 * Items come from the LIVE tail of the view model. Replayed history is not an incident: a Trace's
 * reconnect rows arrive with the following request_begin/abort, so they are never waiting by the
 * time anything renders them (stream-model.ts says the same from its side).
 */
export function collectWaitingReconnects(items: readonly ChatItem[]): ObservedReconnect[] {
  const waiting: ObservedReconnect[] = [];
  for (const item of items) {
    if (item.kind !== "reconnect") continue;
    if (item.retrying || item.gaveUp === true) continue;
    waiting.push({
      itemId: item.id,
      attempt: item.attempt,
      plannedDelayMs: item.plannedDelayMs,
    });
  }
  return waiting;
}
