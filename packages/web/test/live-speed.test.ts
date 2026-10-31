/**
 * Unit tests for the live output-speed reading behind the chat header's tok/s chip
 * (task-stats.ts): an estimate from the streamed characters while a Request runs, replaced by
 * the exact figure its own `token_usage` reports.
 */
import { describe, expect, it } from "vitest";
import type { TokenUsagePayload } from "@prismshadow/amsp";
import {
  abandonLiveRequest,
  addLlmDuration,
  beginLiveRequest,
  createTaskStatsTracker,
  DEFAULT_CHARS_PER_TOKEN,
  endTask,
  liveOutputSpeed,
  noteLiveChars,
  settleLiveRequest,
  trackMainUsage,
} from "../src/lib/amsp/task-stats";

/** A token_usage carrying `output` output tokens (the only bucket the speed reading needs). */
function req(cacheRead: number, cacheWrite: number, output: number): TokenUsagePayload {
  const total = cacheRead + cacheWrite + output;
  return {
    type: "token_usage",
    session: { cache_read: 0, cache_write: 0, output: 0, total },
    request: { cache_read: cacheRead, cache_write: cacheWrite, output, total },
  };
}

describe("live output speed (the header's tok/s chip)", () => {
  it("nothing is measured before a Request runs, so the chip has nothing to show", () => {
    const t = createTaskStatsTracker();
    expect(liveOutputSpeed(t)).toEqual({ tps: null, estimated: false });
  });

  it("while a Request streams the reading is an estimate from the characters so far", () => {
    const t = createTaskStatsTracker();
    beginLiveRequest(t, 1_000_000);
    // 250 characters after 2s at the default 2.5 chars/token = 100 estimated tokens → 50 tok/s.
    noteLiveChars(t, 250, 1_002_000);
    expect(liveOutputSpeed(t)).toEqual({ tps: 50, estimated: true });
    // Twice the characters over twice the time: the running average holds, it does not jump.
    noteLiveChars(t, 250, 1_004_000);
    expect(liveOutputSpeed(t).tps).toBe(50);
  });

  it("the Request's usage replaces the estimate with the exact figure and calibrates the next one", () => {
    const t = createTaskStatsTracker();
    beginLiveRequest(t, 0);
    noteLiveChars(t, 300, 3_000); // estimated 120 tokens over 3s = 40 tok/s
    expect(liveOutputSpeed(t)).toEqual({ tps: 40, estimated: true });
    // Reported usage: 60 output tokens over the same 3s = 20 tok/s exactly, and the tokenizer
    // turn out to be 300 chars ÷ 60 tokens = 5 chars/token for the rest of the session.
    settleLiveRequest(t, 60, 3_000);
    expect(liveOutputSpeed(t)).toEqual({ tps: 20, estimated: false });
    expect(t.liveCharsPerToken).toBe(5);
    // The next Request now estimates with the calibrated ratio: 500 chars ÷ 5 = 100 tokens.
    beginLiveRequest(t, 10_000);
    noteLiveChars(t, 500, 12_000);
    expect(liveOutputSpeed(t)).toEqual({ tps: 50, estimated: true });
  });

  it("a Request too short to calibrate keeps the previous ratio (a couple of words says nothing about the tokenizer)", () => {
    const t = createTaskStatsTracker();
    beginLiveRequest(t, 0);
    noteLiveChars(t, 10, 500);
    settleLiveRequest(t, 20, 500);
    expect(t.liveCharsPerToken).toBe(DEFAULT_CHARS_PER_TOKEN);
    // A degenerate ratio is refused too: 1 character per 30 tokens is not a tokenizer.
    beginLiveRequest(t, 1_000);
    noteLiveChars(t, 40, 2_000);
    settleLiveRequest(t, 1200, 2_000);
    expect(t.liveCharsPerToken).toBe(DEFAULT_CHARS_PER_TOKEN);
  });

  it("streamed characters outside a Request are not counted (history replay carries no fragments, aborted Requests report nothing)", () => {
    const t = createTaskStatsTracker();
    noteLiveChars(t, 5_000, 1_000);
    expect(liveOutputSpeed(t)).toEqual({ tps: null, estimated: false });
    beginLiveRequest(t, 2_000);
    noteLiveChars(t, 100, 2_500);
    abandonLiveRequest(t);
    // The estimate never surfaced as an exact reading; nothing was fabricated.
    expect(liveOutputSpeed(t)).toEqual({ tps: null, estimated: false });
  });

  it("a Task boundary clears the reading: the finished Task's own figure is the stats row's", () => {
    const t = createTaskStatsTracker();
    beginLiveRequest(t, 0);
    noteLiveChars(t, 250, 1_000);
    settleLiveRequest(t, 100, 1_000);
    expect(liveOutputSpeed(t).tps).toBe(100);
    trackMainUsage(t, req(0, 0, 100));
    addLlmDuration(t, 1_000);
    endTask(t, 1_500);
    expect(liveOutputSpeed(t)).toEqual({ tps: null, estimated: false });
  });
});
