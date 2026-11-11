/**
 * LiveTailTracker unit tests: open-fragment accumulation into synthetic `partial_* start`
 * messages, closure on stop / matching complete message / clear, origin preservation for
 * subagent fragments, and the tail-keeping cap.
 *
 * The run's log (the run form of GET /messages):
 * - Given a run, its records come back in publish order with each fragment's deltas folded
 *   into its start — a start and its deltas read as one start with the joined content, then
 *   its stop and complete message as published; events and subagent records stay as published.
 * - A fragment still open when the log is read carries what has streamed so far, and a reopened
 *   fragment starts a record of its own.
 * - Given no run (before `begin`, after `clear`), there is no log; `begin` starts an empty one.
 * - Given a run larger than the log holds, its oldest closed records go first and are counted,
 *   while a fragment still streaming stays.
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
  AmspRecord,
  PartialTextPayload,
  PartialToolCallOutputPayload,
  PartialToolCallPayload,
} from "@prismshadow/penguin-core";
import { Channel } from "../src/runtime/channel.js";
import { LiveTailTracker } from "../src/runtime/live-tail.js";

const SID = "s1";

const channel = new Channel();

/** Feeds `msg` the way the drive loop does: published on the channel, then observed with the event it went out as. */
function observe(t: LiveTailTracker, sessionId: string, msg: AmspRecord): void {
  t.observe(sessionId, msg, channel.publish(msg));
}

/** One record as `kind:content`, for comparing a run's records at a glance. */
const shape = (msg: AmspRecord): string => {
  const p = msg.payload as {
    type: string;
    event_type?: string;
    text?: string;
    thinking?: string;
    output?: string;
  };
  const kind = p.event_type !== undefined ? `${p.type}/${p.event_type}` : p.type;
  const content = p.text ?? p.thinking ?? p.output;
  const origin = msg.origin !== undefined ? `@${msg.origin.join("/")}` : "";
  return content !== undefined ? `${kind}${origin}:${content}` : `${kind}${origin}`;
};

