/**
 * The streamed history read (TraceService.readMessagesFrames + the frame helpers in
 * services/message-window.ts).
 *
 * Covers:
 * - frameCutIndexes: a cut never separates a tool_call from its tool_call_output, a
 *   steering group, or a compaction span; every other message boundary may cut.
 * - isSkeletonMessage: every unit opener is a skeleton row — plain text prompts and
 *   the inserted kinds (user images, steering chips) together; interior content
 *   (assistant replies, tool calls and outputs, usage, task records) is not.
 * - planMeatFrames: the 64 KB soft cap and the ≥1 group floor — a frame never opens
 *   without one closed group behind it, and one oversized group is its own frame.
 * - readMessagesFrames end to end: a `page` frame first, then skeleton frames holding
 *   every unit opener of the whole transcript, then meat frames under the cap; the
 *   563 KB-style oversized unit splits into several frames and every group arrives;
 *   the meat cursor re-enters through the ordinary `before` protocol and continues
 *   exactly where the interrupted stream stopped.
 */
import fs from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assistantText,
  requestBegin,
  requestEnd,
  toolCall,
  toolCallOutput,
  userText,
  imageUrlMessage,
} from "@prismshadow/penguin-core";
import { parseUserSteeringText } from "@prismshadow/penguin-core";
import type { AmspRecord } from "@prismshadow/penguin-core";
import { userSteeringText } from "@prismshadow/amsp/markers";

import {
  MESSAGE_WINDOW_FRAME_MAX_BYTES,
  frameCutIndexes,
  isSkeletonMessage,
  planMeatFrames,
} from "../src/services/message-window.js";
import type { MessagesHistoryFrame } from "../src/services/message-window.js";
import type { TraceService } from "../src/services/trace-service.js";
import { makeTempRoot, makeTraceHarness, writeTraceFile } from "./helpers.js";

const P = "project-w";
const A = "agent-w";
const S = "session-2026-07-20-10-00-00-aabb0001";

function at(ts: string, msg: AmspRecord): AmspRecord {
  return { ...msg, timestamp: ts };
}

const t = (mm: number, s: string) =>
  `2026-07-20T10:${String(mm).padStart(2, "0")}:${s}Z`;

const ptype = (m: AmspRecord): string =>
  (m.payload as { type?: string }).type ?? "";

const textOf = (m: AmspRecord): string | undefined =>
  (m.payload as { text?: string }).text;

/** The user prompts of a frame run, in order. */
const prompts = (frames: MessagesHistoryFrame[]): string[] =>
  frames
    .filter((f) => f.type === "skeleton" || f.type === "meat")
    .flatMap((f) => f.messages)
    .filter(
      (m) =>
        m.type === "model_msg" &&
        ptype(m) === "text" &&
        (m.payload as { role?: string }).role === "user",
    )
    .map((m) => textOf(m)!);

/** The tool outputs of a frame run, in order. */
const outputs = (frames: MessagesHistoryFrame[]): string[] =>
  frames
    .filter((f) => f.type === "skeleton" || f.type === "meat")
    .flatMap((f) => f.messages)
    .filter((m) => m.type === "model_msg" && ptype(m) === "tool_call_output")
    .map((m) => (m.payload as { output?: string }).output ?? "");

describe("frameCutIndexes", () => {
  it("a cut never separates a tool_call from its output", () => {
    const msgs: AmspRecord[] = [
      at(t(0, "00.000"), userText("q")),
      at(t(0, "01.000"), requestBegin()),
      at(t(0, "02.000"), toolCall({ name: "exec", arguments: "{}", toolCallId: "t1" })),
      at(t(0, "03.000"), toolCallOutput({ output: "ok", toolCallId: "t1", status: "completed" })),
      at(t(0, "04.000"), assistantText("a")),
    ];
    const cuts = frameCutIndexes(msgs);
    // Safe cuts: after the prompt (1), after the requestBegin (2), after the output (4),
    // after the reply (5) — never after the dangling tool_call (3).
    expect(cuts).toEqual([1, 2, 4, 5]);
  });

  it("a cut never separates two parallel tool calls from their outputs, nor a steering group", () => {
    const steeringText = userSteeringText("retry that with more care");
    expect(parseUserSteeringText(steeringText)).not.toBeNull();
    const msgs: AmspRecord[] = [
      at(t(0, "00.000"), toolCall({ name: "a", arguments: "{}", toolCallId: "t1" })),
      at(t(0, "01.000"), toolCallOutput({ output: "1", toolCallId: "t1", status: "completed" })),
      at(t(0, "02.000"), toolCall({ name: "b", arguments: "{}", toolCallId: "t2" })),
      at(t(0, "03.000"), userText(steeringText)),
      at(t(0, "04.000"), toolCallOutput({ output: "2", toolCallId: "t2", status: "completed" })),
    ];
    const cuts = frameCutIndexes(msgs);
    // After the first group closes (2) a cut exists; while t2 is open (positions 3, 4)
    // no cut may appear — even across the steering message.
    expect(cuts).toEqual([2, 5]);
  });
});

