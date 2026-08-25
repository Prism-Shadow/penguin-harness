/**
 * Windowed history reads (TraceService.readMessagesPage + GET /messages paging params).
 *
 * Covers: tail/before window slicing mid-shard and across shard boundaries, cursor
 * round-trips, pairing-safe cut points (a window never separates a tool_call from its
 * output, a compaction span, or a steering group), subagent expansion happening only
 * for pointers inside the window, outline-turn counting (`earlierTurns`) staying in
 * step with the Web's buildOutline rule (its twin fixtures live in
 * web/test/outline-model.test.ts and stream-model.test.ts — keep the two sides
 * agreeing), prior stats (elapsed / subagent tokens / session tokens / context), the
 * shard-read discipline (an old-window request never reads the newest shard and vice
 * versa, once the per-shard prefix cache is primed), and the no-params full read
 * staying byte-identical with no `page` envelope.
 */
import fs from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  abortEvent,
  assistantText,
  compactionBegin,
  compactionEnd,
  imageUrlMessage,
  requestBegin,
  requestEnd,
  sessionMeta,
  subagentEvent,
  tokenUsage,
  toolCall,
  toolCallOutput,
  userText,
} from "@prismshadow/penguin-core";
import {
  buildBackgroundTaskDoneMessage,
  buildHandoffMessage,
} from "@prismshadow/penguin-core/markers";
import type { OmniMessage, SessionMetaPayload, TokenCounts } from "@prismshadow/penguin-core";
import { decodeCursor, encodeCursor } from "../src/services/message-window.js";
import type { TraceService } from "../src/services/trace-service.js";
import { makeTempRoot, makeTraceHarness, writeTraceFile } from "./helpers.js";

const P = "project-w";
const A = "agent-w";
const S = "session-2026-07-20-10-00-00-aabb0001";
const CHILD = "session-2026-07-20-10-00-05-ccdd0002";

function at(ts: string, msg: OmniMessage): OmniMessage {
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
    ...over,
  };
}

/** One complete turn (prompt → request → reply → usage), 4 messages, spaced inside one minute `mm`. */
function turn(mm: number, n: number, sessionTotal: number): OmniMessage[] {
  const t = (s: string) => `2026-07-20T10:${String(mm).padStart(2, "0")}:${s}Z`;
  return [
    at(t("00.000"), userText(`q${n}`)),
    at(t("01.000"), requestBegin()),
    at(t("02.000"), assistantText(`a${n}`)),
    at(t("03.000"), requestEnd("completed")),
    at(t("03.500"), tokenUsage(counts(sessionTotal), counts(100 + n))),
  ];
}

const textOf = (m: OmniMessage): string | undefined => (m.payload as { text?: string }).text;
const userTexts = (ms: OmniMessage[]): string[] =>
  ms
    .filter(
      (m) =>
        m.type === "model_msg" &&
        (m.payload as { type?: string; role?: string }).type === "text" &&
        (m.payload as { role?: string }).role === "user",
    )
    .map((m) => textOf(m)!);