describe("live-tail", () => {
  it("accumulates text/thinking/tool-call/tool-output fragments into synthetic starts with full prefixes", () => {
    const t = new LiveTailTracker();
    observe(t, SID, partialThinking("start"));
    observe(t, SID, partialThinking("delta", "let me "));
    observe(t, SID, partialThinking("delta", "think"));
    observe(t, SID, partialText("start", ""));
    observe(t, SID, partialText("delta", "Hel"));
    observe(t, SID, partialText("delta", "lo"));
    observe(
      t,
      SID,
      partialToolCall({ eventType: "start", name: "exec_command", toolCallId: "t1" }),
    );
    observe(
      t,
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
    observe(t, SID, partialText("start", "a"));
    observe(t, SID, partialThinking("start", "b"));
    expect(t.fragments(SID)).toHaveLength(2);
    observe(t, SID, partialText("stop"));
    expect(t.fragments(SID)).toHaveLength(1);
    // Complete thinking closes the open thinking fragment even without a stop.
    observe(t, SID, thinkingMessage("b (complete)"));
    expect(t.fragments(SID)).toEqual([]);
  });

  it("a complete tool_call/tool_call_output closes only the fragment with the same tool_call_id", () => {
    const t = new LiveTailTracker();
    observe(t, SID, partialToolCallOutput({ eventType: "start", toolCallId: "t1" }));
    observe(
      t,
      SID,
      partialToolCallOutput({ eventType: "delta", output: "line 1\n", toolCallId: "t1" }),
    );
    observe(t, SID, partialToolCall({ eventType: "start", name: "x", toolCallId: "t2" }));
    observe(t, SID, toolCallOutput({ output: "other", toolCallId: "t9", status: "completed" }));
    expect(t.fragments(SID)).toHaveLength(2);
    observe(
      t,
      SID,
      toolCallOutput({ output: "line 1\nline 2\n", toolCallId: "t1", status: "completed" }),
    );
    observe(t, SID, toolCall({ name: "x", arguments: "{}", toolCallId: "t2" }));
    expect(t.fragments(SID)).toEqual([]);
  });

  it("a user text (steering) does not close the model's open text fragment; events are ignored", () => {
    const t = new LiveTailTracker();
    observe(t, SID, partialText("start", "prefix"));
    observe(t, SID, userText("steer this way"));
    observe(t, SID, requestBegin());
    const frags = t.fragments(SID);
    expect(frags).toHaveLength(1);
    expect((frags[0]!.payload as PartialTextPayload).text).toBe("prefix");
    // The assistant's complete text does close it.
    observe(t, SID, assistantText("prefix done"));
    expect(t.fragments(SID)).toEqual([]);
  });

  it("preserves origin: subagent fragments are keyed and emitted with their origin chain", () => {
    const t = new LiveTailTracker();
    observe(t, SID, partialText("start", "parent "));
    observe(t, SID, withOrigin(partialText("start", "child "), "c1"));
    observe(t, SID, withOrigin(partialText("delta", "progress"), "c1"));
    // The parent's complete text closes only the parent fragment (same type, different origin).
    observe(t, SID, assistantText("parent done"));
    const frags = t.fragments(SID);
    expect(frags).toHaveLength(1);
    expect(frags[0]!.origin).toEqual(["c1"]);
    expect((frags[0]!.payload as PartialTextPayload).text).toBe("child progress");
  });

  it("tool-output images ride the synthetic start (whole-set semantics)", () => {
    const dataUrl = "data:image/png;base64,AAAA";
    const t = new LiveTailTracker();
    observe(t, SID, partialToolCallOutput({ eventType: "start", toolCallId: "t1" }));
    observe(
      t,
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
    observe(t, SID, partialText("start", ""));
    const chunk = "x".repeat(64 * 1024);
    for (let i = 0; i < 12; i += 1) observe(t, SID, partialText("delta", chunk)); // 768KB total
    observe(t, SID, partialText("delta", "THE-TAIL"));
    const text = (t.fragments(SID)[0]!.payload as PartialTextPayload).text;
    expect(text.length).toBeLessThanOrEqual(512 * 1024 + 64 * 1024);
    expect(text.endsWith("THE-TAIL")).toBe(true);
  });

  it("clear drops every fragment of the session; other sessions are unaffected", () => {
    const t = new LiveTailTracker();
    observe(t, SID, partialText("start", "a"));
    observe(t, "s2", partialText("start", "b"));
    t.clear(SID);
    expect(t.fragments(SID)).toEqual([]);
    expect(t.fragments("s2")).toHaveLength(1);
  });

  it("a lenient delta without a start still opens a fragment; a bare stop is a no-op", () => {
    const t = new LiveTailTracker();
    observe(t, SID, partialText("stop"));
    expect(t.fragments(SID)).toEqual([]);
    observe(t, SID, partialText("delta", "late"));
    expect((t.fragments(SID)[0]!.payload as PartialTextPayload).text).toBe("late");
  });

  it("a reopening start replaces the previous same-key fragment", () => {
    const t = new LiveTailTracker();
    observe(t, SID, partialText("start", "first"));
    observe(t, SID, partialText("start", "second"));
    const frags = t.fragments(SID);
    expect(frags).toHaveLength(1);
    expect((frags[0]!.payload as PartialTextPayload).text).toBe("second");
  });
});

describe("live-tail: the run's records", () => {
  it("keeps the run's records in publish order, each fragment's deltas folded into its start", () => {
    const t = new LiveTailTracker();
    t.begin(SID);
    observe(t, SID, userText("go"));
    observe(t, SID, requestBegin());
    observe(t, SID, partialText("start", ""));
    observe(t, SID, partialText("delta", "Hel"));
    observe(t, SID, partialText("delta", "lo"));
    observe(t, SID, partialText("stop"));
    observe(t, SID, assistantText("Hello"));
    observe(t, SID, withOrigin(partialText("start", "child "), "c1"));
    observe(t, SID, withOrigin(partialText("delta", "works"), "c1"));
    observe(t, SID, withOrigin(assistantText("child works"), "c1"));

    expect(t.run(SID)!.records.map(shape)).toEqual([
      "text:go",
      "request_begin",
      "partial_text/start:Hello",
      "partial_text/stop:",
      "text:Hello",
      "partial_text/start@c1:child works",
      "text@c1:child works",
    ]);
    expect(t.run(SID)!.omitted).toBe(0);
  });

  it("a fragment still open carries what has streamed so far; a reopened one starts a record of its own", () => {
    const t = new LiveTailTracker();
    t.begin(SID);
    observe(t, SID, partialThinking("start", "let "));
    observe(t, SID, partialThinking("delta", "me"));
    expect(t.run(SID)!.records.map(shape)).toEqual(["partial_thinking/start:let me"]);

    observe(t, SID, partialThinking("delta", " think"));
    observe(t, SID, partialThinking("start", "again"));
    observe(t, SID, partialThinking("delta", "!"));
    expect(t.run(SID)!.records.map(shape)).toEqual([
      "partial_thinking/start:let me think",
      "partial_thinking/start:again!",
    ]);
    // The open-fragment view is unchanged by the log: only the reopened fragment is open.
    expect(t.fragments(SID).map(shape)).toEqual(["partial_thinking/start:again!"]);
  });

  it("there is no log outside a run; begin starts an empty one and clear drops it", () => {
    const t = new LiveTailTracker();
    observe(t, SID, assistantText("before the run"));
    expect(t.run(SID)).toBeNull();

    t.begin(SID);
    expect(t.run(SID)!.records).toEqual([]);
    expect(t.run(SID)!.omitted).toBe(0);
    observe(t, SID, assistantText("in the run"));
    expect(t.run(SID)!.records.map(shape)).toEqual(["text:in the run"]);

    t.clear(SID);
    expect(t.run(SID)).toBeNull();
    t.begin(SID);
    expect(t.run(SID)!.records).toEqual([]);
  });

  it("a run larger than the log holds drops its oldest closed records and counts them; a streaming fragment stays", () => {
    const t = new LiveTailTracker();
    t.begin(SID);
    observe(
      t,
      SID,
      partialToolCallOutput({ eventType: "start", output: "tail -f", toolCallId: "t1" }),
    );
    const big = "x".repeat(1024 * 1024);
    const sent = 12;
    for (let i = 0; i < sent; i += 1) observe(t, SID, assistantText(`${i}:${big}`));
    observe(
      t,
      SID,
      partialToolCallOutput({ eventType: "delta", output: " ...", toolCallId: "t1" }),
    );

    const run = t.run(SID)!;
    expect(run.omitted).toBeGreaterThan(0);
    // Every record is either still held or counted, the streaming fragment is the one kept
    // ahead of the rest, and the newest records are the ones held.
    expect(run.records.length + run.omitted).toBe(sent + 1);
    expect(shape(run.records[0]!)).toBe("partial_tool_call_output/start:tail -f ...");
    const held = run.records
      .slice(1)
      .map((r) => (r.payload as { text: string }).text.split(":")[0]);
    expect(held).toEqual(
      Array.from({ length: held.length }, (_, i) => String(sent - held.length + i)),
    );
  });
});