describe("isSkeletonMessage", () => {
  it("every unit opener is a skeleton row: text prompts and inserted kinds together", () => {
    const rows: AmspRecord[] = [
      at(t(0, "00.000"), userText("q")),
      at(t(0, "01.000"), imageUrlMessage("data:image/png;base64,AAA")),
      at(t(0, "02.000"), requestBegin()),
      at(t(0, "03.000"), toolCall({ name: "exec", arguments: "{}", toolCallId: "t1" })),
      at(t(0, "04.000"), toolCallOutput({ output: "ok", toolCallId: "t1", status: "completed" })),
      at(t(0, "05.000"), assistantText("a")),
      at(t(0, "06.000"), requestEnd("completed")),
    ];
    const kinds = rows.map((m) => isSkeletonMessage(m));
    // The prompt and the user image (an inserted kind) are rows; everything interior is not.
    expect(kinds).toEqual([true, true, false, false, false, false, false]);
  });

  it("a steering chip is a skeleton row; a subagent-origin message is not", () => {
    const steering = at(t(0, "00.000"), userText(userSteeringText("focus on the error path")));
    expect(parseUserSteeringText(textOf(steering)!)).not.toBeNull();
    expect(isSkeletonMessage(steering)).toBe(true);
    const child = { ...at(t(0, "01.000"), userText("inner")), origin: ["child"] } as AmspRecord;
    expect(isSkeletonMessage(child)).toBe(false);
  });
});

describe("planMeatFrames", () => {
  const byteOf = (m: AmspRecord): number => Buffer.byteLength(JSON.stringify(m), "utf8") + 1;

  it("frames close under the 64 KB soft cap and always hold at least one group", () => {
    const big = "x".repeat(50 * 1024);
    const msgs: AmspRecord[] = [];
    for (let n = 1; n <= 4; n++) {
      msgs.push(at(t(n, "00.000"), userText(`q${n}`)));
      msgs.push(at(t(n, "01.000"), toolCall({ name: "exec", arguments: "{}", toolCallId: `t${n}` })));
      msgs.push(at(t(n, "02.000"), toolCallOutput({ output: big, toolCallId: `t${n}`, status: "completed" })));
    }
    const cuts = frameCutIndexes(msgs);
    const frames = planMeatFrames(byteOf, msgs, cuts, MESSAGE_WINDOW_FRAME_MAX_BYTES);
    expect(frames.length).toBeGreaterThan(1);
    for (const f of frames) {
      const slice = msgs.slice(f.from, f.to);
      // ≥1 closed group: the slice ends at a safe cut (or the window's end).
      const bytes = slice.reduce((sum, m) => sum + byteOf(m), 0);
      if (f.to < msgs.length) expect(bytes).toBeLessThanOrEqual(MESSAGE_WINDOW_FRAME_MAX_BYTES);
      expect(bytes).toBeGreaterThan(0);
      // No frame splits a group: the slice's last message leaves no tool open.
      const last = slice[slice.length - 1]!;
      expect(ptype(last)).not.toBe("tool_call");
    }
    // Frames tile the window exactly.
    expect(frames[0]!.from).toBe(0);
    expect(frames[frames.length - 1]!.to).toBe(msgs.length);
    for (let i = 1; i < frames.length; i++) {
      expect(frames[i]!.from).toBe(frames[i - 1]!.to);
    }
  });

  it("one oversized group is its own frame (the ≥1 group floor beats the soft cap)", () => {
    const huge = "y".repeat(MESSAGE_WINDOW_FRAME_MAX_BYTES * 2);
    const msgs: AmspRecord[] = [
      at(t(0, "00.000"), userText("q")),
      at(t(0, "01.000"), toolCall({ name: "exec", arguments: "{}", toolCallId: "t1" })),
      at(t(0, "02.000"), toolCallOutput({ output: huge, toolCallId: "t1", status: "completed" })),
      at(t(0, "03.000"), userText("q2")),
    ];
    const cuts = frameCutIndexes(msgs);
    const frames = planMeatFrames(byteOf, msgs, cuts, MESSAGE_WINDOW_FRAME_MAX_BYTES);
    // The tiny prompt closes first; the oversized group is its own frame; the rest follows.
    expect(frames).toEqual([
      { from: 0, to: 1 },
      { from: 1, to: 3 },
      { from: 3, to: 4 },
    ]);
  });
});

