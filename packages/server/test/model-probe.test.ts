/**
 * Model connectivity-probe tests (testModel's pure parts): streamed-content detection, the
 * outcome verdict — in particular the reasoning-heavy-model case where the probe's tiny
 * max_tokens is burned entirely on thinking (finish_reason=length -> AgentHub
 * EmptyResponseError -> malformed outcome) yet the endpoint demonstrably works — and the
 * output-rate guard that keeps a too-small sample from being reported as throughput.
 */
import { describe, expect, it } from "vitest";
import {
  assistantText,
  partialText,
  partialThinking,
  thinkingMessage,
  tokenUsage,
  toolCall,
  emptyTokenCounts,
} from "@prismshadow/penguin-core";
import { isProbeContent, probeTps, probeVerdict } from "../src/services/project-config-service.js";

describe("isProbeContent", () => {
  it("counts thinking and text content, partial or complete", () => {
    expect(isProbeContent(partialThinking("delta", "let me think"))).toBe(true);
    expect(isProbeContent(partialText("delta", "pong"))).toBe(true);
    expect(isProbeContent(thinkingMessage("burned the whole budget", "malformed"))).toBe(true);
    expect(isProbeContent(assistantText("pong"))).toBe(true);
  });

  it("ignores empty segments, events, and tool calls", () => {
    expect(isProbeContent(partialThinking("start"))).toBe(false);
    expect(isProbeContent(partialThinking("stop", "", "malformed"))).toBe(false);
    expect(isProbeContent(thinkingMessage("", "malformed", { id: "rs_1" }))).toBe(false);
    expect(isProbeContent(tokenUsage(emptyTokenCounts(), emptyTokenCounts()))).toBe(false);
    expect(isProbeContent(toolCall({ name: "t", arguments: "{}", toolCallId: "tc1" }))).toBe(false);
  });
});

describe("probeVerdict", () => {
  it("passes a completed probe", () => {
    expect(probeVerdict({ status: "completed" }, false)).toEqual({ ok: true });
  });

  it("passes a thinking-only malformed ending when content was streamed (reasoning model hit the tiny cap)", () => {
    const outcome = {
      status: "malformed" as const,
      message: 'OpenaiClient returned no content other than thinking (finish_reason="length").',
    };
    expect(probeVerdict(outcome, true)).toEqual({ ok: true });
  });

  it("fails a malformed ending with nothing received (broken response, not a working endpoint)", () => {
    const verdict = probeVerdict({ status: "malformed", message: "unexpected EOF" }, false);
    expect(verdict).toEqual({ ok: false, message: "unexpected EOF" });
  });

  it("fails timeouts and errors even when content was streamed (flaky is not ok)", () => {
    expect(probeVerdict({ status: "timeout" }, true)).toEqual({ ok: false, message: "timeout" });
    expect(probeVerdict({ status: "failed", message: "401 unauthorized" }, true)).toEqual({
      ok: false,
      message: "401 unauthorized",
    });
    expect(probeVerdict({ status: "aborted" }, true)).toEqual({ ok: false, message: "aborted" });
  });

  it("truncates long failure messages to 300 characters", () => {
    const verdict = probeVerdict({ status: "failed", message: "x".repeat(500) }, false);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.message).toHaveLength(300);
  });
});

describe("probeTps", () => {
  it("reports the rate for a sample that spans a real streaming window", () => {
    // The speed probe's 64-token cap: a full window is what the badge thresholds grade.
    expect(probeTps(64, 1000)).toBe(64);
    expect(probeTps(48, 900)).toBe(53.3);
  });

  it("reports at the sample floors", () => {
    expect(probeTps(16, 400)).toBe(40);
    expect(probeTps(16, 101)).toBe(158.4);
  });

  it("omits the rate for a one-word answer (jitter, not throughput)", () => {
    // 2 tokens in 30ms would read as 66.7 tok/s; 30ms of jitter later, as 33.3 — the caller
    // still reports ttftMs, just no rate.
    expect(probeTps(2, 30)).toBeUndefined();
    expect(probeTps(2, 60)).toBeUndefined();
    expect(probeTps(15, 300)).toBeUndefined();
  });

  it("omits the rate for a window too short to time, however many tokens arrived", () => {
    expect(probeTps(64, 100)).toBeUndefined();
    expect(probeTps(64, 0)).toBeUndefined();
  });

  it("omits the rate when no usage was reported (malformed thinking-only ending)", () => {
    expect(probeTps(0, 5000)).toBeUndefined();
  });
});
