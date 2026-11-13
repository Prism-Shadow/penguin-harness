/**
 * What a reply's read-only blocks read (features/chat/a2ui-answered.ts): the text of the first
 * message the person wrote after it, which an answered choice or form reads its answers back
 * from, handed out as one actions object per reply that keeps its identity across frames.
 *
 * - Given a reply and the prompt after it, the reply is answered with the prompt's own words:
 *   its skill block and attachment lines taken off.
 * - Given several replies before a message, each is answered with it; a reply after the last
 *   message is answered with nothing.
 * - Given harness inputs (a hook's continue, a schedule, a background completion) between a
 *   reply and the person's message, they are passed over for the person's message.
 * - Given a steer, it answers the reply; given a prompt with images, its text does.
 * - Given a frame that changes nothing, every reply keeps its actions object; a message
 *   arriving replaces only the answered reply's, and a language change replaces them all.
 */
import { describe, expect, it } from "vitest";
import { buildBackgroundTaskDoneMessage, buildScheduledMessage } from "@prismshadow/amsp/markers";
import { readOnlyActions, replyAnswers } from "../src/features/chat/a2ui-answered";
import { buildSkillsMessage } from "../src/features/chat/skill-use";
import type { ChatItem } from "../src/lib/amsp/stream-model";

let nextId = 0;
const user = (text: string): ChatItem => ({ kind: "user_text", id: nextId++, text });
const harness = (text: string): ChatItem => ({
  kind: "user_text",
  id: nextId++,
  text,
  sender: "harness",
});
const steer = (text: string): ChatItem => ({ kind: "user_steering", id: nextId++, text });
const image = (): ChatItem => ({ kind: "user_image", id: nextId++, imageUrl: "/a.png" });
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

const FORM = "Fill this in:\n\n```a2ui\n{}\n```";
/** Where the server puts a file attached to a message: the Session's scratchpad. */
const ATTACHED = "[attached file: /home/u/.penguin/data/p1/agents/a1/scratchpad/s1/notes.txt]";

describe("replyAnswers", () => {
  it("answers a reply with the prompt's own words, its skill block and attachments taken off", () => {
    const question = reply(FORM);
    const answer = user(buildSkillsMessage(["deploy"], `Region: EU\nPods: 3\n\n${ATTACHED}`));
    expect(replyAnswers([user("plan it"), question, stats(), answer]).get(question.id)).toBe(
      "Region: EU\nPods: 3",
    );
  });

  it("answers every reply before a message with it, and the reply after the last with nothing", () => {
    const first = reply("Checking…");
    const second = reply(FORM);
    const later = reply("Done.");
    const answers = replyAnswers([first, second, stats(), user("Pods: 3"), later, stats()]);
    expect(answers.get(first.id)).toBe("Pods: 3");
    expect(answers.get(second.id)).toBe("Pods: 3");
    expect(answers.has(later.id)).toBe(false);
  });

  it("passes over what the harness fed in for the person's message", () => {
    const question = reply(FORM);
    const items = [
      question,
      harness("goal round 2"),
      user(buildScheduledMessage("nightly", "2026-10-22T00:00:00Z", "run the report")),
      user(
        buildBackgroundTaskDoneMessage(
          { kind: "command", id: "proc-1", status: "completed", detail: "exit code 0" },
          "Background command finished",
        ),
      ),
      reply("Still waiting for your answers."),
      user("Pods: 4"),
    ];
    expect(replyAnswers(items).get(question.id)).toBe("Pods: 4");
  });

  it("answers with a steer's words, and with a prompt's text over its images", () => {
    const steered = reply(FORM);
    expect(replyAnswers([steered, steer(`Pods: 5\n\n${ATTACHED}`)]).get(steered.id)).toBe(
      "Pods: 5",
    );
    const pictured = reply(FORM);
    expect(replyAnswers([pictured, user("Pods: 6"), image(), image()]).get(pictured.id)).toBe(
      "Pods: 6",
    );
  });
});

describe("readOnlyActions", () => {
  it("keeps each reply's object while its answer and language hold, and replaces only what changed", () => {
    const answered = reply(FORM);
    const open = reply(FORM);
    const items = [answered, user("Pods: 3"), open];
    const first = readOnlyActions(new Map(), items, "en");
    expect(first.get(answered.id)).toMatchObject({
      interactive: false,
      lang: "en",
      answeredWith: "Pods: 3",
    });
    expect(first.get(open.id)).not.toHaveProperty("answeredWith");

    // The next stream frame: nothing a block reads changed.
    const frame = readOnlyActions(first, [...items, stats()], "en");
    expect(frame.get(answered.id)).toBe(first.get(answered.id));
    expect(frame.get(open.id)).toBe(first.get(open.id));

    // The person answers the open question: only that reply's value moves.
    const sent = readOnlyActions(frame, [...items, stats(), user("Pods: 4")], "en");
    expect(sent.get(answered.id)).toBe(first.get(answered.id));
    expect(sent.get(open.id)).not.toBe(first.get(open.id));
    expect(sent.get(open.id)?.answeredWith).toBe("Pods: 4");

    // A new interface language reaches every reply.
    const zh = readOnlyActions(sent, items, "zh");
    expect(zh.get(answered.id)).not.toBe(sent.get(answered.id));
    expect(zh.get(answered.id)?.lang).toBe("zh");
  });
});
