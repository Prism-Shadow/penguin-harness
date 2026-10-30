/**
 * Frame-protocol unit tests: the pure pieces of the streamed history read
 * (TraceService.readMessagesFrames + GET /messages/frames).
 *
 * Covers:
 * - frameCutIndexes: a cut never separates a tool_call from its tool_call_output, a
 *   steering chip from its trailing image, or lands inside a compaction span.
 * - planMeatFrames: the 64 KB soft cap (a frame stops before the group that would
 *   pass it), the ≥1 group floor (a single oversized group is its own frame and may
 *   exceed the cap), and whole-group frames tiling the window exactly.
 * - readMessagesFrames (service level): the skeleton carries every unit opener —
 *   plain text prompts AND the inserted kinds (steering chip, context summary,
 *   in-task background notice) — before any meat frame, meat frames carry the
 *   window's interiors at group boundaries, and the page frame leads with the
 *   windowed-read envelope (cursor re-entry through the ordinary before protocol:
 *   re-entering at a meat frame's cursor reproduces the frames the interruption
 *   cut, deduped by the consumer).
 * - The 563 KB single unit (74-turn tool chain, no intermediate user text, uncuttable)
 *   splits into multiple frames, each ≥1 group, all groups delivered.
 */
import fs from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assistantText,
  compactionBegin,
  compactionEnd,
  imageUrlMessage,
  requestBegin,
  requestEnd,
  sessionMeta,
  tokenUsage,
  toolCall,
  toolCallOutput,
  userText,
} from "@prismshadow/penguin-core";
import { buildBackgroundTaskDoneMessage } from "@prismshadow/amsp/markers";
import type { AmspRecord, SessionMetaPayload, TokenCounts } from "@prismshadow/penguin-core";
import { decodeCursor } from "../src/services/message-window.js";
import { MESSAGES_PAGE_MAX_BYTES } from "../src/services/trace-service.js";
import { makeTempRoot, makeTraceHarness, writeTraceFile } from "./helpers.js";

const P = "project-f";
const A = "agent-f";
const S = "session-2026-07-21-10-00-00-bbbb0001";

function at(ts: string, msg: AmspRecord): AmspRecord {
  return { ...msg, timestamp: ts };
}

function counts(total: number): TokenCounts {
  return { cache_read: 0, cache_write: 0, output: total, total };
}

function metaPayload(over: Partial<SessionMetaPayload> = {}): SessionMetaPayload {
  return {
    session_id: S,
    model_id: "m1",
    provider: "custom",
    model_context_window: 1000,
    system_prompt: "sp",
    agent_state: "/tmp/a",
    workspace: "/tmp/w",
    source: "user",
    ...over,
  };
}

const typeOf = (m: AmspRecord): string => (m.payload as { type?: string }).type ?? m.type;
const textOf = (m: AmspRecord): string => String((m.payload as { text?: string }).text ?? "");

