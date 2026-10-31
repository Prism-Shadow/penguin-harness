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
import type { OmniMessage } from "@prismshadow/penguin-core";
import { userSteeringText } from "@prismshadow/penguin-core/markers";

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

function at(ts: string, msg: OmniMessage): OmniMessage {
  return { ...msg, timestamp: ts };
}

const t = (mm: number, s: string) =>
  `2026-07-20T10:${String(mm).padStart(2, "0")}:${s}Z`;

const ptype = (m: OmniMessage): string =>
  (m.payload as { type?: string }).type ?? "";

const textOf = (m: OmniMessage): string | undefined =>
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
    const msgs: OmniMessage[] = [
      at(t(0, "00.000"), userText("q")),
      at(t(0, "01.000"), requestBegin()),
      at(t(0, "02.000"), toolCall({ name: "exec", arguments: "{}", toolCallId: "t1" })),
      at(t(0, "03.000"), toolCallOutput({ output: "ok", toolCallId: "t1" })),
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
    const msgs: OmniMessage[] = [
      at(t(0, "00.000"), toolCall({ name: "a", arguments: "{}", toolCallId: "t1" })),
      at(t(0, "01.000"), toolCallOutput({ output: "1", toolCallId: "t1" })),
      at(t(0, "02.000"), toolCall({ name: "b", arguments: "{}", toolCallId: "t2" })),
      at(t(0, "03.000"), userText(steeringText)),
      at(t(0, "04.000"), toolCallOutput({ output: "2", toolCallId: "t2" })),
    ];
    const cuts = frameCutIndexes(msgs);
    // After the first group closes (2) a cut exists; while t2 is open (positions 3, 4)
    // no cut may appear — even across the steering message.
    expect(cuts).toEqual([2, 5]);
  });
});

