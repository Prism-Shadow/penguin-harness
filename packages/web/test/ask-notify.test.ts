import { describe, expect, it } from "vitest";
import { collectAskMessages, createAskTracker } from "../src/features/chat/ask-notify";
import type { ObservedAskMessage } from "../src/features/chat/ask-notify";
import type { AssistantTextItem, ChatItem } from "../src/lib/omni/stream-model";

/** One question card written the way a model writes it (see ask-block.ts). */
function askText(title: string): string {
  return ["这点我先确认一下。", "", "```ask", `title: ${title}`, "1. 甲", "2. 乙", "```"].join(
    "\n",
  );
}

const msg = (itemId: number, cardCount = 1): ObservedAskMessage => ({ itemId, cardCount });

describe("createAskTracker", () => {
  it("never fires on the first observation of a Session", () => {
    const t = createAskTracker();
    expect(t.observe("s", [msg(1), msg(2)], 0)).toBeNull();
    // Nothing new afterwards either: the baseline is where the conversation already was.
    expect(t.observe("s", [msg(1), msg(2)], 1000)).toBeNull();
  });

  it("fires for a message that arrives after the baseline, with its card count", () => {
    const t = createAskTracker();
    t.observe("s", [], 0);
    expect(t.observe("s", [msg(7, 3)], 1000)).toEqual({ sessionId: "s", count: 3 });
  });

  it("aggregates the messages of one arrival into a single event", () => {
    const t = createAskTracker();
    t.observe("s", [], 0);
    expect(t.observe("s", [msg(7, 2), msg(8, 1)], 1000)).toEqual({ sessionId: "s", count: 3 });
  });

  it("marks messages known even when a notification was not shown: no replay later", () => {
    const t = createAskTracker();
    t.observe("s", [], 0);
    expect(t.observe("s", [msg(7)], 1000)).toEqual({ sessionId: "s", count: 1 });
    // The same arrival observed again (a re-render, a focus change) says nothing.
    expect(t.observe("s", [msg(7)], 2000)).toBeNull();
    expect(t.observe("s", [msg(7)], 60_000)).toBeNull();
  });

  it("reuses the cooldown to absorb a re-numbered transcript", () => {
    const t = createAskTracker(10_000);
    t.observe("s", [], 0);
    expect(t.observe("s", [msg(7)], 1000)).toEqual({ sessionId: "s", count: 1 });
    // A resync rebuilds the view model and the same card comes back with a new item id.
    expect(t.observe("s", [msg(99)], 2000)).toBeNull();
    // Past the cooldown a fresh arrival is announced again.
    expect(t.observe("s", [msg(100)], 30_000)).toEqual({ sessionId: "s", count: 1 });
  });

  it("re-baselines on a Session switch instead of announcing its transcript", () => {
    const t = createAskTracker();
    t.observe("a", [], 0);
    expect(t.observe("b", [msg(1), msg(2, 2)], 1000)).toBeNull();
    expect(t.observe("b", [msg(1), msg(2, 2), msg(3)], 2000)).toEqual({
      sessionId: "b",
      count: 1,
    });
  });

  it("treats an item id seen in another Session as new (ids restart per view model)", () => {
    const t = createAskTracker();
    t.observe("a", [msg(1)], 0);
    t.observe("b", [msg(1)], 0);
    expect(t.observe("b", [msg(1), msg(2)], 1000)).toEqual({ sessionId: "b", count: 1 });
  });

  it("forgets everything when no Session is open, so the next load baselines again", () => {
    const t = createAskTracker();
    t.observe("s", [], 0);
    expect(t.observe("s", [msg(7)], 1000)).toEqual({ sessionId: "s", count: 1 });
    expect(t.observe(null, [], 2000)).toBeNull();
    // Back to the same Session — a page load, not an arrival.
    expect(t.observe("s", [msg(7)], 3000)).toBeNull();
  });

  it("reset() drops the baseline (used while the transcript is loading)", () => {
    const t = createAskTracker();
    t.observe("s", [msg(7)], 0);
    t.reset();
    expect(t.observe("s", [msg(7)], 1000)).toBeNull();
  });
});

describe("collectAskMessages", () => {
  const reply = (id: number, text: string, streaming = false): AssistantTextItem => ({
    kind: "assistant_text",
    id,
    text,
    streaming,
  });

  it("collects settled replies that carry cards, with their counts", () => {
    const items = [
      reply(1, askText("第一个问题？")),
      reply(2, "没有卡片的回复"),
      reply(3, `${askText("第二个问题？")}\n\n${askText("第三个问题？")}`),
    ];
    expect(collectAskMessages(items)).toEqual([msg(1, 1), msg(3, 2)]);
  });

  it("ignores a reply that is still streaming (its block is half-written)", () => {
    expect(collectAskMessages([reply(1, askText("问题？"), true)])).toEqual([]);
  });

  it("ignores a fence that is not a well-formed question", () => {
    // A single option is prose, not a question — ask-block.ts returns null and the message
    // renders as a plain code block.
    const body = ["```ask", "title: 只有一项？", "1. 甲", "```"].join("\n");
    expect(collectAskMessages([reply(1, body)])).toEqual([]);
  });

  it("ignores messages that are not assistant text", () => {
    const items = [
      { kind: "user_text", id: 1, text: askText("用户写的问题？") },
      { kind: "thinking", id: 2, text: askText("思考里的问题？"), streaming: false },
    ] as unknown as ChatItem[];
    expect(collectAskMessages(items)).toEqual([]);
  });
});
