/**
 * Announcements from the open Session's transcript: a question card that arrived, and a retry
 * ladder that started waiting. Renderer-side only (lib/system-notify.ts holds the gates and the
 * `new Notification`; the two trackers decide what counts as news — ask-notify.ts and
 * retry-notify.ts).
 *
 * **Why here and not in the app layout.** The messages are the chat page's: the transcript lives
 * in its stream model, and nothing else holds either the rendered cards or the reconnect rows.
 * The gate that decides whether an announcement is welcome is the window's focus at the moment
 * the news arrives, and a window that is not focused keeps whatever route it had — so the page
 * holding the transcript is exactly the page that is open when this has something to say.
 *
 * **The cost of that placement, stated plainly**: a Session that is not open on screen cannot be
 * announced from here, so a question asked in some other Session — a scheduled task's, one
 * running in a background tab — arrives unannounced, and is simply there when the user next opens
 * it. Task *completions* do not have that limit (state/use-completion-notifications.ts reads the
 * tracked Session list, so it covers every Session), and closing the gap would mean the server
 * telling the client a Session has an unanswered card. That is a protocol change, and this is
 * deliberately a client-side feature; the boundary is v1's, not an oversight.
 *
 * **Every snapshot is fed to both trackers before any gate runs**, so whatever the user watched
 * arrive is consumed silently rather than announced on a later blur — see the two trackers'
 * headers. The `enabled` read below is not a gate (lib/system-notify.ts owns that); it is in the
 * effect's dependencies so that flipping the Settings switch takes effect without a reload.
 */
import { useEffect, useRef, useSyncExternalStore } from "react";
import { useNavigate } from "react-router";
import type { ChatItem } from "../../lib/omni/stream-model";
import {
  notificationsEnabledVersion,
  readNotificationsEnabled,
  subscribeNotificationsEnabled,
} from "../../lib/notification-pref";
import { showSystemNotification } from "../../lib/system-notify";
import { S } from "../../lib/strings";
import { collectAskMessages, createAskTracker } from "./ask-notify";
import type { AskTracker } from "./ask-notify";
import { collectWaitingReconnects, createRetryTracker } from "./retry-notify";
import type { RetryTracker } from "./retry-notify";

/** How long the click keeps looking for the card after navigating to its Session. */
const REVEAL_TIMEOUT_MS = 4_000;
/** Spacing between those looks: the transcript has to load and render first. */
const REVEAL_RETRY_MS = 120;

/**
 * Scrolls the newest unanswered card into view and flashes it. The card's own background
 * covers a wash, so the flash is drawn as a ring (see `.ask-card-flash` in styles.css), and
 * it is applied through classList — outside React's managed props, so a re-render during
 * streaming cannot strip it mid-animation.
 */
function revealPendingAskCard(): void {
  const deadline = Date.now() + REVEAL_TIMEOUT_MS;
  const attempt = (): void => {
    const cards = document.querySelectorAll<HTMLElement>('[data-ask-card="pending"]');
    const card = cards[cards.length - 1];
    if (card === undefined) {
      if (Date.now() < deadline) window.setTimeout(attempt, REVEAL_RETRY_MS);
      return;
    }
    card.scrollIntoView({ block: "center" });
    card.classList.remove("ask-card-flash");
    void card.offsetWidth; // restart the animation when the same card is revealed twice
    card.classList.add("ask-card-flash");
  };
  attempt();
}

export function useTranscriptNotifications({
  sessionId,
  title,
  items,
  version,
  loading,
}: {
  /** The Session whose transcript is open; null while drafting. */
  sessionId: string | null;
  /** Its title, for the notification body (null while unnamed). */
  title: string | null;
  /** The LIVE tail of its view model (`stream.model.items`) — backfilled history is not an arrival. */
  items: readonly ChatItem[];
  /** View-model version: the repaint signal the item list is read under. */
  version: number;
  /** True until history finishes loading (nothing observed while it is). */
  loading: boolean;
}): void {
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const askRef = useRef<AskTracker>(createAskTracker());
  const retryRef = useRef<RetryTracker>(createRetryTracker());

  // The settings switch writes the preference; this follows it without a reload (see the header
  // on why it is not read as a gate here).
  useSyncExternalStore(subscribeNotificationsEnabled, notificationsEnabledVersion);
  const enabled = readNotificationsEnabled();

  useEffect(() => {
    const ask = askRef.current;
    const retry = retryRef.current;
    // Nothing observed while the transcript loads: history arrives in batches, and a question
    // asked a week ago — or a retry from an old run — must not read as news. The reset makes the
    // first complete snapshot the baseline (first observation never fires).
    if (sessionId === null || loading) {
      ask.reset();
      retry.reset();
      return;
    }
    const arrival = ask.observe(sessionId, collectAskMessages(items));
    const waiting = retry.observe(sessionId, collectWaitingReconnects(items));
    if (arrival !== null) {
      showSystemNotification({
        tag: `penguin-ask-${arrival.sessionId}`,
        title: S.notify.askTitle,
        body: S.notify.askBody(title ?? S.chat.defaultSessionTitle, arrival.count),
        onClick: () => {
          navigateRef.current(`/chat/${arrival.sessionId}`);
          revealPendingAskCard();
        },
      });
    }
    if (waiting !== null) {
      // The click has nowhere special to go: the reconnect line is the last thing the live tail
      // renders, so opening the Session lands on it (and on the live countdown, if it is still
      // waiting by then).
      showSystemNotification({
        tag: `penguin-retry-${waiting.sessionId}`,
        title: S.notify.retryTitle,
        body: S.notify.retryBody(
          title ?? S.chat.defaultSessionTitle,
          waiting.attempt,
          waiting.plannedDelayMs === undefined
            ? undefined
            : Math.ceil(waiting.plannedDelayMs / 1000),
        ),
        onClick: () => navigateRef.current(`/chat/${waiting.sessionId}`),
      });
    }
    // `version` is the repaint signal for the in-place-updated item list; the items themselves
    // are read under it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, sessionId, loading, version]);
}