describe("isSkeletonMessage", () => {
  it("every unit opener is a skeleton row: text prompts and inserted kinds together", () => {
    const rows: OmniMessage[] = [
      at(t(0, "00.000"), userText("q")),
      at(t(0, "01.000"), imageUrlMessage("data:image/png;base64,AAA")),
      at(t(0, "02.000"), requestBegin()),
      at(t(0, "03.000"), toolCall({ name: "exec", arguments: "{}", toolCallId: "t1" })),
      at(t(0, "04.000"), toolCallOutput({ output: "ok", toolCallId: "t1" })),
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
    const child = { ...at(t(0, "01.000"), userText("inner")), origin: ["child"] } as OmniMessage;
    expect(isSkeletonMessage(child)).toBe(false);
  });
});

describe("planMeatFrames", () => {
  const byteOf = (m: OmniMessage): number => Buffer.byteLength(JSON.stringify(m), "utf8") + 1;

  it("frames close under the 64 KB soft cap and always hold at least one group", () => {
    const big = "x".repeat(50 * 1024);
    const msgs: OmniMessage[] = [];
    for (let n = 1; n <= 4; n++) {
      msgs.push(at(t(n, "00.000"), userText(`q${n}`)));
      msgs.push(at(t(n, "01.000"), toolCall({ name: "exec", arguments: "{}", toolCallId: `t${n}` })));
      msgs.push(at(t(n, "02.000"), toolCallOutput({ output: big, toolCallId: `t${n}` })));
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
    const msgs: OmniMessage[] = [
      at(t(0, "00.000"), userText("q")),
      at(t(0, "01.000"), toolCall({ name: "exec", arguments: "{}", toolCallId: "t1" })),
      at(t(0, "02.000"), toolCallOutput({ output: huge, toolCallId: "t1" })),
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

  it("a page frame first, then the window's stream with each unit's opener before its interior, under the cap", async () => {
    const records: OmniMessage[] = [];
    for (let n = 1; n <= 3; n++) {
      records.push(at(t(n, "00.000"), userText(`q${n}`)));
      records.push(at(t(n, "01.000"), requestBegin()));
      records.push(at(t(n, "02.000"), toolCall({ name: "exec", arguments: "{}", toolCallId: `t${n}` })));
      records.push(at(t(n, "03.000"), toolCallOutput({ output: "ok".repeat(20000), toolCallId: `t${n}` })));
      records.push(at(t(n, "04.000"), assistantText(`a${n}`)));
      records.push(at(t(n, "05.000"), requestEnd("completed")));
    }
    await writeTraceFile(root, P, A, "2026-07-20", S, 1, records);

    const frames = await service.readMessagesFrames(P, A, S, { kind: "tail", limit: 10 });
    expect(frames[0]!.type).toBe("page");
    // A tail read of the whole (short) transcript: no openers precede the window.
    const skel = frames.filter((f) => f.type === "skeleton");
    expect(prompts(skel)).toEqual([]);
    // The stream frames carry opener + interior INTERLEAVED in trace order: the flat
    // message order across meat frames is exactly the transcript's own order.
    const meat = frames.filter((f) => f.type === "meat");
    expect(meat.length).toBeGreaterThanOrEqual(1);
    expect(prompts(meat)).toEqual(["q1", "q2", "q3"]);
    const flat = meat.flatMap((f) => (f.type === "meat" ? f.messages : []));
    expect(flat.map((m) => (m as { tracePosition?: { ordinal: number } }).tracePosition!.ordinal)).toEqual(
      flat
        .map((m) => (m as { tracePosition?: { ordinal: number } }).tracePosition!.ordinal)
        .slice()
        .sort((a, b) => a - b),
    );
    for (const f of meat) {
      const line = Buffer.byteLength(JSON.stringify(f), "utf8") + 1;
      expect(line).toBeLessThanOrEqual(MESSAGE_WINDOW_FRAME_MAX_BYTES);
    }
    // Meat covers every record.
    expect(flat.length).toBe(records.length);
  });

  it("an oversized multi-group unit splits into several frames and every group arrives; the meat cursor re-enters through the before protocol", async () => {
    // One unit of 20 tool groups, each output ~16 KB: ~320 KB in one window,
    // split at group boundaries into frames that stay near the 64 KB soft cap.
    // (A stats row separates the two prompts, so the huge unit cuts as its own unit —
    // without the stats row two sends with no reply/usage between merge into one.)
    const records: OmniMessage[] = [
      at(t(1, "00.000"), userText("small one")),
      at(t(1, "01.000"), requestBegin()),
      at(t(1, "02.000"), toolCall({ name: "exec", arguments: "{}", toolCallId: "x1" })),
      at(t(1, "03.000"), toolCallOutput({ output: "ok", toolCallId: "x1" })),
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
          toolCallOutput({ output: "z".repeat(16 * 1024), toolCallId: `t${n}` }),
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

  it("openers of units older than the window ride the leading skeleton frames; the window's own openers stay interleaved in its stream", async () => {
    const records: OmniMessage[] = [];
    for (let n = 1; n <= 4; n++) {
      records.push(at(t(n, "00.000"), userText(`q${n}`)));
      records.push(at(t(n, "01.000"), requestBegin()));
      records.push(at(t(n, "02.000"), assistantText(`a${n}`)));
      records.push(at(t(n, "03.000"), requestEnd("completed")));
    }
    await writeTraceFile(root, P, A, "2026-07-20", S, 1, records);

    // A tail of 1 unit: the stream holds only the newest unit (its opener interleaved
    // with its interior); the three older units' openers ride the leading skeleton
    // frames — rows a page boundary would otherwise hide.
    const frames = await service.readMessagesFrames(P, A, S, { kind: "tail", limit: 1 });
    const skel = frames.filter((f) => f.type === "skeleton");
    expect(prompts(skel)).toEqual(["q1", "q2", "q3"]);
    const meat = frames.filter((f) => f.type === "meat");
    expect(prompts(meat)).toEqual(["q4"]);
    expect(meat.flatMap((f) => (f.type === "meat" ? f.messages : [])).length).toBe(4); // opener+request/assistant/end of unit 4
  });

  it("REGRESSION (2026-10-31 53531 mis-ordering): the flat stream order is the transcript order — an older unit's tool work never lands after a newer unit's prompt", async () => {
    const records: OmniMessage[] = [];
    for (let n = 1; n <= 6; n++) {
      records.push(at(t(n, "00.000"), userText(`q${n}`)));
      records.push(at(t(n, "01.000"), requestBegin()));
      records.push(at(t(n, "02.000"), toolCall({ name: "exec", arguments: "{}", toolCallId: `t${n}` })));
      records.push(at(t(n, "03.000"), toolCallOutput({ output: "done", toolCallId: `t${n}` })));
      records.push(at(t(n, "04.000"), assistantText(`a${n}`)));
      records.push(at(t(n, "05.000"), requestEnd("completed")));
    }
    await writeTraceFile(root, P, A, "2026-07-20", S, 1, records);

    // The exact first-load shape of the reported defect: a tail of 2 units over 6.
    const frames = await service.readMessagesFrames(P, A, S, { kind: "tail", limit: 2 });
    // The order a consumer that appends as frames land produces — openers first, then
    // the window's stream — must be the transcript order itself.
    const flat = frames
      .filter((f) => f.type === "skeleton" || f.type === "meat")
      .flatMap((f) => (f.type === "skeleton" || f.type === "meat" ? f.messages : []));
    const positions = flat.map((m) => (m as { tracePosition?: { fileIndex: number; ordinal: number } }).tracePosition!);
    const sorted = positions.slice().sort((a, b) => (a.fileIndex !== b.fileIndex ? a.fileIndex - b.fileIndex : a.ordinal - b.ordinal));
    expect(positions).toEqual(sorted);
    // And the user-visible row order: every prompt precedes its own unit's tool work.
    const seq = flat.map((m) =>
      m.type === "model_msg"
        ? ptype(m) === "text" && (m.payload as { role?: string }).role === "user"
          ? `q${textOf(m)![1]}`
          : ptype(m) === "tool_call"
            ? "tool"
            : ptype(m) === "tool_call_output"
              ? "out"
              : "a"
        : "meta",
    );
    // The leading skeleton rows (units older than the window) precede the window's
    // stream; with the byte budget covering all six small units the window starts at
    // the beginning and every unit rides its own stream. Either way the FLAT order is
    // the transcript order — that is the invariant the defect broke.
    expect(seq[0]).toBe("q1");
    const lastQ = seq.lastIndexOf("q6");
    expect(seq.slice(lastQ)).toEqual(["q6", "meta", "tool", "out", "a", "meta"]);
    // No unit's interior may appear after a LATER unit's prompt: walk the sequence —
    // between any two prompts, only the earlier unit's interior may appear.
    let seen = 0;
    for (const kind of seq) {
      if (kind.startsWith("q")) {
        const n = Number(kind[1]);
        expect(n).toBe(seen + 1);
        seen = n;
      }
    }
  });
});
