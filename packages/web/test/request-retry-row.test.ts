/**
 * The model request's retry row (features/chat/request-retry-row.ts): what one ladder's line
 * says and offers, in each language. The words are the row's whole text, so they are pinned as
 * the reader sees them. The attempt counts every request of the turn, the first one included, of
 * the engine's ceiling.
 *
 * - Given a live countdown, the sentence counts down to the next attempt and, once due, says it
 *   is going out; Retry now and Stop retrying are offered, each the caller's own press.
 * - Given no countdown (a wait under the floor, or none), it says the attempt is going out and
 *   offers nothing.
 * - Given the retry went out, it records the attempt sent and offers nothing.
 * - The cause in words and the provider's own message sit on the row, after the sentence;
 *   without a message, the cause alone.
 * - Given the ladder gave up, it is the run's last line: the bracketed label, how many attempts
 *   failed and why, then the provider's own words — the same shape as the stop marker.
 */
import { describe, expect, it, vi } from "vitest";
import { requestFailedNotice, requestRetryRow } from "../src/features/chat/request-retry-row";
import type { RequestRetryPresses } from "../src/features/chat/request-retry-row";
import type { ReconnectItem } from "../src/lib/amsp/stream-model";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

const NEXT_AT = Date.parse("2026-10-26T09:00:23.000Z");

const ladder = (over: Partial<ReconnectItem> = {}): ReconnectItem => ({
  kind: "reconnect",
  id: 1,
  status: "retryable",
  attempt: 2,
  retrying: false,
  errorCode: "timeout",
  errorMessage: "upstream request timeout after 60s",
  ...over,
});

/** The row in a language: its sentence (for 23 s left while counting), the "?", the presses. */
function rowIn(
  lang: "zh" | "en",
  item: ReconnectItem,
  countdownTo: number | null = null,
  presses: RequestRetryPresses = {},
) {
  setActiveStrings(lang === "en" ? en : zh);
  try {
    const row = requestRetryRow(item, countdownTo, presses);
    return {
      phase: row.phase,
      sentence: row.countdown === undefined ? row.label : row.countdown(23),
      due: row.label,
      reason: row.reason,
      placement: row.reasonPlacement,
      retry: row.retry?.label ?? null,
      secondary: row.secondary?.label ?? null,
      row,
    };
  } finally {
    setActiveStrings(zh);
  }
}

describe("the model request's retry row", () => {
  it("counts down to the next attempt of the ceiling, says it is going out once due, and offers the caller's two presses", () => {
    const onRetryNow = vi.fn();
    const onStop = vi.fn();
    const zhRow = rowIn("zh", ladder(), NEXT_AT, { onRetryNow, onStop });
    expect(zhRow).toMatchObject({
      phase: "waiting",
      sentence: "23 秒后发起第 3/10 次请求",
      due: "正在发起第 3/10 次请求",
      retry: "立即重试",
      secondary: "放弃重试",
    });
    expect(zhRow.row.nextAt).toBe(NEXT_AT);
    void zhRow.row.retry!.onClick();
    void zhRow.row.secondary!.onClick();
    expect(onRetryNow).toHaveBeenCalledOnce();
    expect(onStop).toHaveBeenCalledOnce();
    expect(rowIn("en", ladder(), NEXT_AT, { onRetryNow, onStop })).toMatchObject({
      sentence: "Retrying in 23 s (attempt 3/10)",
      due: "Retrying (attempt 3/10)",
      retry: "Retry now",
      secondary: "Stop retrying",
    });
  });

  it("without a countdown says the attempt is going out, and offers nothing", () => {
    const presses = { onRetryNow: vi.fn(), onStop: vi.fn() };
    expect(rowIn("zh", ladder(), null, presses)).toMatchObject({
      phase: "trying",
      sentence: "正在发起第 3/10 次请求",
      retry: null,
      secondary: null,
    });
  });

  it("records the attempt sent once the retry went out, and offers nothing", () => {
    expect(rowIn("zh", ladder({ retrying: true }))).toMatchObject({
      phase: "retried",
      sentence: "已发起第 3/10 次请求",
      retry: null,
      secondary: null,
    });
    expect(rowIn("en", ladder({ retrying: true })).sentence).toBe("Retried (attempt 3/10)");
  });

  it("puts the cause in words and the provider's message on the row, or the cause alone", () => {
    expect(rowIn("zh", ladder())).toMatchObject({
      reason: "连接超时或网络中断：upstream request timeout after 60s",
      placement: "inline",
    });
    const silent: ReconnectItem = {
      kind: "reconnect",
      id: 1,
      status: "retryable",
      attempt: 2,
      retrying: false,
      errorCode: "network",
    };
    expect(rowIn("en", silent)).toMatchObject({
      reason: "Network or service temporarily unavailable",
      placement: "inline",
    });
  });
});

describe("the line a ladder that gave up ends the run with", () => {
  const noticeIn = (lang: "zh" | "en", item: ReconnectItem) => {
    setActiveStrings(lang === "en" ? en : zh);
    try {
      return requestFailedNotice(item);
    } finally {
      setActiveStrings(zh);
    }
  };

  it("says how many attempts failed and why, then the provider's words, beside the stop marker's shape", () => {
    const gaveUp = ladder({ attempt: 6, gaveUp: true });
    expect(noticeIn("zh", gaveUp)).toBe(
      "[请求失败]：6 次请求均失败（连接超时或网络中断）：upstream request timeout after 60s",
    );
    expect(noticeIn("en", gaveUp)).toBe(
      "[Failed]: all 6 requests failed (connection timed out): upstream request timeout after 60s",
    );
    const once: ReconnectItem = {
      kind: "reconnect",
      id: 1,
      status: "retryable",
      attempt: 1,
      retrying: false,
      gaveUp: true,
      errorCode: "timeout",
    };
    expect(noticeIn("en", once)).toBe("[Failed]: connection timed out");
  });
});