describe("messages windowed reads", () => {
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

  it("tail mid-shard: newest N units, before cursor round-trips to the previous window, beginning ends the chain", async () => {
    await writeTraceFile(root, P, A, "2026-07-20", S, 1, [
      sessionMeta(metaPayload()),
      ...turn(0, 1, 1000),
      ...turn(1, 2, 2000),
      ...turn(2, 3, 3000),
      ...turn(3, 4, 4000),
    ]);

    const tail = await service.readMessagesPage(P, A, S, { kind: "tail", limit: 2 });
    expect(userTexts(tail.messages)).toEqual(["q3", "q4"]);
    expect(tail.messages.some((m) => m.type === "session_meta")).toBe(false);
    expect(tail.before).toBeDefined();
    expect(tail.prior.turns).toBe(2);
    // The cursor names the window's first unit: shard 1, ordinal of q3 (meta + 2×5 turns).
    expect(decodeCursor(tail.before!)).toEqual({ fileIndex: 1, ordinal: 11 });

    const mid = await service.readMessagesPage(P, A, S, {
      kind: "before",
      cursor: decodeCursor(tail.before!)!,
      limit: 1,
    });
    expect(userTexts(mid.messages)).toEqual(["q2"]);
    expect(mid.prior.turns).toBe(1);
    expect(mid.before).toBeDefined();

    // The oldest window absorbs the preamble (session_meta) and carries no cursor.
    const first = await service.readMessagesPage(P, A, S, {
      kind: "before",
      cursor: decodeCursor(mid.before!)!,
      limit: 5,
    });
    expect(userTexts(first.messages)).toEqual(["q1"]);
    expect(first.messages[0]!.type).toBe("session_meta");
    expect(first.before).toBeUndefined();
    expect(first.prior).toEqual({
      turns: 0,
      subagentTokens: 0,
      elapsedMs: 0,
      sessionTokens: 0,
      contextTokens: 0,
    });

    // Windows tile the transcript exactly: concatenated they equal the full read.
    const full = await service.readMessages(P, A, S);
    expect([...first.messages, ...mid.messages, ...tail.messages]).toEqual(full);
  });

  it("windows span shard boundaries; a mid-Task rotation stays glued to its Task's window", async () => {
    // Shard 1: turn 1, then turn 2 begins and rotates mid-Task (auto compaction with
    // carry-over): the continuation lives in shard 2 with no new user prompt.
    await writeTraceFile(root, P, A, "2026-07-20", S, 1, [
      sessionMeta(metaPayload()),
      ...turn(0, 1, 1000),
      at("2026-07-20T10:01:00.000Z", userText("q2")),
      at("2026-07-20T10:01:01.000Z", requestBegin()),
      at("2026-07-20T10:01:02.000Z", requestEnd("completed")),
      at("2026-07-20T10:01:02.100Z", tokenUsage(counts(2000), counts(900))),
      at(
        "2026-07-20T10:01:03.000Z",
        compactionBegin({ reason: "context", mode: "summarize", context: 900, turns: 2 }),
      ),
      at("2026-07-20T10:01:04.000Z", requestBegin()),
      at("2026-07-20T10:01:05.000Z", assistantText("[summary]s[/summary]")),
      at("2026-07-20T10:01:06.000Z", requestEnd("completed")),
      at(
        "2026-07-20T10:01:07.000Z",
        compactionEnd({ reason: "context", mode: "summarize", status: "completed" }),
      ),
    ]);
    await writeTraceFile(root, P, A, "2026-07-20", S, 2, [
      sessionMeta(metaPayload()),
      at("2026-07-20T10:01:08.000Z", userText("[context_summary]\ns\n[/context_summary]")),
      at("2026-07-20T10:01:09.000Z", requestBegin()),
      at("2026-07-20T10:01:10.000Z", assistantText("a2")),
      at("2026-07-20T10:01:11.000Z", requestEnd("completed")),
      at("2026-07-20T10:01:11.500Z", tokenUsage(counts(2500), counts(300))),
      ...turn(2, 3, 3000),
    ]);

    // Tail of 2 units = turn 2 (which spans BOTH shards, compaction included) + turn 3.
    const tail = await service.readMessagesPage(P, A, S, { kind: "tail", limit: 2 });
    expect(userTexts(tail.messages)[0]).toBe("q2");
    expect(userTexts(tail.messages)).toContain("q3");
    expect(
      tail.messages.some((m) => (m.payload as { type?: string }).type === "compaction_begin"),
    ).toBe(true);
    // The rotated shard's rewritten session_meta and summary injection ride along inside the window.
    expect(tail.messages.filter((m) => m.type === "session_meta")).toHaveLength(1);
    expect(decodeCursor(tail.before!)).toEqual({ fileIndex: 1, ordinal: 6 });
    expect(tail.prior.turns).toBe(1);

    const older = await service.readMessagesPage(P, A, S, {
      kind: "before",
      cursor: decodeCursor(tail.before!)!,
      limit: 10,
    });
    expect(userTexts(older.messages)).toEqual(["q1"]);
    expect(older.before).toBeUndefined();
    const full = await service.readMessages(P, A, S);
    expect([...older.messages, ...tail.messages]).toEqual(full);
  });

  it("a compaction the user quit out of keeps the conversation after it visible (issue #288)", async () => {
    // The process died mid-compaction, leaving compaction_begin with no end; core's resume
    // closes the span as `failed` before the session continues the shard. The scanner must
    // treat everything after the closure as ordinary conversation again — before the fix,
    // the unclosed begin kept `compactionActive` set for the rest of the shard and every
    // later prompt vanished from the window (no boundary, no unit, no messages).
    await writeTraceFile(root, P, A, "2026-07-20", S, 1, [
      sessionMeta(metaPayload()),
      ...turn(0, 1, 1000),
      at(
        "2026-07-20T10:01:00.000Z",
        compactionBegin({ reason: "context", mode: "summarize", context: 900, turns: 1 }),
      ),
      at("2026-07-20T10:01:01.000Z", userText("COMPACT NOW")),
      at("2026-07-20T10:01:02.000Z", requestBegin()),
      // ...process died; the resume closed the span before writing anything else:
      at(
        "2026-07-20T10:01:30.000Z",
        compactionEnd({ reason: "context", mode: "summarize", status: "retryable" }),
      ),
      ...turn(2, 2, 2000),
    ]);

    const tail = await service.readMessagesPage(P, A, S, { kind: "tail", limit: 1 });
    // The post-crash prompt is a unit of its own and stays visible.
    expect(userTexts(tail.messages)).toEqual(["q2"]);
    expect(tail.prior.turns).toBe(1);

    // The windows still tile the transcript exactly.
    const older = await service.readMessagesPage(P, A, S, {
      kind: "before",
      cursor: decodeCursor(tail.before!)!,
      limit: 10,
    });
    const full = await service.readMessages(P, A, S);
    expect([...older.messages, ...tail.messages]).toEqual(full);
  });

  it("a mid-task compaction the user interrupted keeps its own turn's messages in the window", async () => {
    // The user hit stop during a mid-task compaction: the engine closes the pair and ends
    // the run with an abort, all inside the turn that q1 opened. The abort does not cut a
    // window of its own, and the interrupted compaction stays attached to its turn.
    await writeTraceFile(root, P, A, "2026-07-20", S, 1, [
      sessionMeta(metaPayload()),
      ...turn(0, 1, 1000),
      at(
        "2026-07-20T10:01:00.000Z",
        compactionBegin({ reason: "context", mode: "summarize", context: 900, turns: 1 }),
      ),
      at("2026-07-20T10:01:01.000Z", userText("COMPACT NOW")),
      at(
        "2026-07-20T10:01:02.000Z",
        compactionEnd({ reason: "context", mode: "summarize", status: "aborted" }),
      ),
      at("2026-07-20T10:01:03.000Z", abortEvent("compaction_interrupted")),
      ...turn(2, 2, 2000),
    ]);

    const tail = await service.readMessagesPage(P, A, S, { kind: "tail", limit: 1 });
    expect(userTexts(tail.messages)).toEqual(["q2"]);
    const older = await service.readMessagesPage(P, A, S, {
      kind: "before",
      cursor: decodeCursor(tail.before!)!,
      limit: 10,
    });
    const full = await service.readMessages(P, A, S);
    expect([...older.messages, ...tail.messages]).toEqual(full);
  });

  it("cuts are pairing-safe: a tool_call and its output never split, steering images stay with their chip", async () => {
    await writeTraceFile(root, P, A, "2026-07-20", S, 1, [
      sessionMeta(metaPayload()),
      ...turn(0, 1, 1000),
      // Turn 2: tool call whose output lands after request_end, steering + image mid-run.
      at("2026-07-20T10:01:00.000Z", userText("q2")),
      at("2026-07-20T10:01:01.000Z", requestBegin()),
      at("2026-07-20T10:01:02.000Z", toolCall({ name: "exec", arguments: "{}", toolCallId: "t1" })),
      at("2026-07-20T10:01:03.000Z", requestEnd("completed")),
      at("2026-07-20T10:01:04.000Z", toolCallOutput({ output: "out", toolCallId: "t1" })),
      at("2026-07-20T10:01:05.000Z", userText("[user_steering]\nfaster\n[/user_steering]")),
      at("2026-07-20T10:01:05.100Z", imageUrlMessage("data:image/png;base64,AAAA")),
      at("2026-07-20T10:01:06.000Z", requestBegin()),
      at("2026-07-20T10:01:07.000Z", assistantText("a2")),
      at("2026-07-20T10:01:08.000Z", requestEnd("completed")),
      at("2026-07-20T10:01:08.500Z", tokenUsage(counts(2000), counts(200))),
    ]);

    // limit 1 must take the WHOLE second turn: the cut lands at q2, never at the
    // steering text, its image, or between t1's call and output.
    const tail = await service.readMessagesPage(P, A, S, { kind: "tail", limit: 1 });
    expect(userTexts(tail.messages)[0]).toBe("q2");
    const kinds = tail.messages.map((m) => (m.payload as { type?: string }).type);
    expect(kinds).toContain("tool_call");
    expect(kinds).toContain("tool_call_output");
    expect(kinds).toContain("image_url");
    // Steering opened no new unit: the previous window holds exactly turn 1.
    const older = await service.readMessagesPage(P, A, S, {
      kind: "before",
      cursor: decodeCursor(tail.before!)!,
      limit: 10,
    });
    expect(userTexts(older.messages)).toEqual(["q1"]);
  });

  it("a steered background notice never cuts a window; an idle-launched notice cuts and counts a turn", async () => {
    // Twin of the trace-service and stream-model steered-notice cases: the four "what is one
    // turn" implementations must agree. The steered form (delivery: steering) stays inside
    // its unit; the unstamped form is a task's own input — a unit boundary AND an outline
    // entry (its question is the report body, so the entry is real).
    const steered = buildBackgroundTaskDoneMessage(
      {
        kind: "command",
        id: "proc-1",
        status: "completed",
        detail: "exit code 0",
        delivery: "steering",
      },
      "Background command finished",
    );
    const plain = buildBackgroundTaskDoneMessage(
      { kind: "command", id: "proc-2", status: "failed", detail: "exit code 1" },
      "Background command failed",
    );
    await writeTraceFile(root, P, A, "2026-07-20", S, 1, [
      sessionMeta(metaPayload()),
      ...turn(0, 1, 1000),
      // Turn 2: reply lands, then the steered notice continues the same Task with one more request.
      at("2026-07-20T10:01:00.000Z", userText("q2")),
      at("2026-07-20T10:01:01.000Z", requestBegin()),
      at("2026-07-20T10:01:02.000Z", assistantText("a2")),
      at("2026-07-20T10:01:03.000Z", requestEnd("completed")),
      at("2026-07-20T10:01:04.000Z", userText(steered, "harness")),
      at("2026-07-20T10:01:05.000Z", requestBegin()),
      at("2026-07-20T10:01:06.000Z", assistantText("noted the finish")),
      at("2026-07-20T10:01:07.000Z", requestEnd("completed")),
      at("2026-07-20T10:01:07.500Z", tokenUsage(counts(2000), counts(200))),
      // Turn 3: the idle-launched notice task.
      at("2026-07-20T10:02:00.000Z", userText(plain, "harness")),
      at("2026-07-20T10:02:01.000Z", requestBegin()),
      at("2026-07-20T10:02:02.000Z", assistantText("a3")),
      at("2026-07-20T10:02:03.000Z", requestEnd("completed")),
      at("2026-07-20T10:02:03.500Z", tokenUsage(counts(3000), counts(300))),
    ]);

    // The newest unit is the idle notice's own turn, with two entries (q1, q2) before it —
    // the steered notice opened neither a unit nor an entry.
    const tail = await service.readMessagesPage(P, A, S, { kind: "tail", limit: 1 });
    expect(userTexts(tail.messages)[0]).toContain("proc-2");
    expect(tail.prior.turns).toBe(2);
    // The previous window is the WHOLE second turn: the cut lands at q2, never at the
    // steered notice.
    const older = await service.readMessagesPage(P, A, S, {
      kind: "before",
      cursor: decodeCursor(tail.before!)!,
      limit: 1,
    });
    expect(userTexts(older.messages)[0]).toBe("q2");
    expect(userTexts(older.messages).some((t) => t.includes("proc-1"))).toBe(true);
    expect(older.prior.turns).toBe(1);
  });

  it("an UNSTAMPED notice in a tool-continuation gap neither cuts nor counts (pre-stamp traces)", async () => {
    // Legacy shape: no delivery stamp, but the notice sits between a turn's tool output and
    // the continuation request — in-task by position, mirroring the reducer and trace
    // analysis. The window must keep the whole turn together.
    const plain = buildBackgroundTaskDoneMessage(
      { kind: "command", id: "proc-9", status: "completed", detail: "exit code 0" },
      "Background command finished",
    );
    await writeTraceFile(root, P, A, "2026-07-20", S, 1, [
      sessionMeta(metaPayload()),
      ...turn(0, 1, 1000),
      at("2026-07-20T10:01:00.000Z", userText("q2")),
      at("2026-07-20T10:01:01.000Z", requestBegin()),
      at("2026-07-20T10:01:02.000Z", toolCall({ name: "exec", arguments: "{}", toolCallId: "t1" })),
      at("2026-07-20T10:01:03.000Z", requestEnd("completed")),
      at("2026-07-20T10:01:04.000Z", toolCallOutput({ output: "launched", toolCallId: "t1" })),
      at("2026-07-20T10:01:05.000Z", userText(plain, "harness")),
      at("2026-07-20T10:01:06.000Z", requestBegin()),
      at("2026-07-20T10:01:07.000Z", assistantText("done")),
      at("2026-07-20T10:01:08.000Z", requestEnd("completed")),
      at("2026-07-20T10:01:08.500Z", tokenUsage(counts(2000), counts(200))),
    ]);
    const tail = await service.readMessagesPage(P, A, S, { kind: "tail", limit: 1 });
    // The newest unit is the WHOLE second turn — the cut lands at q2, not at the notice —
    // and only q1 precedes it in the outline numbering.
    expect(userTexts(tail.messages)[0]).toBe("q2");
    expect(userTexts(tail.messages).some((t) => t.includes("proc-9"))).toBe(true);
    expect(tail.prior.turns).toBe(1);
  });

  it("a text+images send is one unit and one outline turn; banner and goal-round prompts cut but never count", async () => {
    await writeTraceFile(root, P, A, "2026-07-20", S, 1, [
      sessionMeta(metaPayload()),
      // Send 1: text + two images (one entry, one unit).
      at("2026-07-20T10:00:00.000Z", userText("look")),
      at("2026-07-20T10:00:00.100Z", imageUrlMessage("data:image/png;base64,AAAA")),
      at("2026-07-20T10:00:00.200Z", imageUrlMessage("data:image/png;base64,BBBB")),
      at("2026-07-20T10:00:01.000Z", requestBegin()),
      at("2026-07-20T10:00:02.000Z", assistantText("a1")),
      at("2026-07-20T10:00:03.000Z", requestEnd("completed")),
      at("2026-07-20T10:00:03.500Z", tokenUsage(counts(1000), counts(100))),
      // A handoff banner send: machine-only, no outline entry (buildOutline returns null body).
      at(
        "2026-07-20T10:01:00.000Z",
        userText(buildHandoffMessage({ agentId: "worker", workspace: "/tmp/w" })),
      ),
      at("2026-07-20T10:01:01.000Z", requestBegin()),
      at("2026-07-20T10:01:02.000Z", assistantText("a2")),
      at("2026-07-20T10:01:03.000Z", requestEnd("completed")),
      at("2026-07-20T10:01:03.500Z", tokenUsage(counts(2000), counts(200))),
      // A goal round-2 re-send: starts a Task but opens no outline entry.
      at("2026-07-20T10:02:00.000Z", userText("[goal]\nround: 2\nbudget: unlimited\n[/goal]\ngo")),
      at("2026-07-20T10:02:01.000Z", requestBegin()),
      at("2026-07-20T10:02:02.000Z", assistantText("a3")),
      at("2026-07-20T10:02:03.000Z", requestEnd("completed")),
      at("2026-07-20T10:02:03.500Z", tokenUsage(counts(3000), counts(300))),
      ...turn(3, 4, 4000),
    ]);

    // Four units in total (each send cuts), but only ONE outline entry precedes q4:
    // the text+images send counts once, the banner and the goal round count zero —
    // exactly buildOutline's rule, so q4 renders as global turn 2 with offset 1.
    const tail = await service.readMessagesPage(P, A, S, { kind: "tail", limit: 1 });
    expect(userTexts(tail.messages)).toEqual(["q4"]);
    expect(tail.prior.turns).toBe(1);

    // Walk one more window back: the goal-round unit alone; still 1 entry before it.
    const goalWin = await service.readMessagesPage(P, A, S, {
      kind: "before",
      cursor: decodeCursor(tail.before!)!,
      limit: 1,
    });
    expect(userTexts(goalWin.messages)[0]).toContain("[goal]");
    expect(goalWin.prior.turns).toBe(1);

    const bannerWin = await service.readMessagesPage(P, A, S, {
      kind: "before",
      cursor: decodeCursor(goalWin.before!)!,
      limit: 1,
    });
    expect(bannerWin.prior.turns).toBe(1); // only the image send precedes the banner
    const firstWin = await service.readMessagesPage(P, A, S, {
      kind: "before",
      cursor: decodeCursor(bannerWin.before!)!,
      limit: 1,
    });
    expect(firstWin.prior.turns).toBe(0);
    expect(firstWin.before).toBeUndefined();
    // The text and its two images stayed one unit.
    expect(userTexts(firstWin.messages)).toEqual(["look"]);
    expect(
      firstWin.messages.filter((m) => (m.payload as { type?: string }).type === "image_url"),
    ).toHaveLength(2);
  });

  it("prior stats: finished-Task elapsed, session/context token readings", async () => {
    await writeTraceFile(root, P, A, "2026-07-20", S, 1, [
      sessionMeta(metaPayload()),
      ...turn(0, 1, 1000), // request_begin 10:00:01 → request_end 10:00:03 = 2s... elapsed = lastReqEnd - firstMsg(q1 at 10:00:00) = 3s
      ...turn(1, 2, 2000),
      ...turn(2, 3, 3000),
    ]);
    const tail = await service.readMessagesPage(P, A, S, { kind: "tail", limit: 1 });
    // Web semantics: a turn's elapsed = last request_end − its first message = 3s each.
    expect(tail.prior.elapsedMs).toBe(2 * 3000);
    expect(tail.prior.sessionTokens).toBe(2000); // last session.total before the window
    expect(tail.prior.contextTokens).toBe(102); // last request.total before the window (turn(…, 2) writes 100+2)
    expect(tail.prior.subagentTokens).toBe(0);
  });

  it("subagent pointers expand only inside the window; earlier children feed prior.subagentTokens without appearing", async () => {
    const child2 = "session-2026-07-20-10-02-00-eeff0003";
    await writeTraceFile(root, P, A, "2026-07-20", S, 1, [
      sessionMeta(metaPayload()),
      // Turn 1 spawns CHILD.
      at("2026-07-20T10:00:00.000Z", userText("q1")),
      at("2026-07-20T10:00:01.000Z", requestBegin()),
      at(
        "2026-07-20T10:00:02.000Z",
        toolCall({ name: "run_subagent", arguments: "{}", toolCallId: "c1" }),
      ),
      at("2026-07-20T10:00:03.000Z", subagentEvent(CHILD)),
      at("2026-07-20T10:00:04.000Z", requestEnd("completed")),
      at("2026-07-20T10:00:05.000Z", toolCallOutput({ output: "done", toolCallId: "c1" })),
      at("2026-07-20T10:00:06.000Z", tokenUsage(counts(1000), counts(100))),
      // Turn 2 spawns child2.
      at("2026-07-20T10:01:00.000Z", userText("q2")),
      at("2026-07-20T10:01:01.000Z", requestBegin()),
      at(
        "2026-07-20T10:01:02.000Z",
        toolCall({ name: "run_subagent", arguments: "{}", toolCallId: "c2" }),
      ),
      at("2026-07-20T10:01:03.000Z", subagentEvent(child2)),
      at("2026-07-20T10:01:04.000Z", requestEnd("completed")),
      at("2026-07-20T10:01:05.000Z", toolCallOutput({ output: "done", toolCallId: "c2" })),
      at("2026-07-20T10:01:06.000Z", tokenUsage(counts(2000), counts(120))),
    ]);
    await writeTraceFile(root, P, A, "2026-07-20", CHILD, 1, [
      sessionMeta(metaPayload({ session_id: CHILD })),
      at("2026-07-20T10:00:03.500Z", assistantText("child says")),
      at("2026-07-20T10:00:03.800Z", tokenUsage(counts(400), counts(400))),
    ]);
    await writeTraceFile(root, P, A, "2026-07-20", child2, 1, [
      sessionMeta(metaPayload({ session_id: child2 })),
      at("2026-07-20T10:01:03.500Z", assistantText("child2 says")),
      at("2026-07-20T10:01:03.800Z", tokenUsage(counts(70), counts(70))),
    ]);

    const tail = await service.readMessagesPage(P, A, S, { kind: "tail", limit: 1 });
    // The window (turn 2) expands child2 in place, origin-tagged, pointer replaced.
    const origins = tail.messages.filter((m) => m.origin !== undefined);
    expect(origins.length).toBeGreaterThan(0);
    for (const m of origins) expect(m.origin).toEqual([child2]);
    expect(tail.messages.some((m) => (m.payload as { type?: string }).type === "subagent")).toBe(
      false,
    );
    // CHILD (turn 1) is NOT in the window — its usage rides prior.subagentTokens instead.
    expect(tail.messages.some((m) => textOf(m) === "child says")).toBe(false);
    expect(tail.prior.subagentTokens).toBe(400);

    // The older window then expands CHILD with the exact shape the full path produces.
    const older = await service.readMessagesPage(P, A, S, {
      kind: "before",
      cursor: decodeCursor(tail.before!)!,
      limit: 10,
    });
    const full = await service.readMessages(P, A, S);
    expect([...older.messages, ...tail.messages]).toEqual(full);
  });

  it("shard-read discipline: after priming, old-window requests never read the newest shard and tail requests never read old shards", async () => {
    await writeTraceFile(root, P, A, "2026-07-20", S, 1, [
      sessionMeta(metaPayload()),
      ...turn(0, 1, 1000),
      ...turn(1, 2, 2000),
    ]);
    await writeTraceFile(root, P, A, "2026-07-21", S, 2, [
      sessionMeta(metaPayload()),
      ...turn(2, 3, 3000),
    ]);
    await writeTraceFile(root, P, A, "2026-07-21", S, 3, [
      sessionMeta(metaPayload()),
      ...turn(3, 4, 4000),
      ...turn(4, 5, 5000),
    ]);

    // Priming: the first windowed read backfills the per-shard prefix cache (reads old shards once).
    const primed = await service.readMessagesPage(P, A, S, { kind: "tail", limit: 1 });
    expect(userTexts(primed.messages)).toEqual(["q5"]);

    // A tail request now touches ONLY the newest shard.
    harness.shardReads.length = 0;
    await service.readMessagesPage(P, A, S, { kind: "tail", limit: 1 });
    expect(harness.shardReads).toHaveLength(1);
    expect(harness.shardReads[0]).toContain(`${S}_003.jsonl`);

    // An old-window request touches ONLY its own shard — never the newest one.
    harness.shardReads.length = 0;
    const older = await service.readMessagesPage(P, A, S, {
      kind: "before",
      cursor: { fileIndex: 2, ordinal: 1 },
      limit: 1,
    });
    expect(userTexts(older.messages)).toEqual(["q2"]);
    expect(harness.shardReads.every((p) => !p.includes(`${S}_003.jsonl`))).toBe(true);
    expect(harness.shardReads.some((p) => p.includes(`${S}_001.jsonl`))).toBe(true);
  });

  it("cursor edge cases: unknown shard yields an empty end-of-history page; empty sessions page cleanly", async () => {
    expect(await service.readMessagesPage(P, A, S, { kind: "tail", limit: 5 })).toEqual({
      messages: [],
      prior: { turns: 0, subagentTokens: 0, elapsedMs: 0, sessionTokens: 0, contextTokens: 0 },
    });
    await writeTraceFile(root, P, A, "2026-07-20", S, 1, [
      sessionMeta(metaPayload()),
      ...turn(0, 1, 1000),
    ]);
    const gone = await service.readMessagesPage(P, A, S, {
      kind: "before",
      cursor: { fileIndex: 9, ordinal: 4 },
      limit: 5,
    });
    expect(gone.messages).toEqual([]);
    expect(gone.before).toBeUndefined();
    // Round-trip of the cursor encoding itself.
    expect(decodeCursor(encodeCursor({ fileIndex: 12, ordinal: 345 }))).toEqual({
      fileIndex: 12,
      ordinal: 345,
    });
    expect(decodeCursor("12:")).toBeNull();
    expect(decodeCursor("a:b")).toBeNull();
  });

  it("tail covering the whole transcript returns everything with no cursor and equals the full read", async () => {
    await writeTraceFile(root, P, A, "2026-07-20", S, 1, [
      sessionMeta(metaPayload()),
      ...turn(0, 1, 1000),
      ...turn(1, 2, 2000),
    ]);
    const tail = await service.readMessagesPage(P, A, S, { kind: "tail", limit: 50 });
    expect(tail.before).toBeUndefined();
    expect(tail.prior.turns).toBe(0);
    expect(tail.messages).toEqual(await service.readMessages(P, A, S));
  });
});
