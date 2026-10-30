/**
 * What the model request's retry row says and offers, for one ladder's item: the props of the UI
 * package's shared retry row (`RetryStatus`), the same row a machine's reconnect wears. Its
 * attempt is the turn's, of the engine's ceiling — `request_end.attempt` counts every attempt,
 * the first request included — so the row is about the next attempt while it waits and the one
 * sent after.
 *
 * Why it retried sits on the row after the sentence, in sight: the cause in words, then the
 * provider's own message when it gave one. The presses are the caller's to grant (main session
 * only, and only while a live countdown runs); this only places them.
 *
 * A ladder that gave up ended the run, and is not this row: it is said as the line a run ended
 * on is (`requestFailedNotice`), beside the stop marker and the error banner.
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
  const why = {
    reason: t.why(t.cause(item.status, item.errorCode), item.errorMessage),
    reasonPlacement: "inline" as const,
  };
  const press = (label: string, onClick: (() => unknown) | undefined): RetryAction | null =>
    onClick === undefined ? null : { label, onClick };
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

/**
 * A ladder that gave up, as the line a run ended on says it: the bracketed label, how many
 * attempts failed and why in words, then the provider's own message when it gave one.
 */
export function requestFailedNotice(item: ReconnectItem): string {
  const t = S.chat.requestRetry;
  return t.failed(item.attempt, t.cause(item.status, item.errorCode), item.errorMessage);
}
