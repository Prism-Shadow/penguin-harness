/**
 * Model connectivity-probe verdict tests (testModel's pure parts): streamed-content
 * detection and the outcome verdict — in particular the reasoning-heavy-model case where
 * the probe's tiny max_tokens is burned entirely on thinking (finish_reason=length ->
 * AgentHub EmptyResponseError -> malformed outcome) yet the endpoint demonstrably works.
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
import { isProbeContent, probeVerdict } from "../src/services/project-config-service.js";

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
