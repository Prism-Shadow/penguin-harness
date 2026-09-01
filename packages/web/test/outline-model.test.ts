/**
 * outline-model.ts unit tests: turn segmentation into outline entries (merge of adjacent
 * user items, banner/goal-round handling, answer accumulation), the plain-text preview
 * reduction, and the tick rail's sliding-window bounds.
 */
import { describe, expect, it } from "vitest";
import type { ChatItem } from "../src/lib/omni/stream-model";
import { handoffMessage } from "../src/features/chat/agent-handoff";
import {
  buildBackgroundTaskDoneMessage,
  buildScheduledMessage,
} from "@prismshadow/penguin-core/markers";
import {
  OUTLINE_MIN_TURNS,
  OUTLINE_WINDOW_AFTER,
  OUTLINE_WINDOW_BEFORE,
  TICK_PITCH_MAX,
  TICK_PITCH_MIN,
  buildOutline,
  globalTurnNumber,
  outlineVisible,
  previewText,
  railTickPitch,
  railWindowHalf,
  windowOutline,
} from "../src/features/chat/outline-model";

let nextId = 0;
const user = (text: string): ChatItem => ({ kind: "user_text", id: nextId++, text });
// A harness-injected input (a goal round's protocol): opens no entry, separates user runs.
const harness = (text: string): ChatItem => ({
  kind: "user_text",
  id: nextId++,
  text,
  sender: "harness",
});
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

  it("background notices: the steered item stays inside the turn, the idle-launched turn titles its entry with the report", () => {
    const report = "Background command finished: `sleep 5` (process_id proc-1) — exit code 0";
    const steered: ChatItem = {
      kind: "background_notice",
      id: nextId++,
      text: buildBackgroundTaskDoneMessage(
        {
          kind: "command",
          id: "proc-1",
          status: "completed",
          detail: "exit code 0",
          delivery: "steering",
        },
        report,
      ),
    };
    const items: ChatItem[] = [
      user("build it"),
      steered,
      assistant("it finished"),
      stats(),
      // The idle path: the notice arrives as ordinary user_text and opens its own entry —
      // titled by the harness report body, not the raw marker block.
      user(
        buildBackgroundTaskDoneMessage(
          { kind: "command", id: "proc-2", status: "completed", detail: "exit code 0" },
          report,
        ),
      ),
      assistant("reacted"),
    ];
    const outline = buildOutline(items);
    expect(outline).toHaveLength(2);
    expect(outline[0]).toMatchObject({ question: "build it", answer: "it finished" });
    expect(outline[1]).toMatchObject({ question: report, answer: "reacted" });
  });

  it("keeps one entry per goal run (harness rounds merge into the objective) and includes scheduled turns", () => {
    const items: ChatItem[] = [
      user("do the thing"),
      harness("goal round 1 protocol"),
      assistant("round 1 reply"),
      harness("goal round 2 protocol"),
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

describe("windowOutline", () => {
  /** The default window size the components render at most (20 + active + 20). */
  const SIZE = OUTLINE_WINDOW_BEFORE + 1 + OUTLINE_WINDOW_AFTER;

  it("covers everything while the window isn't outgrown", () => {
    expect(windowOutline(SIZE, 3)).toEqual({ start: 0, end: SIZE });
    expect(windowOutline(5, null)).toEqual({ start: 0, end: 5 });
    expect(windowOutline(0, null)).toEqual({ start: 0, end: 0 });
  });

  it("parks at the end without an active entry (null or -1): the newest turns show first", () => {
    expect(windowOutline(100, null)).toEqual({ start: 100 - SIZE, end: 100 });
    expect(windowOutline(100, -1)).toEqual({ start: 100 - SIZE, end: 100 });
  });

  it("centers on the active entry and recenters as it moves", () => {
    expect(windowOutline(100, 50)).toEqual({ start: 30, end: 71 });
    expect(windowOutline(100, 51)).toEqual({ start: 31, end: 72 });
  });

  it("shifts (never shrinks) at both edges, keeping the full window", () => {
    // Near the start: still SIZE entries from index 0.
    expect(windowOutline(100, 0)).toEqual({ start: 0, end: SIZE });
    expect(windowOutline(100, OUTLINE_WINDOW_BEFORE)).toEqual({ start: 0, end: SIZE });
    expect(windowOutline(100, OUTLINE_WINDOW_BEFORE + 1)).toEqual({ start: 1, end: SIZE + 1 });
    // Near the end: the last SIZE entries (the active one included).
    expect(windowOutline(100, 99)).toEqual({ start: 100 - SIZE, end: 100 });
    expect(windowOutline(100, 99 - OUTLINE_WINDOW_AFTER)).toEqual({ start: 100 - SIZE, end: 100 });
    expect(windowOutline(100, 98 - OUTLINE_WINDOW_AFTER)).toEqual({ start: 99 - SIZE, end: 99 });
  });

  it("honors custom half-widths", () => {
    expect(windowOutline(10, 5, 1, 2)).toEqual({ start: 4, end: 8 });
    expect(windowOutline(10, 0, 1, 2)).toEqual({ start: 0, end: 4 });
    expect(windowOutline(10, 9, 1, 2)).toEqual({ start: 6, end: 10 });
  });
});

describe("rail fit (pitch and height-adaptive window half-width)", () => {
  it("keeps the full half-width on a normal-height rail and shrinks it on short ones", () => {
    expect(railWindowHalf(800)).toBe(OUTLINE_WINDOW_BEFORE);
    expect(railWindowHalf(200)).toBe(14); // floor(((200-48)/5 - 1) / 2)
    expect(railWindowHalf(60)).toBe(0);
    expect(railWindowHalf(0)).toBe(0);
  });

  it("compresses the pitch toward MIN as ticks outgrow the rail, never past it", () => {
    expect(railTickPitch(860, 41)).toBe(TICK_PITCH_MAX);
    expect(railTickPitch(500, 5)).toBe(TICK_PITCH_MAX);
    expect(railTickPitch(253, 41)).toBe(TICK_PITCH_MIN);
    expect(railTickPitch(100, 41)).toBe(TICK_PITCH_MIN); // clamped, not floor's 1
  });

  it("the windowed stack always fits inside the rail (the overlap-with-composer guard)", () => {
    for (let height = 60; height <= 1200; height += 7) {
      const count = 2 * railWindowHalf(height) + 1;
      // Ticks plus the two edge-dot marks (~36px worst case) stay within the rail.
      expect(count * railTickPitch(height, count) + 36).toBeLessThanOrEqual(height);
    }
  });
});

describe("windowed-history offset (globalTurnNumber / outlineVisible)", () => {
  it("numbers loaded entries globally: offset (unloaded earlier turns) + loaded index + 1", () => {
    // A conversation of 10 turns loaded from turn 8 on (server earlierTurns = 7): the
    // three loaded entries must read 第 8/9/10 轮 — the window never renumbers.
    const items: ChatItem[] = [
      user("q8"),
      assistant("a8"),
      stats(),
      user("q9"),
      assistant("a9"),
      stats(),
      user("q10"),
    ];
    const entries = buildOutline(items);
    expect(entries.map((_, i) => globalTurnNumber(7, i))).toEqual([8, 9, 10]);
    // Without an offset the numbering degenerates to the classic 1-based index.
    expect(globalTurnNumber(0, 0)).toBe(1);
  });

  it("the visibility gate counts the WHOLE conversation, not the loaded window", () => {
    // Two loaded entries alone would hide the outline; 7 earlier turns make it a long
    // conversation that deserves its index (with the earlier-turns hint shown).
    expect(outlineVisible(0, 2)).toBe(false);
    expect(outlineVisible(7, 2)).toBe(true);
    expect(outlineVisible(0, OUTLINE_MIN_TURNS)).toBe(true);
    expect(outlineVisible(OUTLINE_MIN_TURNS, 0)).toBe(true);
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
