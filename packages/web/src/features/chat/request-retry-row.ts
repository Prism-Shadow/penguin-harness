/**
 * What the model request's retry row says and offers, for one ladder's item: the props of the UI
 * package's shared retry row (`RetryStatus`), the same row a machine's reconnect wears. Its
 * attempt is the turn's, of the engine's ceiling — `request_end.attempt` counts every attempt,
 * the first request included — so the row is about the next attempt while it waits and the one
 * sent after, and a ladder that gave up says how many it took.
 *
 * Why it retried waits behind the row's "?": the cause in words as the title over the provider's
 * own message, or the cause alone when the provider said nothing. The presses are the caller's
 * to grant (main session only, and only while a live countdown runs); this only places them.
 */
import { DEFAULT_MAX_TURN_ATTEMPTS } from "@prismshadow/penguin-core/interfaces";
import type { RetryAction, RetryStatusProps } from "@prismshadow/penguin-ui";
import type { ReconnectItem } from "../../lib/amsp/stream-model";
import { S } from "../../lib/strings";

export interface RequestRetryPresses {
  /** Skips the remaining backoff wait; offered only while the countdown runs. */
  onRetryNow?: (() => void) | undefined;
  /** Stops retrying (the session abort); offered only while the countdown runs. */
  onStop?: (() => void) | undefined;
  /** Sends the unfinished turn again, after the ladder gave up; offered on the stream's last line. */
  onRetry?: (() => Promise<void>) | undefined;
}

export function requestRetryRow(
  item: ReconnectItem,
  /** When the next attempt runs (epoch ms) while a live countdown runs to it; null otherwise. */
  countdownTo: number | null,
  presses: RequestRetryPresses = {},
): RetryStatusProps {
  const t = S.chat.requestRetry;
  const m = DEFAULT_MAX_TURN_ATTEMPTS;
  const next = item.attempt + 1;
  const cause = t.cause(item.status, item.errorCode);
  const why =
    item.errorMessage === undefined
      ? { reason: cause, reasonTitle: null }
      : { reason: item.errorMessage, reasonTitle: cause };
  const press = (label: string, onClick: (() => unknown) | undefined): RetryAction | null =>
    onClick === undefined ? null : { label, onClick };
  if (item.gaveUp === true) {
    return {
      phase: "gaveUp",
      label: t.gaveUp(item.attempt),
      ...why,
      retry: press(S.chat.retryRun, presses.onRetry),
    };
  }
  if (item.retrying) return { phase: "retried", label: t.sent(next, m), ...why };
  if (countdownTo === null) return { phase: "trying", label: t.sending(next, m), ...why };
  return {
    phase: "waiting",
    label: t.sending(next, m),
    countdown: (seconds) => t.waiting(seconds, next, m),
    nextAt: countdownTo,
    ...why,
    retry: press(t.retryNow, presses.onRetryNow),
    secondary: press(t.stop, presses.onStop),
  };
}
