/**
 * What a model request that failed says in the conversation (features/chat/request-notice.ts):
 * one notice line per retry ladder, and the fatal error's line, in each language. The words are
 * the line's whole text, so they are pinned as the reader sees them. The attempt counts every
 * request of the turn, the first one included, of the engine's ceiling.
 *
 * - Given a live countdown, the line counts down to the next attempt and, once due, says it is
 *   going out; Retry now and Stop retrying are offered, each the caller's own press.
 * - Given no countdown, it says the attempt is going out and offers nothing.
 * - Given the retry went out, it records the attempt sent and offers nothing.
 * - Given the ladder ended the run, it says how many attempts failed — or, after one, only why.
 * - Why is the cause in words and the HTTP status the provider's message names, never the
 *   provider's message itself; a cause with no words still reads as one.
 * - Given a fatal error, its line says why in short when the code or the message says, and
 *   nothing more when neither does.
 */
import { describe, expect, it, vi } from "vitest";
import { llmErrorNotice, requestNotice } from "../src/features/chat/request-notice";
import type { RequestRetryPresses } from "../src/features/chat/request-notice";
import type { LlmErrorItem, ReconnectItem } from "../src/lib/amsp/stream-model";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

const NEXT_AT = Date.parse("2026-10-26T09:00:23.000Z");
const MESSAGE = '503 {"type":"error","error":{"type":"overloaded_error"}}';

const ladder = (over: Partial<ReconnectItem> = {}): ReconnectItem => ({
  kind: "reconnect",
  id: 1,
  status: "retryable",
  attempt: 2,
  retrying: false,
  errorCode: "network",
  errorMessage: MESSAGE,
  ...over,
});

function inLang<T>(lang: "zh" | "en", read: () => T): T {
  setActiveStrings(lang === "en" ? en : zh);
  try {
    return read();
  } finally {
    setActiveStrings(zh);
  }
}

/** The line in a language: its words (for 23 s left while counting), the presses it offers. */
const lineIn = (
  lang: "zh" | "en",
  item: ReconnectItem,
  countdownTo: number | null = null,
  presses: RequestRetryPresses = {},
) =>
  inLang(lang, () => {
    const notice = requestNotice(item, countdownTo, presses);
    return {
      phase: notice.phase,
      line: notice.countdown === null ? notice.text : notice.countdown(23),
      due: notice.text,
      presses: [notice.retryNow?.label, notice.stop?.label].filter((label) => label !== undefined),
      notice,
    };
  });

describe("a retry ladder's line", () => {
  it("counts down to the next attempt of the ceiling, says it is going out once due, and offers the caller's two presses", () => {
    const onRetryNow = vi.fn();
    const onStop = vi.fn();
    const zhLine = lineIn("zh", ladder(), NEXT_AT, { onRetryNow, onStop });
    expect(zhLine).toMatchObject({
      phase: "waiting",
      line: "[重试中]：23 秒后发起第 3/10 次请求（网络或服务暂时不可用，HTTP 503）",
      due: "[重试中]：正在发起第 3/10 次请求（网络或服务暂时不可用，HTTP 503）",
      presses: ["立即重试", "放弃重试"],
    });
    expect(zhLine.notice.nextAt).toBe(NEXT_AT);
    void zhLine.notice.retryNow!.onClick();
    void zhLine.notice.stop!.onClick();
    expect(onRetryNow).toHaveBeenCalledOnce();
    expect(onStop).toHaveBeenCalledOnce();
    expect(lineIn("en", ladder(), NEXT_AT, { onRetryNow, onStop })).toMatchObject({
      line: "[Retrying]: attempt 3/10 in 23 s (network or service temporarily unavailable, HTTP 503)",
      due: "[Retrying]: sending attempt 3/10 (network or service temporarily unavailable, HTTP 503)",
      presses: ["Retry now", "Stop retrying"],
    });
  });

  it("without a countdown says the attempt is going out, and offers nothing", () => {
    expect(lineIn("zh", ladder(), null, { onRetryNow: vi.fn(), onStop: vi.fn() })).toMatchObject({
      phase: "trying",
      line: "[重试中]：正在发起第 3/10 次请求（网络或服务暂时不可用，HTTP 503）",
      presses: [],
    });
  });

  it("records the attempt sent once the retry went out, and offers nothing", () => {
    expect(lineIn("zh", ladder({ retrying: true }))).toMatchObject({
      phase: "retried",
      line: "[已重试]：已发起第 3/10 次请求（网络或服务暂时不可用，HTTP 503）",
      presses: [],
    });
    expect(lineIn("en", ladder({ retrying: true })).line).toBe(
      "[Retried]: attempt 3/10 sent (network or service temporarily unavailable, HTTP 503)",
    );
  });

  it("once the ladder ended the run, says how many attempts failed, or after one only why", () => {
    const gaveUp = ladder({
      attempt: 6,
      gaveUp: true,
      errorCode: "timeout",
      errorMessage: undefined,
    });
    expect(lineIn("zh", gaveUp)).toMatchObject({
      phase: "gaveUp",
      line: "[请求失败]：6 次请求均失败（连接超时或网络中断）",
      presses: [],
    });
    expect(lineIn("en", gaveUp).line).toBe(
      "[Failed]: all 6 requests failed (connection timed out)",
    );
    expect(lineIn("en", ladder({ attempt: 2, gaveUp: true })).line).toBe(
      "[Failed]: both requests failed (network or service temporarily unavailable, HTTP 503)",
    );
    expect(lineIn("en", ladder({ attempt: 1, gaveUp: true })).line).toBe(
      "[Failed]: network or service temporarily unavailable, HTTP 503",
    );
  });

  it("never carries the provider's message, and a cause with no words still reads as one", () => {
    const line = lineIn("en", ladder({ errorMessage: "upstream exploded: sk-abc123secret" })).line;
    expect(line).not.toContain("upstream exploded");
    const unknown = { errorCode: "something_new", errorMessage: undefined };
    expect(lineIn("en", ladder(unknown)).line).toBe(
      "[Retrying]: sending attempt 3/10 (cause unknown)",
    );
  });
});

describe("a fatal error's line", () => {
  const fatal = (over: Partial<LlmErrorItem> = {}): LlmErrorItem => ({
    kind: "llm_error",
    id: 1,
    errorCode: "auth",
    errorMessage: "401 invalid x-api-key",
    ...over,
  });

  it("says why in short, never the provider's words, and nothing more when nothing says why", () => {
    expect(inLang("zh", () => llmErrorNotice(fatal()))).toBe(
      "[错误]：模型请求错误（凭据被拒绝，HTTP 401）",
    );
    expect(inLang("en", () => llmErrorNotice(fatal()))).toBe(
      "[Error]: the model request failed (credentials rejected, HTTP 401)",
    );
    expect(inLang("en", () => llmErrorNotice(fatal({ errorCode: undefined })))).toBe(
      "[Error]: the model request failed (HTTP 401)",
    );
    expect(
      inLang("en", () => llmErrorNotice(fatal({ errorCode: undefined, errorMessage: "boom" }))),
    ).toBe("[Error]: the model request failed");
  });
});
