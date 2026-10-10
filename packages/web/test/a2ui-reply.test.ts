/**
 * Which reply's rich blocks take input (features/chat/a2ui-reply.ts): the main conversation's
 * latest reply, and only while nothing has been said to the model after it. Every other
 * reply's choices and forms render read-only.
 */
import { describe, expect, it } from "vitest";
import { interactiveReplyIndex } from "../src/features/chat/a2ui-reply";
import type { ChatItem } from "../src/lib/omni/stream-model";

/** The main conversation's origin chain; a subagent's conversation has its own ids in it. */
const MAIN: readonly string[] = [];

let nextId = 0;
const ask = (text: string): ChatItem => ({ kind: "user_text", id: nextId++, text });
const reply = (text: string): ChatItem => ({
  kind: "assistant_text",
  id: nextId++,
  text,
  streaming: false,
});
const stats = (): ChatItem => ({
  kind: "task_stats",
  id: nextId++,
  stats: null,
  assistantText: "",
});

describe("interactiveReplyIndex", () => {
  it("is the latest reply, past the stats row that closes its turn", () => {
    const items = [
      ask("plan it"),
      reply("Which one?"),
      stats(),
      ask("B"),
      reply("Pick a size."),
      stats(),
    ];
    expect(interactiveReplyIndex(items, MAIN)).toBe(4);
    // The same transcript in a subagent's conversation: there is no composer to answer into.
    expect(interactiveReplyIndex(items, ["child-1"])).toBe(-1);
  });

  it("is none once the user has answered, and none in a transcript with no reply", () => {
    const steer: ChatItem = { kind: "user_steering", id: nextId++, text: "the second one" };
    const answered = [ask("plan it"), reply("Which one?"), stats(), ask("B")];
    expect(interactiveReplyIndex(answered, MAIN)).toBe(-1);
    expect(interactiveReplyIndex([ask("plan it"), reply("Which one?"), steer], MAIN)).toBe(-1);
    expect(interactiveReplyIndex([ask("plan it")], MAIN)).toBe(-1);
  });
});