describe("frame cut points", () => {
  it("a cut never separates a tool_call from its output, a steering chip from its image, or lands inside a compaction span", async () => {
    const { frameCutIndexes, planMeatFrames } = await import("../src/services/message-window.js");
    const messages: AmspRecord[] = [
      at("2026-07-21T10:00:00.000Z", userText("q1")),
      at("2026-07-21T10:00:01.000Z", requestBegin()),
      at("2026-07-21T10:00:02.000Z", toolCall({ name: "exec", arguments: "{}", toolCallId: "t1" })),
      at("2026-07-21T10:00:03.000Z", requestEnd("completed")),
      at(
        "2026-07-21T10:00:04.000Z",
        toolCallOutput({ output: "out", toolCallId: "t1", status: "completed" }),
      ),
      at("2026-07-21T10:00:05.000Z", userText("[user_steering]\nfaster\n[/user_steering]")),
      at(
        "2026-07-21T10:00:05.100Z",
        imageUrlMessage(`data:image/png;base64,${"A".repeat(64)}`),
      ),
      at(
        "2026-07-21T10:00:06.000Z",
        compactionBegin({ reason: "context", mode: "summarize", context: 900, turns: 2 }),
      ),
      at("2026-07-21T10:00:07.000Z", assistantText("[summary]s[/summary]")),
      at(
        "2026-07-21T10:00:08.000Z",
        compactionEnd({ reason: "context", mode: "summarize", status: "completed" }),
      ),
      at("2026-07-21T10:00:09.000Z", assistantText("a1")),
    ];
    const cuts = frameCutIndexes(messages);
    // Reconstruct where each planned frame may close and assert the invariants on the
    // frames the planner actually produces from these cuts.
    const frames = planMeatFrames(
      (m) => textOf(m).length,
      messages,
      cuts,
      1_000_000, // no byte pressure: every safe cut closes a frame
    );
    // The planner's frames tile the window exactly and each boundary is a safe cut.
    const tiled: AmspRecord[] = [];
    for (const { from, to } of frames) {
      expect(cuts).toContain(to); // every planned close is a safe cut
      tiled.push(...messages.slice(from, to));
    }
    expect(tiled).toEqual(messages);
    // Direct invariant: no cut index sits between t1's call (2) and its output (4), inside
    // the steering pair (5,6), or inside the compaction span (6..9).
    for (const cut of cuts) {
      const kinds = messages.slice(Math.max(0, cut - 2), cut + 1).map(typeOf);
      expect(kinds).not.toHaveLength(0);
    }
    for (const cut of cuts) {
      // A cut after the tool_call (index 2 → cut 3) must not exist before its output lands.
      if (cut === 3) throw new Error("cut between tool_call and its output");
      // A cut after the steering chip (index 5 → cut 6) must not exist before its image.
      if (cut === 6 || cut === 7) throw new Error("cut between the steering chip and its image");
      // No cut strictly inside the compaction span (begin at index 7, end at 9): cuts 8, 9.
      if (cut === 8 || cut === 9) throw new Error("cut inside a compaction span");
    }
  });
});

describe("meat frame planning", () => {
  it("the 64 KB soft cap stops a frame before the group that would pass it; every frame holds at least one group", async () => {
    const { frameCutIndexes, planMeatFrames } = await import("../src/services/message-window.js");
    // Six complete tool groups (call+output), each ~10 KB; the cap lets three per frame.
    const group = (n: number): AmspRecord[] => [
      at(`2026-07-21T10:00:0${n}.000Z`, toolCall({ name: "exec", arguments: "x".repeat(10_000), toolCallId: `t${n}` })),
      at(
        `2026-07-21T10:00:0${n}.100Z`,
        toolCallOutput({ output: "y".repeat(100), toolCallId: `t${n}`, status: "completed" }),
      ),
    ];
    const messages: AmspRecord[] = [
      ...group(1),
      ...group(2),
      ...group(3),
      ...group(4),
      ...group(5),
      ...group(6),
    ];
    const cuts = frameCutIndexes(messages);
    const frames = planMeatFrames(
      (m) => (typeOf(m) === "tool_call" ? 10_000 : 100),
      messages,
      cuts,
      30_000,
    );
    // Each group ≈10.1 KB, so three groups (30.3 KB) pass the 30 KB cap: two groups
    // per frame, cut only at a group's end (after each tool_call_output).
    expect(frames).toEqual([
      { from: 0, to: 4 },
      { from: 4, to: 8 },
      { from: 8, to: 12 },
    ]);
    expect(cuts).toContain(4);
    expect(cuts).toContain(8);
    expect(cuts).toContain(12);
  });

  it("a single oversized group is its own frame and may exceed the cap; the window still tiles exactly", async () => {
    const { frameCutIndexes, planMeatFrames } = await import("../src/services/message-window.js");
    // One group of 50 KB then one of 60 KB — each its own frame under a 64 KB cap that
    // neither pair fits in, both under a floor that forbids an empty frame.
    const messages: AmspRecord[] = [
      at("2026-07-21T10:00:00.000Z", toolCall({ name: "exec", arguments: "a".repeat(50_000), toolCallId: "t1" })),
      at(
        "2026-07-21T10:00:01.000Z",
        toolCallOutput({ output: "b".repeat(100), toolCallId: "t1", status: "completed" }),
      ),
      at("2026-07-21T10:00:02.000Z", toolCall({ name: "exec", arguments: "c".repeat(60_000), toolCallId: "t2" })),
      at(
        "2026-07-21T10:00:03.000Z",
        toolCallOutput({ output: "d".repeat(100), toolCallId: "t2", status: "completed" }),
      ),
    ];
    const cuts = frameCutIndexes(messages);
    const frames = planMeatFrames((m) => typeOf(m) === "tool_call" ? ((m.payload as { arguments?: string }).arguments?.length ?? 0) : 100, messages, cuts, 64_000);
    expect(frames).toEqual([
      { from: 0, to: 2 },
      { from: 2, to: 4 },
    ]);
  });
});

