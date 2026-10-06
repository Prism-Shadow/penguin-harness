/**
 * "A question card arrived while nobody was looking" — pure logic over the messages the open
 * Session has rendered (node-testable; use-ask-notifications.ts drives it).
 *
 * The card is answerable only where it sits (ask-card.tsx), and the answer is the *next* user
 * message — so a card that appears while the window is in the background is a turn the
 * conversation is silently waiting on. This decides when that happened; the hook turns it into
 * one system notification that brings the window back to the card.
 *
 * **First observation never fires.** A tracker that just started — a page load, a Session
 * switch — only states where the conversation already was. Every card it sees at that moment
 * joined the set of known ones silently, so reopening a week-old conversation does not notify
 * about a question that was asked when it was written.
 *
 * **Known means consumed, whether or not a notification was shown.** The hook feeds every
 * snapshot through this tracker before it applies its own gates (preference, focus,
 * permission), and anything it has seen is marked known either way: a card the user watched
 * arrive must not be announced the moment they later switch to another app.
 *
 * **One notification per arrival, not per card.** A round asks several questions at once
 * (ask-card.tsx's "submit all"), and a system notification is a doorbell, not a queue: the
 * messages that just arrived are reported as one event with their total. The cooldown on top
 * of that absorbs the one way a settled message can be re-numbered — a resync that rebuilds
 * the view model reassigns item ids, which would otherwise read as a second arrival.
 */
import type { ChatItem } from "../../lib/omni/stream-model";
import { countAskCards } from "./ask-block";

/** A rendered message carrying question cards. */
export interface ObservedAskMessage {
  /** Stream item id — the message's identity within one view model. */
  itemId: number;
  /** How many cards it carries. */
  cardCount: number;
}

/**
 * What to announce: which Session, and how many cards just arrived. Deliberately no item id:
 * item ids are per view-model, and clicking the notification may reload the Session — the
 * hook targets the newest unanswered card instead, which is this arrival in every case a
 * notification can describe.
 */
export interface AskNotification {
  sessionId: string;
  /** Cards across the messages that just arrived. */
  count: number;
}

/** Minimum spacing between two announcements of the same Session (see the header). */
export const ASK_NOTIFY_COOLDOWN_MS = 10_000;

export interface AskTracker {
  /**
   * Feed the messages the open Session currently renders; returns the arrival to announce, or
   * null when there is nothing new (first observation, no cards, cooldown) to say.
   * `sessionId` null = no Session is open. `now` is injectable for tests.
   */
  observe(
    sessionId: string | null,
    messages: readonly ObservedAskMessage[],
    now?: number,
  ): AskNotification | null;
  /** Forget everything (called while the transcript is loading, so the load's own history is baselined again). */
  reset(): void;
}

export function createAskTracker(cooldownMs: number = ASK_NOTIFY_COOLDOWN_MS): AskTracker {
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
    observe(sessionId, messages, now = Date.now()) {
      if (sessionId === null) {
        forget();
        return null;
      }
      if (sessionId !== session) {
        // A different Session: its transcript is not what this tracker was watching, and its
        // cards are where the user left them — baseline, never announce.
        session = sessionId;
        known.clear();
        lastFiredAt = null;
        for (const m of messages) known.add(m.itemId);
        return null;
      }
      const fresh = messages.filter((m) => !known.has(m.itemId));
      for (const m of messages) known.add(m.itemId);
      if (fresh.length === 0) return null;
      if (lastFiredAt !== null && now - lastFiredAt < cooldownMs) return null;
      lastFiredAt = now;
      return { sessionId, count: fresh.reduce((total, m) => total + m.cardCount, 0) };
    },
  };
}

/**
 * The card-carrying messages among the rendered items. Only settled replies count — while a
 * reply is still streaming its block is half-written, and the parent renders it as plain
 * Markdown anyway, so there is nothing to answer yet. Items come from the LIVE tail of the
 * view model: a window backfilled by scrolling up is history, not an arrival.
 */
export function collectAskMessages(items: readonly ChatItem[]): ObservedAskMessage[] {
  const messages: ObservedAskMessage[] = [];
  for (const item of items) {
    if (item.kind !== "assistant_text" || item.streaming) continue;
    const cardCount = countAskCards(item.text);
    if (cardCount > 0) messages.push({ itemId: item.id, cardCount });
  }
  return messages;
}
