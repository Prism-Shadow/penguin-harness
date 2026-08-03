/**
 * outline-model.ts unit tests: turn segmentation into outline entries (merge of adjacent
 * user items, banner/goal-round handling, answer accumulation) and the plain-text preview
 * reduction.
 */
import { describe, expect, it } from "vitest";
import type { ChatItem } from "../src/lib/omni/stream-model";
import { handoffMessage } from "../src/features/chat/agent-handoff";
import { buildScheduledMessage } from "@prismshadow/penguin-core/markers";
import { buildOutline, previewText } from "../src/features/chat/outline-model";

let nextId = 0;
const user = (text: string): ChatItem => ({ kind: "user_text", id: nextId++, text });
const image = (): ChatItem => ({ kind: "user_image", id: nextId++, imageUrl: "blob:x" });
const steering = (text: string): ChatItem => ({ kind: "user_steering", id: nextId++, text });
const assistant = (text: string, streaming = false): ChatItem => ({
  kind: "assistant_text",
  id: nextId++,
  text,
  streaming,
});
const stats = (): ChatItem => ({
  kind: "task_stats",
  id: nextId++,
  stats: null,
  assistantText: "",
});

describe("buildOutline", () => {
  it("opens one entry per exchange and accumulates that turn's assistant text", () => {
    const items: ChatItem[] = [
      user("question A"),
      assistant("part one."),
      assistant("part two."),
      stats(),
      user("question B"),
      assistant("reply B"),
    ];
    const outline = buildOutline(items);
    expect(outline).toHaveLength(2);
    expect(outline[0]).toMatchObject({ question: "question A", answer: "part one. part two." });
    expect(outline[1]).toMatchObject({ question: "question B", answer: "reply B" });
    expect(outline[0]!.anchorId).toBe((items[0] as { id: number }).id);
  });

  it("merges adjacent user items into one entry and labels image-only prompts with an empty question", () => {
    const items: ChatItem[] = [image(), user("text after images"), assistant("ok"), image()];
    const outline = buildOutline(items);
    expect(outline).toHaveLength(2);
    expect(outline[0]).toMatchObject({ question: "text after images", answer: "ok" });
    expect(outline[1]).toMatchObject({ question: "", answer: "" });
  });

  it("banner-only texts open no entry but separate user runs; steering stays inside the turn", () => {
    const banner = handoffMessage({ agentId: "a", sessionId: "s", workspace: "/w" });
    const items: ChatItem[] = [
      user(banner),
      user("real question"),
      steering("mid-run note"),
      assistant("answer"),
    ];
    const outline = buildOutline(items);
    expect(outline).toHaveLength(1);
    expect(outline[0]).toMatchObject({ question: "real question", answer: "answer" });
  });

  it("keeps one entry per goal run (later rounds merge into round 1) and includes scheduled turns", () => {
    const round = (n: number) => `[goal]\nround: ${n}\nobjective: o\n[/goal]\ndo the thing`;
    const items: ChatItem[] = [
      user(round(1)),
      assistant("round 1 reply"),
      user(round(2)),
      assistant("round 2 reply"),
      user(buildScheduledMessage("nightly", "2026-08-01T00:00:00Z", "scheduled prompt")),
      assistant("scheduled reply"),
    ];
    const outline = buildOutline(items);
    expect(outline).toHaveLength(2);
    expect(outline[0]).toMatchObject({
      question: "do the thing",
      answer: "round 1 reply round 2 reply",
    });
    expect(outline[1]).toMatchObject({ question: "scheduled prompt", answer: "scheduled reply" });
  });

  it("caps answer accumulation", () => {
    const items: ChatItem[] = [user("q"), assistant("x".repeat(400)), assistant("y".repeat(400))];
    const outline = buildOutline(items);
    expect(outline[0]!.answer.length).toBeLessThanOrEqual(500);
  });
});

describe("previewText", () => {
  it("flattens markdown to one plain line", () => {
    const md =
      "# Title\n\nSome **bold** and `code`, a [link](https://x) and\n\n```ts\nconst a = 1\n```\n- item";
    expect(previewText(md, 200)).toBe("Title Some bold and code, a link and const a = 1 item");
  });

  it("truncates with an ellipsis at the cap", () => {
    expect(previewText("hello world", 5)).toBe("hello…");
    expect(previewText("hello", 5)).toBe("hello");
  });
});