describe("readMessagesFrames (service level)", () => {
  let root: string;
  let service: ReturnType<typeof makeTraceHarness>["service"];
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

  /** One complete turn (prompt → request → reply → usage). */
  function turn(mm: number, n: number): AmspRecord[] {
    const t = (s: string) => `2026-07-21T10:${String(mm).padStart(2, "0")}:${s}Z`;
    return [
      at(t("00.000"), userText(`q${n}`)),
      at(t("01.000"), requestBegin()),
      at(t("02.000"), assistantText(`a${n}`)),
      at(t("03.000"), requestEnd("completed")),
      at(t("03.500"), tokenUsage(counts(1000 * n), counts(100 + n))),
    ];
  }

  it("the skeleton carries every unit opener (text prompts AND inserted kinds) before any meat; the window's meat fills at group boundaries", async () => {
    const steered = buildBackgroundTaskDoneMessage(
      { kind: "command", id: "proc-1", status: "completed", detail: "exit 0", delivery: "steering" },
      "Background command finished",
    );
    await writeTraceFile(root, P, A, "2026-07-21", S, 1, [
      sessionMeta(metaPayload()),
      ...turn(0, 1),
      // Turn 2: a steering chip mid-unit, a context summary, and a steered notice.
      at("2026-07-21T10:01:00.000Z", userText("q2")),
      at("2026-07-21T10:01:01.000Z", userText("[user_steering]\nfaster\n[/user_steering]")),
      at("2026-07-21T10:01:02.000Z", userText("[context_summary]\ns\n[/context_summary]")),
      at("2026-07-21T10:01:03.000Z", userText(steered, "harness")),
      at("2026-07-21T10:01:04.000Z", requestBegin()),
      at("2026-07-21T10:01:05.000Z", assistantText("a2")),
      at("2026-07-21T10:01:06.000Z", requestEnd("completed")),
      at("2026-07-21T10:01:06.500Z", tokenUsage(counts(2000), counts(200))),
      ...turn(2, 3),
    ]);

    const frames = await service.readMessagesFrames(P, A, S, { kind: "tail", limit: 2 });
    expect(frames[0]?.type).toBe("page");
    const skeleton = frames.filter((f) => f.type === "skeleton");
    const meat = frames.filter((f) => f.type === "meat");
    // The skeleton precedes every meat frame.
    const skeletonAt = frames.indexOf(skeleton[0]!);
    const firstMeatAt = frames.findIndex((f) => f.type === "meat");
    expect(firstMeatAt).toBeGreaterThan(skeletonAt);

    // Skeleton = all unit openers, in transcript order: q1, q2, the steering chip, the
    // context summary, the steered notice, q3 — the whole transcript's rows, not just
    // the window's.
    const skeletonTexts = skeleton.flatMap((f) => f.messages.map(textOf));
    expect(skeletonTexts).toEqual([
      "q1",
      "q2",
      "[user_steering]\nfaster\n[/user_steering]",
      "[context_summary]\ns\n[/context_summary]",
      steered,
      "q3",
    ]);
    // Every user-text row the full read carries sits in the skeleton in the same order
    // (assistant replies are the units' meat, never skeleton rows).
    const full = await service.readMessages(P, A, S);
    const fullUserRows = full
      .filter(
        (m) =>
          m.type === "model_msg" &&
          (m.payload as { type?: string; role?: string }).type === "text" &&
          (m.payload as { role?: string }).role === "user",
      )
      .map(textOf);
    expect(fullUserRows).toEqual(skeletonTexts);

    // Meat = the window's interiors: no skeleton text reappears there (q3's interior
    // carries no rows the skeleton already placed).
    const meatTexts = meat.flatMap((f) => f.messages.map(textOf));
    for (const row of skeletonTexts) expect(meatTexts).not.toContain(row);
    // Every meat frame carries a re-entry cursor.
    for (const f of meat) expect(decodeCursor((f as { cursor: string }).cursor)).not.toBeNull();
    // The page frame leads with the envelope, cursor included.
    const page = frames[0]!;
    if (page.type !== "page") throw new Error("first frame is not the page envelope");
    expect(page.before).toBeDefined();
  });

  it("cursor re-entry: the frames from a resumed read tile the transcript exactly like the uninterrupted sequence", async () => {
    await writeTraceFile(root, P, A, "2026-07-21", S, 1, [
      sessionMeta(metaPayload()),
      ...turn(0, 1),
      ...turn(1, 2),
      ...turn(2, 3),
      ...turn(3, 4),
    ]);
    const whole = await service.readMessagesFrames(P, A, S, { kind: "tail", limit: 4 });
    const wholeMeat = whole.filter((f) => f.type === "meat");
    expect(wholeMeat.length).toBeGreaterThan(0);
    // Interrupt after the FIRST meat frame: re-enter at its cursor (the ordinary before
    // protocol) and take a full window.
    const interrupted = wholeMeat[0] as Extract<(typeof wholeMeat)[number], { type: "meat" }>;
    const resumed = await service.readMessagesFrames(P, A, S, {
      kind: "before",
      cursor: decodeCursor(interrupted.cursor as string) ?? { fileIndex: 1, ordinal: 0 },
      limit: 10,
    });
    const resumedMeat = resumed.filter((f) => f.type === "meat");
    // The resumed sequence's meat covers everything the interrupted stream still owed:
    // concatenating uninterrupted-meat minus the first frame equals the resumed meat.
    const owed = wholeMeat.slice(1).flatMap((f) => f.messages);
    const got = resumedMeat.flatMap((f) => f.messages);
    expect(got).toEqual(owed);
    // And the two reads' skeletons agree (the skeleton is the re-entry's replayable head).
    const wholeSkeleton = whole.filter((f) => f.type === "skeleton").flatMap((f) => f.messages);
    const resumedSkeleton = resumed
      .filter((f) => f.type === "skeleton")
      .flatMap((f) => f.messages);
    expect(resumedSkeleton).toEqual(wholeSkeleton);
  });

  it("a 563 KB single unit (uncuttable tool chain, no intermediate user text) splits into multiple frames, each ≥1 group, all groups delivered", async () => {
    // One unit: user prompt, then 74 rounds of (tool_call → output), each pair ~7.6 KB,
    // ~563 KB total — no assistant text between rounds, so no safe cut inside a pair.
    const messages: AmspRecord[] = [at("2026-07-21T10:00:00.000Z", userText("heavy"))];
    for (let n = 1; n <= 74; n++) {
      messages.push(
        at(
          `2026-07-21T10:01:${String(n % 60).padStart(2, "0")}.000Z`,
          toolCall({
            name: "exec",
            arguments: JSON.stringify({ cmd: `step ${n}`, data: "x".repeat(7_000) }),
            toolCallId: `t${n}`,
          }),
        ),
      );
      messages.push(
        at(
          `2026-07-21T10:02:${String(n % 60).padStart(2, "0")}.000Z`,
          toolCallOutput({
            output: `out ${n} ${"y".repeat(500)}`,
            toolCallId: `t${n}`,
            status: "completed",
          }),
        ),
      );
    }
    await writeTraceFile(root, P, A, "2026-07-21", S, 1, [sessionMeta(metaPayload()), ...messages]);

    const frames = await service.readMessagesFrames(P, A, S, { kind: "tail", limit: 1 });
    const meat = frames.filter((f) => f.type === "meat");
    expect(meat.length).toBeGreaterThan(1);
    // Every meat frame holds whole groups: no frame ENDS between a tool_call and its
    // output (the last message of every frame but the final one is a tool_call_output).
    for (const f of meat) {
      if (f !== meat[meat.length - 1]) {
        expect(typeOf(f.messages[f.messages.length - 1]!)).toBe("tool_call_output");
      }
      expect(f.messages.length).toBeGreaterThan(0); // ≥1 group (or the tail's remainder)
    }
    // Serialized sizes: soft cap respected except where a single oversized group
    // (the first frame carries the prompt plus its first groups) forces one over.
    const sizes = meat.map((f) =>
      f.messages.reduce((sum, m) => sum + Buffer.byteLength(JSON.stringify(m), "utf8") + 1, 0),
    );
    for (const size of sizes) expect(size).toBeLessThan(2 * 64 * 1024); // no runaway frame
    // All 74 tool groups arrive exactly once.
    const calls = meat.flatMap((f) => f.messages).filter((m) => typeOf(m) === "tool_call");
    expect(calls.length).toBe(74);
    const outputs = meat.flatMap((f) => f.messages).filter((m) => typeOf(m) === "tool_call_output");
    expect(outputs.length).toBe(74);
    // The full read agrees: every windowed frame's union equals the transcript's window.
    const full = await service.readMessages(P, A, S);
    expect(meat.flatMap((f) => f.messages).length).toBe(full.length - 1); // minus the prompt row
  });

  it("the transcript byte budget still bounds one frames response: the window cut short carries its before cursor", async () => {
    // Two heavy turns, each over MESSAGES_PAGE_MAX_BYTES / 2 in tool outputs.
    const heavy = (mm: number, n: number): AmspRecord[] => {
      const t = (s: string) => `2026-07-21T10:${String(mm).padStart(2, "0")}:${s}Z`;
      return [
        at(t("00.000"), userText(`q${n}`)),
        at(t("01.000"), toolCall({ name: "exec", arguments: "{}", toolCallId: `t${n}` })),
        at(
          t("02.000"),
          toolCallOutput({
            output: "z".repeat(MESSAGES_PAGE_MAX_BYTES / 2),
            toolCallId: `t${n}`,
            status: "completed",
          }),
        ),
      ];
    };
    await writeTraceFile(root, P, A, "2026-07-21", S, 1, [
      sessionMeta(metaPayload()),
      ...heavy(0, 1),
      ...heavy(1, 2),
    ]);
    const frames = await service.readMessagesFrames(P, A, S, { kind: "tail", limit: 4 });
    const page = frames[0]!;
    if (page.type !== "page") throw new Error("first frame is not the page envelope");
    // The budget cut the window to the newest unit alone (turn 2's prompt starts at
    // ordinal 4: meta + turn 1's three records); its cursor re-enters there.
    expect(decodeCursor(page.before!)).toEqual({ fileIndex: 1, ordinal: 4 });
    const meat = frames.filter((f) => f.type === "meat").flatMap((f) => f.messages);
    expect(meat.some((m) => textOf(m) === "q2")).toBe(false); // q2 is a skeleton row
    expect(meat.some((m) => typeOf(m) === "tool_call_output" && textOf(m).includes("out 2"))).toBe(false);
  });
});
