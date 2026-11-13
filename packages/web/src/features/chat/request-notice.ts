/**
 * What a model request that failed says in the conversation: one notice line, in the shape of
 * the stop marker 「[已中断]：重试等待中被中断」 — a bracketed label, where it stands, and why in
 * short — whether the request is being retried, was retried, or ended the run.
 *
 * A retry ladder is one line from its first failure on. Its attempt is the turn's, of the
 * engine's ceiling (`request_end.attempt` counts every attempt, the first request included), so
 * the line is about the next attempt while it waits and the one sent after:
 *
 * - waiting, a live countdown running: 「[重试中]：23 秒后发起第 3/10 次请求（…）」, with Retry now
 *   and Stop retrying when the caller grants them (main session only);
 * - the attempt going out: 「[重试中]：正在发起第 3/10 次请求（…）」;
 * - the attempt sent: 「[已重试]：已发起第 3/10 次请求（…）」, which stays as the record of a ladder
 *   that recovered;
 * - the run ended on it (the attempts ran out, or a stop came during a wait):
 *   「[请求失败]：6 次请求均失败（…）」.
 *
 * Why is the cause in words and the HTTP status the provider's message names, never the
 * provider's message itself: that is the failure details' (`RequestFailure`, the line's
 * 「[详情]」), which a fatal error's line (「[错误]：模型请求错误（…）」) opens too.
 */
import { DEFAULT_MAX_TURN_ATTEMPTS } from "@prismshadow/penguin-core/interfaces";
import type { RetryAction } from "@prismshadow/penguin-ui";
import type { LlmErrorItem, ReconnectItem } from "../../lib/amsp/stream-model";
import { S } from "../../lib/strings";
import { httpStatusOf } from "./provider-error";
import type { RequestFailure } from "./request-failure-report";

export type RequestNoticePhase = "waiting" | "trying" | "retried" | "gaveUp";

export interface RequestRetryPresses {
  /** Skips the remaining backoff wait; offered only while the countdown runs. */
  onRetryNow?: (() => void) | undefined;
  /** Stops retrying (the session abort); offered only while the countdown runs. */
  onStop?: (() => void) | undefined;
}

export interface RequestNotice {
  phase: RequestNoticePhase;
  /** The line as it reads; while waiting, what it says once the moment has come. */
  text: string;
  /** `waiting`: the line for a number of seconds left; null otherwise. */
  countdown: ((seconds: number) => string) | null;
  /** `waiting`: when the next attempt runs (epoch ms); null otherwise. */
  nextAt: number | null;
  /** `waiting`: Retry now, when granted; null otherwise. */
  retryNow: RetryAction | null;
  /** `waiting`: Stop retrying, when granted; null otherwise. */
  stop: RetryAction | null;
}

const NO_WAIT = { countdown: null, nextAt: null, retryNow: null, stop: null } as const;

export function requestNotice(
  item: ReconnectItem,
  /** When the next attempt runs (epoch ms) while a live countdown runs to it; null otherwise. */
  countdownTo: number | null,
  presses: RequestRetryPresses = {},
): RequestNotice {
  const t = S.chat.requestRetry;
  const m = DEFAULT_MAX_TURN_ATTEMPTS;
  const next = item.attempt + 1;
  const why = t.why(
    t.cause(item.errorCode ?? item.status) ?? t.unknownCause,
    httpStatusOf(item.errorMessage),
  );
  if (item.gaveUp === true)
    return { phase: "gaveUp", text: t.failed(item.attempt, why), ...NO_WAIT };
  if (item.retrying) return { phase: "retried", text: t.retried(t.sent(next, m), why), ...NO_WAIT };
  const sending = t.retrying(t.sending(next, m), why);
  if (countdownTo === null) return { phase: "trying", text: sending, ...NO_WAIT };
  const press = (label: string, onClick: (() => void) | undefined): RetryAction | null =>
    onClick === undefined ? null : { label, onClick };
  return {
    phase: "waiting",
    text: sending,
    countdown: (seconds) => t.retrying(t.waiting(seconds, next, m), why),
    nextAt: countdownTo,
    retryNow: press(t.retryNow, presses.onRetryNow),
    stop: press(t.stop, presses.onStop),
  };
}

/** A fatal request's line: why in short when the code or the provider's message says. */
export function llmErrorNotice(item: LlmErrorItem): string {
  const t = S.chat.requestRetry;
  const cause = t.cause(item.errorCode);
  const status = httpStatusOf(item.errorMessage);
  return S.chat.llmError(
    cause !== null ? t.why(cause, status) : status !== null ? `HTTP ${status}` : null,
  );
}

/** A ladder's failure, as its details report it. */
export function ladderFailure(item: ReconnectItem, phase: RequestNoticePhase): RequestFailure {
  return {
    phase,
    attempt: item.attempt,
    maxAttempts: DEFAULT_MAX_TURN_ATTEMPTS,
    status: item.status,
    ...failureFields(item),
  };
}

/** A fatal request's failure, as its details report it. */
export function fatalFailure(item: LlmErrorItem): RequestFailure {
  return {
    phase: "fatal",
    attempt: item.attempt ?? 1,
    maxAttempts: DEFAULT_MAX_TURN_ATTEMPTS,
    status: "fatal",
    ...failureFields(item),
  };
}

function failureFields(item: ReconnectItem | LlmErrorItem) {
  return {
    ...(item.errorCode !== undefined ? { errorCode: item.errorCode } : {}),
    ...(item.errorMessage !== undefined ? { message: item.errorMessage } : {}),
    ...(item.model !== undefined ? { model: item.model } : {}),
    ...(item.atMs !== undefined ? { atMs: item.atMs } : {}),
  };
}
