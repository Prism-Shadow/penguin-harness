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
 * - Given the ladder gave up, it says how many attempts it took, and offers Retry only when the
 *   caller grants one.
 * - The provider's own message waits behind the "?" under the cause in words; without one, the
 *   cause alone.
 * - Given no presses from the caller (a subagent's run), none are offered.
 */
import { describe, expect, it, vi } from "vitest";
import { requestRetryRow } from "../src/features/chat/request-retry-row";
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
      reasonTitle: row.reasonTitle,
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

  it("after the ladder gave up says how many attempts it took, with Retry only when the caller grants one", () => {
    const onRetry = vi.fn(async () => {});
    expect(rowIn("zh", ladder({ attempt: 6, gaveUp: true }), null, { onRetry })).toMatchObject({
      phase: "gaveUp",
      sentence: "6 次请求均失败",
      retry: "重试",
      secondary: null,
    });
    expect(rowIn("en", ladder({ attempt: 6, gaveUp: true })).sentence).toBe(
      "Request failed after 6 attempts",
    );
    expect(rowIn("en", ladder({ attempt: 6, gaveUp: true })).retry).toBeNull();
  });

  it("keeps the provider's message behind the ? under the cause in words, or the cause alone", () => {
    expect(rowIn("zh", ladder())).toMatchObject({
      reason: "upstream request timeout after 60s",
      reasonTitle: "连接超时或网络中断",
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
      reasonTitle: null,
    });
  });
});