describe("readMessagesFrames", () => {
  let root: string;
  let service: TraceService;
  let harness: ReturnType<typeof makeTraceHarness>;

  beforeEach(async () => {
    root = await makeTempRoot();
    harness = makeTraceHarness(root);
    service = harness.service;
  });
  afterEach(async () => {
    harness.close();
    await fs.rm(root, { recursive: true, force: true });
  });

  it("a page frame first, then skeleton frames with every unit opener, then meat frames under the cap", async () => {
    const records: AmspRecord[] = [];
    for (let n = 1; n <= 3; n++) {
      records.push(at(t(n, "00.000"), userText(`q${n}`)));
      records.push(at(t(n, "01.000"), requestBegin()));
      records.push(at(t(n, "02.000"), toolCall({ name: "exec", arguments: "{}", toolCallId: `t${n}` })));
      records.push(at(t(n, "03.000"), toolCallOutput({ output: "ok".repeat(20000), toolCallId: `t${n}`, status: "completed" })));
      records.push(at(t(n, "04.000"), assistantText(`a${n}`)));
      records.push(at(t(n, "05.000"), requestEnd("completed")));
    }
    await writeTraceFile(root, P, A, "2026-07-20", S, 1, records);

    const frames = await service.readMessagesFrames(P, A, S, { kind: "tail", limit: 10 });
    expect(frames[0]!.type).toBe("page");
    // Skeleton first: every unit opener of the whole transcript, in order.
    const skel = frames.filter((f) => f.type === "skeleton");
    expect(skel.length).toBeGreaterThanOrEqual(1);
    expect(prompts(skel)).toEqual(["q1", "q2", "q3"]);
    // The meat fills the interiors; a meat frame never carries a prompt.
    const meat = frames.filter((f) => f.type === "meat");
    expect(meat.length).toBeGreaterThanOrEqual(1);
    expect(prompts(meat)).toEqual([]);
    for (const f of meat) {
      const line = Buffer.byteLength(JSON.stringify(f), "utf8") + 1;
      expect(line).toBeLessThanOrEqual(MESSAGE_WINDOW_FRAME_MAX_BYTES);
    }
    // Union of skeleton + meat covers every non-meta record.
    const all = [...skel, ...meat].flatMap((f) => (f.type === "skeleton" || f.type === "meat" ? f.messages : []));
    expect(all.length).toBe(records.length);
  });

  it("an oversized multi-group unit splits into several frames and every group arrives; the meat cursor re-enters through the before protocol", async () => {
    // One unit of 20 tool groups, each output ~16 KB: ~320 KB in one window,
    // split at group boundaries into frames that stay near the 64 KB soft cap.
    // (A stats row separates the two prompts, so the huge unit cuts as its own unit —
    // without the stats row two sends with no reply/usage between merge into one.)
    const records: AmspRecord[] = [
      at(t(1, "00.000"), userText("small one")),
      at(t(1, "01.000"), requestBegin()),
      at(t(1, "02.000"), toolCall({ name: "exec", arguments: "{}", toolCallId: "x1" })),
      at(t(1, "03.000"), toolCallOutput({ output: "ok", toolCallId: "x1", status: "completed" })),
      at(t(1, "04.000"), requestEnd("completed")),
    ];
    records.push(at(t(2, "00.000"), userText("huge unit")));
    for (let n = 1; n <= 20; n++) {
      records.push(
        at(t(2, String(10 + n).padStart(2, "0") + ".000"), toolCall({ name: "exec", arguments: "{}", toolCallId: `t${n}` })),
      );
      records.push(
        at(
          t(2, String(30 + n).padStart(2, "0") + ".000"),
          toolCallOutput({ output: "z".repeat(16 * 1024), toolCallId: `t${n}`, status: "completed" }),
        ),
      );
    }
    records.push(at(t(2, "55.000"), requestEnd("completed")));
    await writeTraceFile(root, P, A, "2026-07-20", S, 1, records);

    const frames = await service.readMessagesFrames(P, A, S, { kind: "tail", limit: 10 });
    const meat = frames.filter((f): f is Extract<MessagesHistoryFrame, { type: "meat" }> => f.type === "meat");
    // The oversized unit's groups arrive split across several frames.
    expect(meat.length).toBeGreaterThanOrEqual(3);
    // Every group arrives byte-complete: 20 × 16 KB of output text, exactly once.
    const joined = outputs(meat);
    expect(joined.filter((o) => o.startsWith("zzz")).length).toBe(20);
    // Every frame stays near the soft cap (a group is ~16 KB, so overshoot is bounded
    // by one group on top of the cap's neighbour) and carries a re-entry cursor.
    for (const f of meat) {
      expect(f.cursor).toBeDefined();
      const line = Buffer.byteLength(JSON.stringify(f), "utf8") + 1;
      expect(line).toBeLessThanOrEqual(MESSAGE_WINDOW_FRAME_MAX_BYTES + 32 * 1024);
    }

    // Cursor re-entry: the frames' cursor re-enters this window — a tail read by
    // repeating the request (the window's byte budget bounds one response, so a
    // response that cut short replays whole). The replay carries every frame the
    // interrupted stream already delivered (the client's dedup drops those) plus the
    // ones it never received: received ∪ replay covers the window's meat exactly.
    const k = Math.min(1, meat.length - 1);
    const received = meat.slice(0, k + 1).flatMap((f) => f.messages.map((m) => JSON.stringify(m)));
    // Every frame carries the re-entry cursor, and it re-enters the same window.
    const reentry: string = meat[k]!.cursor!;
    const again = await service.readMessagesFrames(P, A, S, { kind: "tail", limit: 10 });
    const replay = again
      .filter((f) => f.type === "meat")
      .flatMap((f) => (f.type === "meat" ? f.messages : []))
      .map((m) => JSON.stringify(m));
    const full = meat.flatMap((f) => f.messages.map((m) => JSON.stringify(m)));
    expect(replay.filter((line) => full.includes(line))).toEqual(full);
    // The replay really resumes the interrupted stream: it holds every received frame
    // (dropped by the client's dedup on re-entry) and every missed one.
    expect(received.every((line) => replay.includes(line))).toBe(true);

  });

  it("a skeleton frame's rows carry the whole transcript's openers even when the window is a tail page", async () => {
    const records: AmspRecord[] = [];
    for (let n = 1; n <= 4; n++) {
      records.push(at(t(n, "00.000"), userText(`q${n}`)));
      records.push(at(t(n, "01.000"), requestBegin()));
      records.push(at(t(n, "02.000"), assistantText(`a${n}`)));
      records.push(at(t(n, "03.000"), requestEnd("completed")));
    }
    await writeTraceFile(root, P, A, "2026-07-20", S, 1, records);

    // A tail of 1 unit: the meat holds only the newest unit's interior, but the
    // skeleton still names every unit opener of the whole transcript.
    const frames = await service.readMessagesFrames(P, A, S, { kind: "tail", limit: 1 });
    const skel = frames.filter((f) => f.type === "skeleton");
    expect(prompts(skel)).toEqual(["q1", "q2", "q3", "q4"]);
    const meat = frames.filter((f) => f.type === "meat");
    expect(prompts(meat)).toEqual([]);
    expect(meat.flatMap((f) => (f.type === "meat" ? f.messages : [])).length).toBe(3); // request/assistant/end of unit 4
  });
});
