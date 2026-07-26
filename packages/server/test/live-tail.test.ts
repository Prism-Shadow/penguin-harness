/**
 * LiveTailTracker unit tests: open-fragment accumulation into synthetic `partial_* start`
 * messages, closure on stop / matching complete message / clear, origin preservation for
 * subagent fragments, and the tail-keeping cap.
 */
import { describe, expect, it } from "vitest";
import {
  assistantText,
  partialText,
  partialThinking,
  partialToolCall,
  partialToolCallOutput,
  requestBegin,
  thinkingMessage,
  toolCall,
  toolCallOutput,
  userText,
  withOrigin,
} from "@prismshadow/penguin-core";
import type {
  PartialTextPayload,
  PartialToolCallOutputPayload,
  PartialToolCallPayload,
} from "@prismshadow/penguin-core";
import { LiveTailTracker } from "../src/runtime/live-tail.js";

const SID = "s1";

describe("live-tail", () => {
  it("accumulates text/thinking/tool-call/tool-output fragments into synthetic starts with full prefixes", () => {
    const t = new LiveTailTracker();
    t.observe(SID, partialThinking("start"));
    t.observe(SID, partialThinking("delta", "let me "));
    t.observe(SID, partialThinking("delta", "think"));
    t.observe(SID, partialText("start", ""));
    t.observe(SID, partialText("delta", "Hel"));
    t.observe(SID, partialText("delta", "lo"));
    t.observe(SID, partialToolCall({ eventType: "start", name: "exec_command", toolCallId: "t1" }));
    t.observe(
      SID,
      partialToolCall({
        eventType: "delta",
        name: "",
        arguments: '{"cmd":"ls"}',
        toolCallId: "t1",
      }),
    );

    const frags = t.fragments(SID);
    expect(frags.map((f) => (f.payload as { type: string }).type)).toEqual([
      "partial_thinking",
      "partial_text",
      "partial_tool_call",
    ]);
    // Every synthetic message is a start carrying the accumulated content.
    for (const f of frags) {
      expect((f.payload as { event_type: string }).event_type).toBe("start");
    }
    expect((frags[0]!.payload as { thinking: string }).thinking).toBe("let me think");
    expect((frags[1]!.payload as PartialTextPayload).text).toBe("Hello");
    const call = frags[2]!.payload as PartialToolCallPayload;
    expect(call.name).toBe("exec_command");
    expect(call.arguments).toBe('{"cmd":"ls"}');
    expect(call.tool_call_id).toBe("t1");
  });

  it("stop closes the fragment; a matching complete message also closes it (stop-less closure)", () => {
    const t = new LiveTailTracker();
    t.observe(SID, partialText("start", "a"));
    t.observe(SID, partialThinking("start", "b"));
    expect(t.fragments(SID)).toHaveLength(2);
    t.observe(SID, partialText("stop"));
    expect(t.fragments(SID)).toHaveLength(1);
    // Complete thinking closes the open thinking fragment even without a stop.
    t.observe(SID, thinkingMessage("b (complete)"));
    expect(t.fragments(SID)).toEqual([]);
  });

  it("a complete tool_call/tool_call_output closes only the fragment with the same tool_call_id", () => {
    const t = new LiveTailTracker();
    t.observe(SID, partialToolCallOutput({ eventType: "start", toolCallId: "t1" }));
    t.observe(
      SID,
      partialToolCallOutput({ eventType: "delta", output: "line 1\n", toolCallId: "t1" }),
    );
    t.observe(SID, partialToolCall({ eventType: "start", name: "x", toolCallId: "t2" }));
    t.observe(SID, toolCallOutput({ output: "other", toolCallId: "t9" }));
    expect(t.fragments(SID)).toHaveLength(2);
    t.observe(SID, toolCallOutput({ output: "line 1\nline 2\n", toolCallId: "t1" }));
    t.observe(SID, toolCall({ name: "x", arguments: "{}", toolCallId: "t2" }));
    expect(t.fragments(SID)).toEqual([]);
  });

  it("a user text (steering) does not close the model's open text fragment; events are ignored", () => {
    const t = new LiveTailTracker();
    t.observe(SID, partialText("start", "prefix"));
    t.observe(SID, userText("steer this way"));
    t.observe(SID, requestBegin());
    const frags = t.fragments(SID);
    expect(frags).toHaveLength(1);
    expect((frags[0]!.payload as PartialTextPayload).text).toBe("prefix");
    // The assistant's complete text does close it.
    t.observe(SID, assistantText("prefix done"));
    expect(t.fragments(SID)).toEqual([]);
  });

  it("preserves origin: subagent fragments are keyed and emitted with their origin chain", () => {
    const t = new LiveTailTracker();
    t.observe(SID, partialText("start", "parent "));
    t.observe(SID, withOrigin(partialText("start", "child "), "c1"));
    t.observe(SID, withOrigin(partialText("delta", "progress"), "c1"));
    // The parent's complete text closes only the parent fragment (same type, different origin).
    t.observe(SID, assistantText("parent done"));
    const frags = t.fragments(SID);
    expect(frags).toHaveLength(1);
    expect(frags[0]!.origin).toEqual(["c1"]);
    expect((frags[0]!.payload as PartialTextPayload).text).toBe("child progress");
  });

  it("tool-output images ride the synthetic start (whole-set semantics)", () => {
    const dataUrl = "data:image/png;base64,AAAA";
    const t = new LiveTailTracker();
    t.observe(SID, partialToolCallOutput({ eventType: "start", toolCallId: "t1" }));
    t.observe(
      SID,
      partialToolCallOutput({
        eventType: "delta",
        output: "image/png",
        toolCallId: "t1",
        images: [dataUrl],
      }),
    );
    const frag = t.fragments(SID)[0]!.payload as PartialToolCallOutputPayload;
    expect(frag.output).toBe("image/png");
    expect(frag.images).toEqual([dataUrl]);
  });

  it("caps a runaway fragment by keeping the TAIL (the seed then joins the live deltas seamlessly)", () => {
    const t = new LiveTailTracker();
    t.observe(SID, partialText("start", ""));
    const chunk = "x".repeat(64 * 1024);
    for (let i = 0; i < 12; i += 1) t.observe(SID, partialText("delta", chunk)); // 768KB total
    t.observe(SID, partialText("delta", "THE-TAIL"));
    const text = (t.fragments(SID)[0]!.payload as PartialTextPayload).text;
    expect(text.length).toBeLessThanOrEqual(512 * 1024 + 64 * 1024);
    expect(text.endsWith("THE-TAIL")).toBe(true);
  });

  it("clear drops every fragment of the session; other sessions are unaffected", () => {
    const t = new LiveTailTracker();
    t.observe(SID, partialText("start", "a"));
    t.observe("s2", partialText("start", "b"));
    t.clear(SID);
    expect(t.fragments(SID)).toEqual([]);
    expect(t.fragments("s2")).toHaveLength(1);
  });

  it("a lenient delta without a start still opens a fragment (mirrors core PartialAggregator); a bare stop is a no-op", () => {
    const t = new LiveTailTracker();
    t.observe(SID, partialText("stop"));
    expect(t.fragments(SID)).toEqual([]);
    t.observe(SID, partialText("delta", "late"));
    expect((t.fragments(SID)[0]!.payload as PartialTextPayload).text).toBe("late");
  });

  it("a reopening start replaces the previous same-key fragment", () => {
    const t = new LiveTailTracker();
    t.observe(SID, partialText("start", "first"));
    t.observe(SID, partialText("start", "second"));
    const frags = t.fragments(SID);
    expect(frags).toHaveLength(1);
    expect((frags[0]!.payload as PartialTextPayload).text).toBe("second");
  });
});
