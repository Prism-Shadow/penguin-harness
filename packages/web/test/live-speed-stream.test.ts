/**
 * The live speed reading as the streaming model wires it (lib/amsp/stream-model.ts →
 * lib/amsp/task-stats.ts): the chat header's tok/s chip is driven by records, so this is the
 * end-to-end of "what the chip reads" without a browser.
 *
 * - request_begin starts the clock; streamed assistant text, thinking and tool-call arguments
 *   add characters; a streamed tool OUTPUT adds none (it is input, not output);
 * - the reading is an estimate while the Request streams, marked as such by liveOutputSpeed;
 * - the Request's token_usage settles the exact figure and calibrates the next estimate;
 * - a Request that ends without usage (cut off) leaves no reading behind.
 */
import { describe, expect, it } from "vitest";
import {
  assistantText,
  partialText,
  partialThinking,
  partialToolCall,
  partialToolCallOutput,
  requestBegin,
  requestEnd,
  sessionMeta,
  tokenUsage,
  userText,
} from "@prismshadow/amsp";
import type { AmspRecord, SessionMetaPayload, TokenCounts } from "@prismshadow/amsp";
import { createStreamModel, pushMessage } from "../src/lib/amsp/stream-model";
import type { StreamModel } from "../src/lib/amsp/stream-model";
import { liveOutputSpeed } from "../src/lib/amsp/task-stats";

/** Override a message timestamp (constructor defaults to the current time). */
function at<M extends AmspRecord>(msg: M, ts: string): M {
  return { ...msg, timestamp: ts };
}

function counts(total: number): TokenCounts {
  return { cache_read: 0, cache_write: 0, output: 0, total };
}

/** Output-only counts: `request.output = total = n`, what the speed reading divides. */
function out(n: number): TokenCounts {
  return { cache_read: 0, cache_write: 0, output: n, total: n };
}

function meta(sessionId: string): AmspRecord<SessionMetaPayload> {
  return sessionMeta({
    session_id: sessionId,
    model_id: "m",
    provider: "custom",
    model_context_window: 200000,
    system_prompt: "",
    agent_state: "/a",
    workspace: "/w",
    source: "user",
  });
}

/** A model with one Task open and its first Request begun at `beginTs`. */
function begun(beginTs: string): StreamModel {
  const m = createStreamModel();
  pushMessage(m, at(meta("s-live"), "2026-10-31T08:00:00.000Z"));
  pushMessage(m, at(userText("写点东西"), "2026-10-31T08:00:01.000Z"));
  pushMessage(m, at(requestBegin(), beginTs));
  return m;
}

describe("live speed: records drive the header chip", () => {
  it("nothing to read before the first fragment, then an estimate from the streamed output", () => {
    const m = begun("2026-10-31T08:00:02.000Z");
    expect(liveOutputSpeed(m.stats)).toEqual({ tps: null, estimated: false });

    // 24 streamed characters over 4 seconds at the default 2.5 chars/token = 9.6 estimated tokens.
    pushMessage(m, at(partialText("start", "向量数据库把文本"), "2026-10-31T08:00:03.000Z"));
    pushMessage(m, at(partialText("delta", "存成高维向量，便于按相似度检索。"), "2026-10-31T08:00:06.000Z"));
    const reading = liveOutputSpeed(m.stats);
    expect(reading.estimated).toBe(true);
    expect(reading.tps).toBeCloseTo(24 / 2.5 / 4, 5);
  });

  it("thinking and tool-call arguments count as output; a streamed tool OUTPUT does not", () => {
    const m = begun("2026-10-31T08:00:02.000Z");
    pushMessage(m, at(partialThinking("start", "先想想"), "2026-10-31T08:00:03.000Z"));
    const afterThinking = m.stats.liveChars;
    expect(afterThinking).toBe(3);

    pushMessage(
      m,
      at(
        partialToolCall({ eventType: "delta", toolCallId: "call-1", name: "read_file", arguments: '{"path":"a"}' }),
        "2026-10-31T08:00:04.000Z",
      ),
    );
    expect(m.stats.liveChars).toBe(3 + '{"path":"a"}'.length);

    pushMessage(
      m,
      at(
        partialToolCallOutput({ eventType: "delta", toolCallId: "call-1", output: "x".repeat(200) }),
        "2026-10-31T08:00:05.000Z",
      ),
    );
    expect(m.stats.liveChars).toBe(3 + '{"path":"a"}'.length);
  });

  it("the Request's usage settles the exact figure and calibrates the next estimate", () => {
    const m = begun("2026-10-31T08:00:02.000Z");
    pushMessage(
      m,
      at(partialText("start", "x".repeat(100)), "2026-10-31T08:00:05.000Z"),
    );
    // A completed message replaces the fragment; it carries no characters of its own.
    pushMessage(m, at(assistantText("x".repeat(100)), "2026-10-31T08:00:05.500Z"));
    pushMessage(m, at(tokenUsage(counts(40 + 50), out(50)), "2026-10-31T08:00:06.000Z"));

    // 50 output tokens over the 4 s the Request ran.
    expect(liveOutputSpeed(m.stats)).toEqual({ tps: 12.5, estimated: false });
    // 100 characters ÷ 50 tokens calibrates the ratio for the next Request.
    expect(m.stats.liveCharsPerToken).toBe(2);
    pushMessage(m, at(requestEnd("completed"), "2026-10-31T08:00:06.100Z"));

    // Next Request: 200 characters ÷ the calibrated 2 = 100 tokens over 5 s.
    pushMessage(m, at(requestBegin(), "2026-10-31T08:00:10.000Z"));
    pushMessage(m, at(partialText("start", "y".repeat(200)), "2026-10-31T08:00:15.000Z"));
    expect(liveOutputSpeed(m.stats)).toEqual({ tps: 20, estimated: true });
  });

  it("a Request that ends without usage leaves no reading behind", () => {
    const m = begun("2026-10-31T08:00:02.000Z");
    pushMessage(m, at(partialText("start", "半句话"), "2026-10-31T08:00:03.000Z"));
    expect(liveOutputSpeed(m.stats).estimated).toBe(true);
    pushMessage(m, at(requestEnd("fatal"), "2026-10-31T08:00:04.000Z"));
    expect(liveOutputSpeed(m.stats)).toEqual({ tps: null, estimated: false });
  });
});
