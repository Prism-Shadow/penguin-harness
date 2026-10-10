import { describe, expect, it } from "vitest";
import {
  abortEvent,
  addTokenCounts,
  approvalDecision,
  assistantText,
  emptyTokenCounts,
  isCompleteModelMessage,
  partialText,
  partialToolCallOutput,
  toolCallOutput,
  userText,
} from "../src/omnimessage/index.js";
import type { ToolCallOutputPayload } from "../src/omnimessage/index.js";

describe("builders", () => {
  it("stamps an ISO 8601 timestamp and correct shells", () => {
    const m = userText("hi");
    expect(m.type).toBe("model_msg");
    expect(m.payload.type).toBe("text");
    expect(m.payload.role).toBe("user");
    expect(new Date(m.timestamp).toISOString()).toBe(m.timestamp);
  });

  it("builds event messages", () => {
    const a = approvalDecision("allow", "call_1");
    expect(a.type).toBe("event_msg");
    expect(a.payload).toMatchObject({
      type: "approval_decision",
      decision: "allow",
      tool_call_id: "call_1",
    });
    expect(abortEvent().payload).toMatchObject({
      type: "abort",
      error_code: "user_abort",
    });
    expect(abortEvent("backoff_interrupted").payload).toMatchObject({
      type: "abort",
      error_code: "backoff_interrupted",
    });
  });

  it("toolCallOutput carries optional images and round-trips through JSON", () => {
    const dataUrl = "data:image/png;base64,AAAA";
    const msg = toolCallOutput({
      output: "image/png, 4 B",
      toolCallId: "call_img",
      images: [dataUrl],
    });
    expect(msg.payload).toMatchObject({
      type: "tool_call_output",
      role: "user",
      output: "image/png, 4 B",
      images: [dataUrl],
      tool_call_id: "call_img",
      stop_reason: "completed",
    });
    // A JSON serialization round-trip preserves images (same shape as Trace persistence / replay).
    const revived = JSON.parse(JSON.stringify(msg)) as { payload: ToolCallOutputPayload };
    expect(revived.payload.images).toEqual([dataUrl]);
    // The images field is not produced when omitted or given an empty array (absence means no
    // images; serialization does not carry an empty field).
    expect("images" in toolCallOutput({ output: "x", toolCallId: "c" }).payload).toBe(false);
    expect("images" in toolCallOutput({ output: "x", toolCallId: "c", images: [] }).payload).toBe(
      false,
    );
  });

  it("partialToolCallOutput delta carries optional images (whole image in one delta)", () => {
    const dataUrl = "data:image/png;base64,AAAA";
    const msg = partialToolCallOutput({
      eventType: "delta",
      toolCallId: "call_img",
      images: [dataUrl],
    });
    expect(msg.payload).toMatchObject({
      type: "partial_tool_call_output",
      event_type: "delta",
      output: "",
      images: [dataUrl],
      tool_call_id: "call_img",
    });
    // The images field is not produced when omitted or given an empty array (same as the complete message).
    expect("images" in partialToolCallOutput({ eventType: "delta", toolCallId: "c" }).payload).toBe(
      false,
    );
    expect(
      "images" in
        partialToolCallOutput({ eventType: "delta", toolCallId: "c", images: [] }).payload,
    ).toBe(false);
  });

  it("adds token counts", () => {
    const a = { cache_read: 1, cache_write: 2, output: 3, total: 6 };
    const b = { cache_read: 10, cache_write: 20, output: 30, total: 60 };
    expect(addTokenCounts(a, b)).toEqual({
      cache_read: 11,
      cache_write: 22,
      output: 33,
      total: 66,
    });
    expect(emptyTokenCounts()).toEqual({
      cache_read: 0,
      cache_write: 0,
      output: 0,
      total: 0,
    });
  });
});

describe("isCompleteModelMessage", () => {
  it("distinguishes complete from partial model messages", () => {
    expect(isCompleteModelMessage(assistantText("done"))).toBe(true);
    expect(isCompleteModelMessage(partialText("delta", "x"))).toBe(false);
    expect(isCompleteModelMessage(approvalDecision("deny", "c"))).toBe(false);
  });
});
