/**
 * Unit tests for the Trace service: multi-file history concatenation, file
 * listing, pagination, performance-analysis derivation, and Agent-level
 * drill-down browsing.
 */
import fs from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  abortEvent,
  approvalDecision,
  assistantText,
  compactionBegin,
  compactionEnd,
  imageUrlMessage,
  mcpConnectBegin,
  mcpConnectEnd,
  requestBegin,
  requestEnd,
  sessionMeta,
  thinkingMessage,
  tokenUsage,
  toolCall,
  toolCallOutput,
  userText,
  withOrigin,
} from "@prismshadow/penguin-core";
import type { OmniMessage, SessionMetaPayload, TokenCounts } from "@prismshadow/penguin-core";
import type { TraceService } from "../src/services/trace-service.js";
import type { SessionRow } from "../src/db/repos/sessions.js";
import { SessionSources } from "../src/runtime/session-sources.js";
import { makeTempRoot, makeTraceHarness, writeTraceFile } from "./helpers.js";

const P = "project-t";
const A = "agent-t";
const S = "session-2026-07-05-10-00-00-aabbccdd";

function at(ts: string, msg: OmniMessage): OmniMessage {
  return { ...msg, timestamp: ts };
}

function counts(total: number): TokenCounts {
  return { cache_read: 0, cache_write: 0, output: 0, total };
}

/** Request usage with real three-bucket counts (both the context snapshot and the TPS numerator are derived from this). */
function buckets(cacheRead: number, cacheWrite: number, output: number): TokenCounts {
  return {
    cache_read: cacheRead,
    cache_write: cacheWrite,
    output,
    total: cacheRead + cacheWrite + output,
  };
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

/** A sessions-table row for the paginated listing's index fake (only the listing-relevant fields vary per test). */
function dbRow(over: Partial<SessionRow> & { sessionId: string }): SessionRow {
  return {
    projectId: P,
    agentId: A,
    provider: "custom",
    modelId: "m1",
    workspace: "/tmp/w",
    approvalMode: "allow-all",
    title: null,
    createdAt: "2026-07-05T10:00:00.000Z",
    lastActiveAt: "2026-07-05T10:00:00.000Z",
    ...over,
  };
}

describe("trace-service", () => {
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

  it("messages: all index files concatenated in order (across date directories)", async () => {
    await writeTraceFile(root, P, A, "2026-07-05", S, 1, [
      sessionMeta(metaPayload()),
      userText("first file"),
    ]);
    await writeTraceFile(root, P, A, "2026-07-06", S, 2, [
      sessionMeta(metaPayload()),
      userText("second file"),
    ]);
    const messages = await service.readMessages(P, A, S);
    expect(messages).toHaveLength(4);
    expect((messages[1]!.payload as { text: string }).text).toBe("first file");
    expect((messages[3]!.payload as { text: string }).text).toBe("second file");
  });

  it("messages: tolerates a truncated last line", async () => {
    const file = await writeTraceFile(root, P, A, "2026-07-05", S, 1, [userText("ok")]);
    await fs.appendFile(file, '{"timestamp":"2026', "utf8");
    const messages = await service.readMessages(P, A, S);
    expect(messages).toHaveLength(1);
  });

  it("traces listing: index / date / size / mtime", async () => {
    await writeTraceFile(root, P, A, "2026-07-05", S, 1, [userText("a")]);
    await writeTraceFile(root, P, A, "2026-07-06", S, 2, [userText("bb")]);
    const files = await service.listTraceFiles(P, A, S);
    expect(files.map((f) => f.index)).toEqual([1, 2]);
    expect(files[0]!.date).toBe("2026-07-05");
    expect(files[0]!.sizeBytes).toBeGreaterThan(0);
    expect(Date.parse(files[0]!.mtime)).not.toBeNaN();
  });

  it("paginated line reads: offset/limit and total", async () => {
    const messages = Array.from({ length: 10 }, (_, i) => userText(`m${i}`));
    await writeTraceFile(root, P, A, "2026-07-05", S, 1, messages);
    const page = await service.readEvents(P, A, S, 1, 3, 4);
    expect(page.total).toBe(10);
    expect(page.offset).toBe(3);
    expect(page.events).toHaveLength(4);
    expect((page.events[0]!.payload as { text: string }).text).toBe("m3");
    const notFound = await service.readEvents(P, A, S, 99, 0, 10).catch((e: unknown) => e);
    expect((notFound as { status: number }).status).toBe(404);
  });

  it("performance analysis: Request pairing, tool durations, reconnect / compaction counts, Token trend", async () => {
    await writeTraceFile(root, P, A, "2026-07-05", S, 1, [
      sessionMeta(metaPayload()),
      at("2026-07-05T10:00:00.000Z", userText("hi")),
      at("2026-07-05T10:00:01.000Z", requestBegin()),
      at("2026-07-05T10:00:03.000Z", requestEnd("timeout")), // reconnect +1
      at("2026-07-05T10:00:03.500Z", requestBegin()),
      at(
        "2026-07-05T10:00:04.000Z",
        toolCall({ name: "exec_command", arguments: "{}", toolCallId: "tc-1" }),
      ),
      at("2026-07-05T10:00:05.000Z", requestEnd("completed")),
      at("2026-07-05T10:00:06.500Z", toolCallOutput({ output: "done", toolCallId: "tc-1" })),
      at("2026-07-05T10:00:07.000Z", tokenUsage(counts(1000), counts(400))),
      at(
        "2026-07-05T10:00:08.000Z",
        compactionBegin({ reason: "manual", mode: "summarize", context: 400, turns: 2 }),
      ),
      at(
        "2026-07-05T10:00:09.000Z",
        compactionEnd({ reason: "manual", mode: "summarize", status: "aborted" }),
      ),
      at("2026-07-05T10:00:10.000Z", abortEvent()),
      at("2026-07-05T10:00:11.000Z", requestBegin()), // unclosed (process exited)
    ]);
    const analysis = await service.analyze(P, A, S, 1);

    expect(analysis.requests).toHaveLength(3);
    expect(analysis.requests[0]!.status).toBe("timeout");
    expect(analysis.requests[0]!.durationMs).toBe(2000);
    expect(analysis.requests[1]!.status).toBe("completed");
    expect(analysis.requests[1]!.durationMs).toBe(1500);
    expect(analysis.requests[2]!.endTs).toBeUndefined();
    // A timeout is auto-reconnected by core within the same run, so the resent
    // Request still belongs to **the same user turn**: req0(timeout) and
    // req1(retry succeeded) are both Task 0 — they must not be split into two
    // turns. Compaction interrupts continuation, so req2 starts a new turn.
    expect(analysis.requests.map((r) => r.taskIndex)).toEqual([0, 0, 1]);

    expect(analysis.toolCalls).toHaveLength(1);
    expect(analysis.toolCalls[0]!.name).toBe("exec_command");
    expect(analysis.toolCalls[0]!.durationMs).toBe(2500);
    expect(analysis.toolCalls[0]!.stopReason).toBe("completed");

    expect(analysis.reconnectCount).toBe(1);
    expect(analysis.compactionCount).toBe(1);
    expect(analysis.usageTrend).toEqual([
      { ts: "2026-07-05T10:00:07.000Z", requestTotal: 400, sessionTotal: 1000 },
    ]);
  });

  it("the Task context snapshot takes the turn's last Request, not a sum across its Requests", async () => {
    // Two Requests within one Task (a tool call triggers another round): each
    // input **re-carries the entire history**, so 60k → 65k is the context
    // growing, not a 60k + 65k = 125k sum of usage. Summing them would double-count
    // the context — a few rounds of tool calls would blow the context window past
    // 100% and overflow the ring.
    await writeTraceFile(root, P, A, "2026-07-05", S, 1, [
      sessionMeta(metaPayload()),
      at("2026-07-05T10:00:00.000Z", userText("hi")),
      at("2026-07-05T10:00:01.000Z", requestBegin()),
      at(
        "2026-07-05T10:00:02.000Z",
        toolCall({ name: "exec_command", arguments: "{}", toolCallId: "tc-1" }),
      ),
      at("2026-07-05T10:00:03.000Z", requestEnd("completed")),
      at("2026-07-05T10:00:03.100Z", tokenUsage(counts(60_000), buckets(50_000, 8_000, 2_000))),
      at("2026-07-05T10:00:03.500Z", toolCallOutput({ output: "ok", toolCallId: "tc-1" })),
      // Continuation round (same Task): context grows to 65k
      at("2026-07-05T10:00:04.000Z", requestBegin()),
      at("2026-07-05T10:00:06.000Z", requestEnd("completed")),
      at("2026-07-05T10:00:06.100Z", tokenUsage(counts(65_000), buckets(58_000, 4_000, 3_000))),
    ]);
    const a = await service.analyze(P, A, S, 1);

    expect(a.requests.map((r) => r.taskIndex)).toEqual([0, 0]); // tool call → continues the same Task
    expect(a.tasks).toHaveLength(1);
    const t = a.tasks[0]!;
    // Snapshot = the last Request (58k/4k/3k = 65k), not the sum of both (108k/12k/5k = 125k).
    expect(t.context).toEqual({ cacheRead: 58_000, cacheWrite: 4_000, output: 3_000 });
    // The running total (used for Token/cost, with output doubling as the TPS
    // numerator) IS summed: the three-bucket sum across both Requests. It and the
    // snapshot above are two different measures — the frontend used to feed the
    // running total into the ring as if it were the snapshot, which is how "two
    // rounds of 60k/65k" ended up displaying as 125k.
    expect(t.tokens).toEqual({ cacheRead: 108_000, cacheWrite: 12_000, output: 5_000 });
    expect(t.llmMs).toBe(2000 + 2000);
  });

  it("human approval waits don't count toward LLM generation time (the TPS denominator)", async () => {
    // core does `await approve(tc)` inside the streaming loop: until approval
    // returns, the next chunk isn't consumed and request_end can't fire, so the
    // entire human wait sits between request_begin and request_end. Without
    // subtracting it, "2s of generation + 30s of approval wait" would drop the
    // TPS to a fifteenth of the real value.
    await writeTraceFile(root, P, A, "2026-07-05", S, 1, [
      sessionMeta(metaPayload()),
      at("2026-07-05T10:00:00.000Z", userText("hi")),
      at("2026-07-05T10:00:01.000Z", requestBegin()),
      at(
        "2026-07-05T10:00:02.000Z",
        toolCall({ name: "exec_command", arguments: "{}", toolCallId: "tc-1" }),
      ),
      at("2026-07-05T10:00:32.000Z", approvalDecision("allow", "tc-1")), // human left it hanging for 30s
      at("2026-07-05T10:00:33.000Z", requestEnd("completed")),
      at("2026-07-05T10:00:33.100Z", tokenUsage(counts(1000), buckets(0, 0, 1_000))),
    ]);
    const a = await service.analyze(P, A, S, 1);

    const rq = a.requests[0]!;
    expect(rq.durationMs).toBe(32_000); // wall clock: includes the approval wait
    expect(rq.approvalWaitMs).toBe(30_000);
    expect(rq.activeMs).toBe(2_000); // generation: 1s→2s (emits tool_call) + 32s→33s (wrap-up)
    expect(a.tasks[0]!.llmMs).toBe(2_000); // the denominator uses only activeMs
    expect(a.tasks[0]!.tokens.output).toBe(1_000); // → 500 tok/s, not 31 tok/s
  });

  it("compaction is its own turn: its TPS is its own and doesn't pollute user turns; the context snapshot still takes only non-compaction Requests", async () => {
    // Compaction's request_begin/end and token_usage all sit between
    // compaction_begin and compaction_end (see core's context-engine summarize
    // flow). Both sides of the Chat page exclude compaction, so Trace must use
    // the same accounting, or the two pages would compute different TPS for the
    // same Session.
    await writeTraceFile(root, P, A, "2026-07-05", S, 1, [
      sessionMeta(metaPayload()),
      at("2026-07-05T10:00:00.000Z", userText("hi")),
      at("2026-07-05T10:00:01.000Z", requestBegin()),
      at("2026-07-05T10:00:03.000Z", requestEnd("completed")),
      at("2026-07-05T10:00:03.100Z", tokenUsage(counts(30_000), buckets(20_000, 9_000, 1_000))),
      at(
        "2026-07-05T10:00:04.000Z",
        compactionBegin({ reason: "context", mode: "summarize", context: 30_000, turns: 2 }),
      ),
      at("2026-07-05T10:00:05.000Z", requestBegin()), // the compaction request
      at("2026-07-05T10:00:15.000Z", requestEnd("completed")), // slow: 10s
      at("2026-07-05T10:00:15.100Z", tokenUsage(counts(32_000), buckets(29_000, 0, 3_000))),
      at(
        "2026-07-05T10:00:16.000Z",
        compactionEnd({ reason: "context", mode: "summarize", status: "completed" }),
      ),
    ]);
    const a = await service.analyze(P, A, S, 1);

    expect(a.requests[1]!.compaction).toBe(true);
    expect(a.requests[0]!.compaction).toBeUndefined();
    expect(a.tasks.map((t) => t.taskIndex)).toEqual([0, 1]);

    // User turn: TPS counts only its own Request — none of the compaction's 3k output or 10s of generation time bleeds in.
    const t = a.tasks[0]!;
    expect(t.context).toEqual({ cacheRead: 20_000, cacheWrite: 9_000, output: 1_000 });
    expect(t.tokens.output).toBe(1_000);
    expect(t.llmMs).toBe(2_000);

    // The compaction turn: it IS **a turn**, with its own TPS (how fast the summary was generated) — it shouldn't be blanked out as "—".
    const ct = a.tasks[1]!;
    expect(ct.llmMs).toBe(10_000);
    // But it has no context snapshot: the tokens compaction consumes aren't the
    // post-compaction context size (the frontend uses this to skip drawing a ring for the compaction turn).
    expect(ct.context).toBeUndefined();
    // The running total is still recorded (output also serves as the compaction
    // turn's own TPS numerator): compaction's tokens are genuinely paid for, so the cost must not be dropped.
    expect(ct.tokens).toEqual({ cacheRead: 29_000, cacheWrite: 0, output: 3_000 });

    // The compaction turn is flagged (the UI shows a "compaction" badge); its
    // duration is measured from its request_begin (10:00:05) to compaction_end (10:00:16).
    expect(ct.compaction).toBe(true);
    expect(t.compaction).toBeUndefined();
    expect(Date.parse(ct.endTs) - Date.parse(ct.startTs)).toBe(11_000);
    // Overall elapsed time = **the sum of every turn (including compaction turns)**,
    // matching the same scope as the per-turn display — adding up the durations
    // shown on each turn's card must equal the total. User turn 2.1s (request_begin
    // 10:00:01 → token_usage 10:00:03.1) + compaction turn 11s.
    expect(Date.parse(t.endTs) - Date.parse(t.startTs)).toBe(2_100);
    expect(a.elapsedMs).toBe(2_100 + 11_000);
  });

  it("a compaction request exhausting retries (ending in timeout) doesn't fold the next user turn into the compaction Task", async () => {
    // The intersection of "timeout → continuation" and "compaction is its own
    // turn": when a compaction request exhausts its retries and ends in timeout,
    // it would be classified as continuing; compaction_end must clear that
    // continuation flag, or the user turn after compaction would be folded into
    // the compaction Task.
    await writeTraceFile(root, P, A, "2026-07-05", S, 1, [
      sessionMeta(metaPayload()),
      at("2026-07-05T10:00:00.000Z", userText("hi")),
      at("2026-07-05T10:00:01.000Z", requestBegin()),
      at("2026-07-05T10:00:02.000Z", requestEnd("completed")),
      at("2026-07-05T10:00:02.100Z", tokenUsage(counts(1000), buckets(0, 0, 500))),
      at(
        "2026-07-05T10:00:03.000Z",
        compactionBegin({ reason: "context", mode: "summarize", context: 1000, turns: 1 }),
      ),
      at("2026-07-05T10:00:04.000Z", requestBegin()), // the compaction request
      at("2026-07-05T10:00:05.000Z", requestEnd("timeout")), // retries exhausted, ends in timeout
      at(
        "2026-07-05T10:00:06.000Z",
        compactionEnd({ reason: "context", mode: "summarize", status: "aborted" }),
      ),
      at("2026-07-05T10:00:07.000Z", userText("next turn")),
      at("2026-07-05T10:00:08.000Z", requestBegin()),
      at("2026-07-05T10:00:10.000Z", requestEnd("completed")),
      at("2026-07-05T10:00:10.100Z", tokenUsage(counts(1200), buckets(0, 0, 700))),
    ]);
    const a = await service.analyze(P, A, S, 1);

    // Task 0 = the first turn; Task 1 = compaction (its own turn); Task 2 = the
    // user turn after compaction, which must not be folded into Task 1.
    expect(a.requests.map((r) => r.taskIndex)).toEqual([0, 1, 2]);
    // The compaction turn is also in the list (it has a start/end time and token
    // cost, just no TPS or context snapshot) — if the table were built only from
    // turns with "model output or a tool call", this kind of turn would disappear
    // entirely and its events would get folded into the previous turn.
    expect(a.tasks.map((t) => t.taskIndex)).toEqual([0, 1, 2]);
    expect(a.tasks[1]!.tokens.output).toBe(0); // the compaction request timed out, producing nothing
    expect(a.tasks[1]!.context).toBeUndefined();
    expect(a.tasks[2]!.tokens.output).toBe(700);
  });

  it("the user Prompt joins this turn's message range, but duration starts at the first request_begin; empty turns still make the list", async () => {
    // Message **attribution** (messageFrom/To) and **duration** (startTs/endTs)
    // are two different things: the Prompt belongs to this turn's message range
    // (the frontend uses this to list it on this turn's card), but the duration
    // only looks at the LLM request — the start point is the first request_begin,
    // and the user text's timestamp doesn't participate (the compaction summary
    // `[context_summary]` is created during compaction but only persisted on the
    // next run; using it as the start point would stretch the first turn out for
    // no reason). Also, if the turn list were built only from turns with "a model
    // segment or a tool span", a turn that fails outright with no output at all
    // would disappear entirely, and its events would get folded into the previous
    // turn — this must be backstopped by the server-side tasks logic too.
    await writeTraceFile(root, P, A, "2026-07-05", S, 1, [
      at("2026-07-05T10:00:00.000Z", sessionMeta(metaPayload())),
      at("2026-07-05T10:00:00.000Z", userText("question one")),
      at("2026-07-05T10:00:01.000Z", requestBegin()),
      at("2026-07-05T10:00:02.000Z", requestEnd("completed")),
      at("2026-07-05T10:00:02.100Z", tokenUsage(counts(1000), buckets(0, 900, 100))),
      // Second turn: the Prompt precedes the Request; this turn's request fails outright, with no model output or tool call at all.
      at("2026-07-05T10:01:00.000Z", userText("question two")),
      at("2026-07-05T10:01:01.000Z", requestBegin()),
      at("2026-07-05T10:01:04.000Z", requestEnd("failed")),
    ]);
    const a = await service.analyze(P, A, S, 1);

    expect(a.tasks.map((t) => t.taskIndex)).toEqual([0, 1]); // the empty turn is present too
    // Message attribution: starting from "question two" (index 5), it belongs to the second turn, not the tail of the previous one.
    expect(a.tasks[0]!.messageTo).toBe(4);
    expect(a.tasks[1]!.messageFrom).toBe(5);
    // Duration start = request_begin (10:01:01), not the Prompt (10:01:00).
    expect(a.tasks[1]!.startTs).toBe("2026-07-05T10:01:01.000Z");
    expect(a.tasks[1]!.endTs).toBe("2026-07-05T10:01:04.000Z");
    expect(a.tasks[1]!.tokens.output).toBe(0); // nothing was produced
    expect(a.tasks[0]!.startTs).toBe("2026-07-05T10:00:01.000Z");

    // Overall elapsed time = **the sum of each turn's duration**, not "last minus
    // first": this example spans 64s overall, but 58s of that is the gap between
    // turns where the user was thinking/away — not time the Agent spent working.
    // Turn 0 = 1.1s, turn 1 = 3s, total 4.1s.
    expect(Date.parse(a.tasks[0]!.endTs) - Date.parse(a.tasks[0]!.startTs)).toBe(1_100);
    expect(Date.parse(a.tasks[1]!.endTs) - Date.parse(a.tasks[1]!.startTs)).toBe(3_000);
    expect(a.elapsedMs).toBe(4_100);
  });

  it("a failed request the engine retries stays inside the same turn (it is a reconnect, not a turn end)", async () => {
    // The engine reconnects on `failed` as well as timeout/malformed, so the resent Request
    // belongs to the same user turn. If segmentation still keyed on timeout/malformed only,
    // one gateway blip would split a single turn's Tokens, duration and TPS across two Tasks
    // and inflate the Task count — the same smearing the timeout rule exists to prevent.
    await writeTraceFile(root, P, A, "2026-07-05", S, 1, [
      at("2026-07-05T10:00:00.000Z", sessionMeta(metaPayload())),
      at("2026-07-05T10:00:00.000Z", userText("question one")),
      at("2026-07-05T10:00:01.000Z", requestBegin()),
      at("2026-07-05T10:00:02.000Z", requestEnd("failed")), // a gateway error → the engine reconnects
      at("2026-07-05T10:00:03.000Z", requestBegin()),
      at("2026-07-05T10:00:05.000Z", requestEnd("completed")),
      at("2026-07-05T10:00:05.100Z", tokenUsage(counts(1000), buckets(0, 900, 100))),
    ]);
    const a = await service.analyze(P, A, S, 1);
    expect(a.requests.map((r) => r.taskIndex)).toEqual([0, 0]); // one turn, two Requests
    expect(a.tasks.map((t) => t.taskIndex)).toEqual([0]);
    expect(a.reconnectCount).toBe(1);
    expect(a.tasks[0]!.tokens.output).toBe(100);
  });

  it("a failed compaction request is NOT a reconnect: compaction fails fast on it", async () => {
    // Segmentation has to track the engine loop by loop: the turn loop retries `failed`, the
    // compaction loop deliberately does not (it keeps the old context and tries again on the
    // next trigger). Counting this as a reconnect would invent an attempt that never happened.
    await writeTraceFile(root, P, A, "2026-07-05", S, 1, [
      at("2026-07-05T10:00:00.000Z", sessionMeta(metaPayload())),
      at("2026-07-05T10:00:00.000Z", userText("question one")),
      at("2026-07-05T10:00:01.000Z", requestBegin()),
      at("2026-07-05T10:00:02.000Z", requestEnd("completed")),
      at("2026-07-05T10:00:02.100Z", tokenUsage(counts(1000), buckets(0, 900, 100))),
      at(
        "2026-07-05T10:00:03.000Z",
        compactionBegin({ reason: "context", mode: "summarize", context: 1000, turns: 1 }),
      ),
      at("2026-07-05T10:00:04.000Z", requestBegin()),
      at("2026-07-05T10:00:05.000Z", requestEnd("failed")), // compaction gives up here
      at(
        "2026-07-05T10:00:06.000Z",
        compactionEnd({ reason: "context", mode: "summarize", status: "failed" }),
      ),
    ]);
    const a = await service.analyze(P, A, S, 1);
    expect(a.reconnectCount).toBe(0);
  });

  it("after the previous turn ends in timeout (retries exhausted), a new user message starts a new turn", async () => {
    // "timeout → continuation" holds only for **automatic retries within the
    // same run**. Once retries are exhausted and the engine gives up, a message
    // the user sends afterward starts a new turn — if continuation were still
    // stuck at true, this turn would get folded into the failed one, mixing
    // together both turns' messages, Tokens, TPS, and duration. A user Prompt
    // always breaks continuation, regardless of how the previous turn wrapped up.
    await writeTraceFile(root, P, A, "2026-07-05", S, 1, [
      at("2026-07-05T10:00:00.000Z", sessionMeta(metaPayload())),
      at("2026-07-05T10:00:00.000Z", userText("question one")),
      at("2026-07-05T10:00:01.000Z", requestBegin()),
      at("2026-07-05T10:00:02.000Z", requestEnd("timeout")), // retries exhausted → gives up
      at("2026-07-05T10:00:03.000Z", abortEvent()),
      // A new user send
      at("2026-07-05T10:01:00.000Z", userText("question two")),
      at("2026-07-05T10:01:01.000Z", requestBegin()),
      at("2026-07-05T10:01:03.000Z", requestEnd("completed")),
      at("2026-07-05T10:01:03.100Z", tokenUsage(counts(1000), buckets(0, 900, 100))),
    ]);
    const a = await service.analyze(P, A, S, 1);
    expect(a.requests.map((r) => r.taskIndex)).toEqual([0, 1]);
    expect(a.tasks.map((t) => t.taskIndex)).toEqual([0, 1]);
    expect(a.tasks[1]!.startTs).toBe("2026-07-05T10:01:01.000Z"); // duration start = this turn's request_begin
    expect(a.tasks[1]!.tokens.output).toBe(100); // the second turn's usage isn't folded into the first
  });

  it("one send with text + multiple images: turn attribution starts at the **first** message, not the last image", async () => {
    // One send = multiple messages (user text + some number of image_url). If the
    // pending index were overwritten on every message, turn attribution would
    // start from the last image, with the preceding text and images assigned to
    // the previous turn — completely at odds with "the user clicked send once".
    await writeTraceFile(root, P, A, "2026-07-05", S, 1, [
      at("2026-07-05T10:00:00.000Z", sessionMeta(metaPayload())),
      at("2026-07-05T10:00:00.000Z", userText("question one")),
      at("2026-07-05T10:00:01.000Z", requestBegin()),
      at("2026-07-05T10:00:02.000Z", requestEnd("completed")),
      at("2026-07-05T10:00:02.100Z", tokenUsage(counts(500), buckets(0, 400, 100))),
      // Second send: text + two images
      at("2026-07-05T10:01:00.000Z", userText("look at these two images")),
      at("2026-07-05T10:01:00.500Z", imageUrlMessage("data:image/png;base64,AAAA")),
      at("2026-07-05T10:01:01.000Z", imageUrlMessage("data:image/png;base64,BBBB")),
      at("2026-07-05T10:01:02.000Z", requestBegin()),
      at("2026-07-05T10:01:04.000Z", requestEnd("completed")),
      at("2026-07-05T10:01:04.100Z", tokenUsage(counts(900), buckets(0, 800, 100))),
    ]);
    const a = await service.analyze(P, A, S, 1);
    expect(a.tasks.map((t) => t.taskIndex)).toEqual([0, 1]);
    // The message-attribution start = the text (index 5), not the last image (index 7) — all three messages belong to the second turn.
    expect(a.tasks[1]!.messageFrom).toBe(5);
    expect(a.tasks[0]!.messageTo).toBe(4);
    expect(a.tasks[1]!.startTs).toBe("2026-07-05T10:01:02.000Z"); // duration start = request_begin
    expect(a.tasks[0]!.endTs).toBe("2026-07-05T10:00:02.100Z"); // the second send's messages don't land in the first turn
  });

  it("messages attributed one by one, never guessed from timestamps: same-millisecond \"this turn's reply / compaction begin / compaction Prompt / next turn's request\" each land on their own turn", async () => {
    // Automatic compaction triggered at turn wrap-up crams these messages into
    // **the same millisecond**: this turn's last reply, compaction_begin, the
    // compaction Prompt, and the compaction turn's request_begin. Attributing by
    // time boundary simply can't separate them — this turn's reply would get
    // assigned to the compaction turn. A single sequential server-side scan
    // already knows which turn each message belongs to, so the frontend can just
    // use messageFrom/messageTo for attribution.
    const T = "2026-07-05T10:00:05.000Z"; // same millisecond
    await writeTraceFile(root, P, A, "2026-07-05", S, 1, [
      at("2026-07-05T10:00:00.000Z", sessionMeta(metaPayload())),
      at("2026-07-05T10:00:00.000Z", userText("q")),
      at("2026-07-05T10:00:01.000Z", requestBegin()),
      at(T, assistantText("this turn's reply")), // ← this turn's own reply, same millisecond as the entries below
      at(T, tokenUsage(counts(500), buckets(0, 400, 100))),
      at(T, requestEnd("completed")),
      at(T, compactionBegin({ reason: "context", mode: "summarize", context: 500, turns: 1 })),
      at(T, userText("You have a partial transcript…")), // the compaction Prompt (also user text)
      at(T, requestBegin()), // the compaction request
      at("2026-07-05T10:00:25.000Z", requestEnd("completed")), // slow compaction: 20s
      at(
        "2026-07-05T10:00:25.000Z",
        compactionEnd({ reason: "context", mode: "summarize", status: "completed" }),
      ),
    ]);
    const a = await service.analyze(P, A, S, 1);

    expect(a.tasks.map((t) => t.taskIndex)).toEqual([0, 1]);
    // Turn 0 = session_meta..request_end (index 0..5): **this turn's reply stays in this turn**.
    expect([a.tasks[0]!.messageFrom, a.tasks[0]!.messageTo]).toEqual([0, 5]);
    // Turn 1 = compaction_begin..compaction_end (index 6..10): the compaction
    // Prompt belongs to the compaction turn, not the tail of the previous one.
    expect([a.tasks[1]!.messageFrom, a.tasks[1]!.messageTo]).toEqual([6, 10]);

    // Duration is attributed to each turn separately: this turn is 4s
    // (request_begin 10:00:01 → request_end 10:00:05, excluding compaction's 20s),
    // the compaction turn is 20s (the compaction request's request_begin →
    // compaction_end, both starting at 10:00:05).
    expect(Date.parse(a.tasks[0]!.endTs) - Date.parse(a.tasks[0]!.startTs)).toBe(4_000);
    expect(Date.parse(a.tasks[1]!.endTs) - Date.parse(a.tasks[1]!.startTs)).toBe(20_000);
  });

  it("Agent-level drill-down browsing: dates descending, Sessions descending, file index ascending", async () => {
    const s2 = "session-2026-07-06-09-00-00-11112222";
    await writeTraceFile(root, P, A, "2026-07-05", S, 1, [userText("a")]);
    await writeTraceFile(root, P, A, "2026-07-05", S, 2, [userText("b")]);
    await writeTraceFile(root, P, A, "2026-07-06", s2, 1, [userText("c")]);
    const res = await service.agentTraces(P, A);
    expect(res.dates.map((d) => d.date)).toEqual(["2026-07-06", "2026-07-05"]);
    expect(res.dates[1]!.sessions[0]!.sessionId).toBe(S);
    expect(res.dates[1]!.sessions[0]!.files.map((f) => f.index)).toEqual([1, 2]);
    // No `limit` -> the legacy full shape only: the paging fields must stay absent
    // (existing consumers see a byte-identical response).
    expect(res.sessions).toBeUndefined();
    expect(res.totalSessions).toBeUndefined();
  });

  it("Agent-level paging: slices Session groups newest-first, merges one Session's files across dates, and carries the total", async () => {
    const s2 = "session-2026-07-06-09-00-00-11112222";
    const s3 = "session-2026-07-07-08-00-00-33334444";
    // S spans two date directories: the paged entry must merge them with a per-file date.
    await writeTraceFile(root, P, A, "2026-07-05", S, 1, [userText("a")]);
    await writeTraceFile(root, P, A, "2026-07-06", S, 2, [userText("b")]);
    await writeTraceFile(root, P, A, "2026-07-06", s2, 1, [userText("c")]);
    await writeTraceFile(root, P, A, "2026-07-07", s3, 1, [userText("d")]);

    const page1 = await service.agentTraces(P, A, { offset: 0, limit: 2 }, { includeCli: true });
    expect(page1.totalSessions).toBe(3);
    expect(page1.dates).toEqual([]); // paged responses are session-centric; per-file stats happen only for the slice
    expect(page1.sessions!.map((s) => s.sessionId)).toEqual([s3, s2]);

    const page2 = await service.agentTraces(P, A, { offset: 2, limit: 2 }, { includeCli: true });
    expect(page2.totalSessions).toBe(3);
    expect(page2.sessions!.map((s) => s.sessionId)).toEqual([S]);
    expect(page2.sessions![0]!.files.map((f) => ({ index: f.index, date: f.date }))).toEqual([
      { index: 1, date: "2026-07-05" },
      { index: 2, date: "2026-07-06" },
    ]);
    expect(page2.sessions![0]!.files.every((f) => f.sizeBytes > 0)).toBe(true);

    // Paging an empty Agent stays well-formed.
    const empty = await service.agentTraces(
      P,
      "agent-none",
      { offset: 0, limit: 2 },
      { includeCli: true },
    );
    expect(empty.sessions).toEqual([]);
    expect(empty.totalSessions).toBe(0);
  });

  it("Agent-level paging: the sessions DB title wins over the first-prompt fallback", async () => {
    const withTitles = makeTraceHarness(root, {
      sessions: { listByAgent: () => [dbRow({ sessionId: S, title: "已生成的标题" })] },
    });
    await writeTraceFile(root, P, A, "2026-07-05", S, 1, [
      sessionMeta(metaPayload()),
      userText("raw prompt text"),
    ]);
    const res = await withTitles.service.agentTraces(P, A, { offset: 0, limit: 10 });
    expect(res.sessions![0]!.title).toBe("已生成的标题");
    withTitles.close();
  });

  it("Agent-level paging: category/workspace come from the DB row (archived wins; a registry-known origin fills its bucket)", async () => {
    const s2 = "session-2026-07-06-09-00-00-11112222";
    const s3 = "session-2026-07-07-08-00-00-33334444";
    await writeTraceFile(root, P, A, "2026-07-05", S, 1, [userText("a")]);
    await writeTraceFile(root, P, A, "2026-07-06", s2, 1, [userText("b")]);
    await writeTraceFile(root, P, A, "2026-07-07", s3, 1, [userText("c")]);
    const sources = new SessionSources();
    sources.set(s2, "subagent");
    sources.set(s3, null); // meta seen, user-created
    const h = makeTraceHarness(root, {
      sources,
      sessions: {
        listByAgent: () => [
          dbRow({ sessionId: S, workspace: "/ws/one", archivedAt: "2026-07-08T00:00:00.000Z" }),
          dbRow({ sessionId: s3, workspace: "/ws/two" }),
        ],
      },
    });

    const res = await h.service.agentTraces(P, A, { offset: 0, limit: 10 }, { includeCli: true });
    const byId = new Map(res.sessions!.map((x) => [x.sessionId, x]));
    expect(byId.get(S)!.category).toBe("archived");
    expect(byId.get(S)!.workspace).toBe("/ws/one");
    expect(byId.get(s2)!.category).toBe("subagent"); // untracked but registry-known
    expect(byId.get(s3)!.category).toBe("active");
    expect(res.counts).toEqual({ active: 1, subagent: 1, schedule: 0, archived: 1 });
    expect(res.workspaceCounts!["/ws/one"]).toEqual({
      active: 0,
      subagent: 0,
      schedule: 0,
      archived: 1,
    });
    expect(res.workspaceCounts!["/ws/two"]).toEqual({
      active: 1,
      subagent: 0,
      schedule: 0,
      archived: 0,
    });

    // The category filter pages within one bucket; totalSessions is the bucket's count.
    const active = await h.service.agentTraces(
      P,
      A,
      { offset: 0, limit: 10 },
      { category: "active", includeCli: true },
    );
    expect(active.sessions!.map((x) => x.sessionId)).toEqual([s3]);
    expect(active.totalSessions).toBe(1);
    expect(active.counts).toEqual({ active: 1, subagent: 1, schedule: 0, archived: 1 });
    const archived = await h.service.agentTraces(
      P,
      A,
      { offset: 0, limit: 10 },
      { category: "archived", includeCli: true },
    );
    expect(archived.sessions!.map((x) => x.sessionId)).toEqual([S]);
    h.close();
  });

  it("Agent-level paging: an untracked Session is classified at registration (head-read once), so the FIRST listing is exact", async () => {
    // No DB row, nothing pre-registered: the reconciler registers the file and reads the
    // earliest shard's session_meta ONCE; the listing itself then serves category /
    // workspace / title from the index with no per-request head-reads.
    await writeTraceFile(root, P, A, "2026-07-05", S, 1, [
      sessionMeta(metaPayload({ source: "subagent", workspace: "/ws/child" })),
      userText("child prompt"),
    ]);

    const first = await service.agentTraces(P, A, { offset: 0, limit: 10 }, { includeCli: true });
    expect(first.sessions![0]!.category).toBe("subagent");
    expect(first.sessions![0]!.workspace).toBe("/ws/child");
    expect(first.counts).toEqual({ active: 0, subagent: 1, schedule: 0, archived: 0 });
    // The observation landed in the shared registry (single source of truth) at registration.
    expect(harness.sources.get(S)).toBe("subagent");
    const reads = harness.traceIndex.counters.headReads;

    const second = await service.agentTraces(P, A, { offset: 0, limit: 10 }, { includeCli: true });
    expect(second.sessions![0]!.category).toBe("subagent");
    expect(harness.traceIndex.counters.headReads).toBe(reads); // classification never re-reads
  });

  it("Agent-level paging: CLI-origin Sessions are hidden by default and shown with includeCli (subagent/schedule stay visible)", async () => {
    const cliSid = "session-2026-07-06-09-00-00-11112222"; // untracked, user-created meta -> CLI-origin
    const childSid = "session-2026-07-07-08-00-00-33334444"; // untracked but subagent-origin -> its folder, regardless
    await writeTraceFile(root, P, A, "2026-07-06", cliSid, 1, [
      sessionMeta(metaPayload({ session_id: cliSid })),
      userText("cli run"),
    ]);
    await writeTraceFile(root, P, A, "2026-07-07", childSid, 1, [
      sessionMeta(metaPayload({ session_id: childSid, source: "subagent" })),
      userText("child run"),
    ]);
    const webSid = S;
    await writeTraceFile(root, P, A, "2026-07-05", webSid, 1, [
      sessionMeta(metaPayload()),
      userText("web run"),
    ]);
    const h = makeTraceHarness(root, {
      sessions: { listByAgent: () => [dbRow({ sessionId: webSid, workspace: "/ws/web" })] },
    });

    const hidden = await h.service.agentTraces(P, A, { offset: 0, limit: 10 });
    expect(hidden.sessions!.map((x) => x.sessionId)).toEqual([childSid, webSid]);
    expect(hidden.totalSessions).toBe(2);
    expect(hidden.counts).toEqual({ active: 1, subagent: 1, schedule: 0, archived: 0 });

    const shown = await h.service.agentTraces(P, A, { offset: 0, limit: 10 }, { includeCli: true });
    expect(shown.sessions!.map((x) => x.sessionId)).toEqual([childSid, cliSid, webSid]);
    expect(shown.counts).toEqual({ active: 2, subagent: 1, schedule: 0, archived: 0 });
    h.close();
  });

  it("Agent-level paging: a Session whose head has no user text gets no title (the client falls back to its default)", async () => {
    await writeTraceFile(root, P, A, "2026-07-05", S, 1, [sessionMeta(metaPayload())]);
    const res = await service.agentTraces(P, A, { offset: 0, limit: 10 }, { includeCli: true });
    expect(res.sessions![0]!.title).toBeUndefined();
  });

  it("every endpoint returns empty when there is no Trace", async () => {
    expect(await service.readMessages(P, A, S)).toEqual([]);
    expect(await service.listTraceFiles(P, A, S)).toEqual([]);
    expect((await service.agentTraces(P, A)).dates).toEqual([]);
  });
  it("execution timeline: serial model segments (start = previous event), tool approval/execution phases, the next round anchored on request_begin", async () => {
    const T = (sec: string) => `2026-07-05T10:00:${sec}Z`;
    await writeTraceFile(root, P, A, "2026-07-05", S, 7, [
      sessionMeta(metaPayload()),
      at(T("00.000"), userText("q")), // the user input is sent instantly, so it occupies no segment
      at(T("01.000"), requestBegin()),
      at(T("03.000"), thinkingMessage("think", "completed")),
      at(T("04.000"), toolCall({ name: "exec_command", arguments: "{}", toolCallId: "t1" })),
      // Two async tools: t1 is already in approval/execution while the model keeps decoding t2
      at(T("04.500"), toolCall({ name: "read_file", arguments: "{}", toolCallId: "t2" })),
      at(T("05.000"), requestEnd("completed")),
      at(T("05.500"), approvalDecision("allow", "t1")),
      at(T("06.000"), approvalDecision("allow", "t2")),
      at(T("07.000"), toolCallOutput({ output: "o1", toolCallId: "t1" })),
      at(T("08.000"), toolCallOutput({ output: "o2", toolCallId: "t2" })),
      // The model starts the next round only after all outputs are back: the new segment is anchored on request_begin
      at(T("08.500"), requestBegin()),
      at(T("10.000"), assistantText("answer")),
      at(T("10.100"), requestEnd("completed")),
    ]);
    const a = await service.analyze(P, A, S, 7);

    // A single user turn containing two rounds of Requests (the first calls a
    // tool, the second produces the answer) is merged into the same Task (taskIndex 0).
    expect(a.modelSegments).toEqual([
      { kind: "thinking", startTs: T("01.000"), endTs: T("03.000"), taskIndex: 0 },
      {
        kind: "tool_call",
        startTs: T("03.000"),
        endTs: T("04.000"),
        toolCallId: "t1",
        name: "exec_command",
        taskIndex: 0,
      },
      {
        kind: "tool_call",
        startTs: T("04.000"),
        endTs: T("04.500"),
        toolCallId: "t2",
        name: "read_file",
        taskIndex: 0,
      },
      { kind: "text", startTs: T("08.500"), endTs: T("10.000"), taskIndex: 0 },
    ]);
    expect(a.toolSpans).toEqual([
      {
        toolCallId: "t1",
        name: "exec_command",
        callTs: T("04.000"),
        approvalTs: T("05.500"),
        decision: "allow",
        outputTs: T("07.000"),
        stopReason: "completed",
        taskIndex: 0,
      },
      {
        toolCallId: "t2",
        name: "read_file",
        callTs: T("04.500"),
        approvalTs: T("06.000"),
        decision: "allow",
        outputTs: T("08.000"),
        stopReason: "completed",
        taskIndex: 0,
      },
    ]);
  });

  it("Task grouping: plain text with no further tool call → the next user turn enters a new Task (taskIndex increments)", async () => {
    const T = (sec: string) => `2026-07-05T10:01:${sec}Z`;
    await writeTraceFile(root, P, A, "2026-07-05", S, 9, [
      sessionMeta(metaPayload()),
      // Task 0: one round calls a tool + one round produces the answer.
      at(T("00.000"), userText("q1")),
      at(T("01.000"), requestBegin()),
      at(T("02.000"), toolCall({ name: "read_file", arguments: "{}", toolCallId: "t1" })),
      at(T("02.500"), requestEnd("completed")),
      at(T("03.000"), toolCallOutput({ output: "o", toolCallId: "t1" })),
      at(T("03.500"), requestBegin()),
      at(T("04.000"), assistantText("answer 1")),
      at(T("04.500"), requestEnd("completed")),
      // Task 1: a new user turn (the previous turn ended in plain text, not a continuation).
      at(T("20.000"), userText("q2")),
      at(T("21.000"), requestBegin()),
      at(T("22.000"), assistantText("answer 2")),
      at(T("22.500"), requestEnd("completed")),
    ]);
    const a = await service.analyze(P, A, S, 9);
    expect(a.modelSegments.map((s) => s.taskIndex)).toEqual([0, 0, 1]);
    expect(a.toolSpans.map((s) => s.taskIndex)).toEqual([0]);
    // The first round calls a tool → the continuation round stays in Task 0; after ending in plain text, the new user turn goes into Task 1.
    expect(a.requests.map((r) => r.taskIndex)).toEqual([0, 0, 1]);
  });

  it("MCP connect pair becomes an other-span attached to the following Task", async () => {
    const T = (sec: string) => `2026-07-05T10:04:${sec}Z`;
    await writeTraceFile(root, P, A, "2026-07-05", S, 13, [
      sessionMeta(metaPayload()),
      // First run's bootstrap precedes any request: the pair closes before Task 0 begins.
      at(T("00.000"), mcpConnectBegin(["fx"])),
      at(
        T("01.200"),
        mcpConnectEnd({
          status: "completed",
          results: [
            { server: "fx", transport: "stdio", status: "completed", duration_ms: 1150, tools: 3 },
          ],
        }),
      ),
      at(T("02.000"), requestBegin()),
      at(T("03.000"), assistantText("answer")),
      at(T("03.100"), requestEnd("completed")),
    ]);
    const a = await service.analyze(P, A, S, 13);
    // An "other" span, not a tool span: nothing was called.
    expect(a.toolSpans).toEqual([]);
    expect(a.otherSpans).toEqual([
      {
        key: `mcp-connect-${T("00.000")}`,
        name: "mcp connect",
        startTs: T("00.000"),
        endTs: T("01.200"),
        taskIndex: 0,
      },
    ]);
  });

  it("Task grouping: [user_steering] user texts never start a new Task (steering continuation stays in the same Task)", async () => {
    const T = (sec: string) => `2026-07-05T10:03:${sec}Z`;
    await writeTraceFile(root, P, A, "2026-07-05", S, 12, [
      sessionMeta(metaPayload()),
      // Task 0, round 1: calls a tool; a steering message rides alongside the tool output.
      at(T("00.000"), userText("q1")),
      at(T("01.000"), requestBegin()),
      at(T("02.000"), toolCall({ name: "read_file", arguments: "{}", toolCallId: "t1" })),
      at(T("02.500"), requestEnd("completed")),
      at(T("03.000"), toolCallOutput({ output: "o", toolCallId: "t1" })),
      at(T("03.200"), userText("[user_steering]\nalso check the tests\n[/user_steering]")),
      at(T("03.500"), requestBegin()),
      at(T("04.000"), assistantText("answer 1")),
      at(T("04.500"), requestEnd("completed")),
      // Loop-end steering: the answer round produced no tool call — a plain user text here
      // would start a new Task, but the steering continuation stays in Task 0.
      at(T("05.000"), userText("[user_steering]\none more thing\n[/user_steering]")),
      at(T("05.500"), requestBegin()),
      at(T("06.000"), assistantText("answer 2")),
      at(T("06.500"), requestEnd("completed")),
      // A real new user turn afterwards starts Task 1 as usual.
      at(T("20.000"), userText("q2")),
      at(T("21.000"), requestBegin()),
      at(T("22.000"), assistantText("answer 3")),
      at(T("22.500"), requestEnd("completed")),
    ]);
    const a = await service.analyze(P, A, S, 12);
    expect(a.requests.map((r) => r.taskIndex)).toEqual([0, 0, 0, 1]);
    expect(a.modelSegments.map((s) => s.taskIndex)).toEqual([0, 0, 0, 1]);
  });

  // The Web's live-stream twin of this case lives in stream-model.test.ts.
  it("Task grouping: images sent with a steering message don't start a Task either (a Prompt's do)", async () => {
    const T = (sec: string) => `2026-07-05T10:04:${sec}Z`;
    await writeTraceFile(root, P, A, "2026-07-05", S, 13, [
      sessionMeta(metaPayload()),
      // Task 0: a normal turn that calls a tool.
      at(T("00.000"), userText("q1")),
      at(T("01.000"), requestBegin()),
      at(T("02.000"), toolCall({ name: "read_file", arguments: "{}", toolCallId: "t1" })),
      at(T("02.500"), requestEnd("completed")),
      at(T("03.000"), toolCallOutput({ output: "o", toolCallId: "t1" })),
      // Steering with two images: core delivers them right behind the text, and the whole
      // batch stays inside Task 0 — an image is a turn starter everywhere except here.
      at(T("03.200"), userText("[user_steering]\nlike this mock\n[/user_steering]")),
      at(T("03.300"), imageUrlMessage("data:image/png;base64,AAAA")),
      // A subagent message belongs to another session's stream and says nothing about this
      // one's grouping, so it leaves the window open (the Web skips these even earlier).
      at(T("03.350"), withOrigin(assistantText("child thinking"), "child-1")),
      at(T("03.400"), imageUrlMessage("data:image/png;base64,BBBB")),
      at(T("03.500"), requestBegin()),
      at(T("04.000"), assistantText("answer 1")),
      at(T("04.500"), requestEnd("completed")),
      // An images-only Prompt after all that is a genuine new turn.
      at(T("20.000"), imageUrlMessage("data:image/png;base64,CCCC")),
      at(T("21.000"), requestBegin()),
      at(T("22.000"), assistantText("answer 2")),
      at(T("22.500"), requestEnd("completed")),
    ]);
    const a = await service.analyze(P, A, S, 13);
    expect(a.requests.map((r) => r.taskIndex)).toEqual([0, 0, 1]);
  });

  // Compaction is its own turn: the previous turn called a tool and would
  // otherwise "continue", but compaction_begin breaks that continuation, so the
  // compaction request lands on a new taskIndex. A successful compaction splits
  // the Trace into a new file, so this file ends at compaction_end.
  it("Task grouping: the compaction request isn't folded into the previous turn (successful compaction; this file ends at compaction_end)", async () => {
    const T = (sec: string) => `2026-07-05T10:02:${sec}Z`;
    await writeTraceFile(root, P, A, "2026-07-05", S, 10, [
      sessionMeta(metaPayload()),
      // Task 0: calls a tool, which would normally continue the turn.
      at(T("00.000"), userText("q")),
      at(T("01.000"), requestBegin()),
      at(T("02.000"), toolCall({ name: "read_file", arguments: "{}", toolCallId: "t1" })),
      at(T("02.500"), requestEnd("completed")),
      at(T("03.000"), toolCallOutput({ output: "o", toolCallId: "t1" })),
      // Task 1: the compaction request.
      at(
        T("04.000"),
        compactionBegin({ reason: "context", mode: "summarize", context: 1, turns: 1 }),
      ),
      at(T("04.500"), requestBegin()),
      at(T("05.000"), assistantText("[summary]…[/summary]")),
      at(T("05.500"), requestEnd("completed")),
      at(T("06.000"), compactionEnd({ reason: "context", mode: "summarize", status: "completed" })),
    ]);
    const a = await service.analyze(P, A, S, 10);
    expect(a.modelSegments.map((s) => s.taskIndex)).toEqual([0, 1]);
    expect(a.toolSpans.map((s) => s.taskIndex)).toEqual([0]);
    expect(a.requests.map((r) => r.taskIndex)).toEqual([0, 1]);
    expect(a.compactionCount).toBe(1);
  });

  // A failed compaction doesn't split the file: the continuation request is
  // still in the same file, and it starts a new turn (the compaction request
  // doesn't call a tool, and request_end has already broken continuation).
  it("Task grouping: the continuation request after a failed compaction starts a new turn", async () => {
    const T = (sec: string) => `2026-07-05T10:03:${sec}Z`;
    await writeTraceFile(root, P, A, "2026-07-05", S, 11, [
      sessionMeta(metaPayload()),
      at(T("00.000"), userText("q")),
      at(T("01.000"), requestBegin()),
      at(T("02.000"), toolCall({ name: "read_file", arguments: "{}", toolCallId: "t1" })),
      at(T("02.500"), requestEnd("completed")),
      at(T("03.000"), toolCallOutput({ output: "o", toolCallId: "t1" })),
      at(
        T("04.000"),
        compactionBegin({ reason: "context", mode: "summarize", context: 1, turns: 1 }),
      ),
      at(T("04.500"), requestBegin()),
      at(T("05.000"), assistantText("bad summary")),
      at(T("05.500"), requestEnd("failed")),
      at(T("06.000"), compactionEnd({ reason: "context", mode: "summarize", status: "failed" })),
      at(T("07.000"), requestBegin()),
      at(T("08.000"), assistantText("answer")),
      at(T("08.500"), requestEnd("completed")),
    ]);
    const a = await service.analyze(P, A, S, 11);
    expect(a.modelSegments.map((s) => s.taskIndex)).toEqual([0, 1, 2]);
    expect(a.toolSpans.map((s) => s.taskIndex)).toEqual([0]);
  });

  it("interrupt-compensation tool_calls (stop_reason not completed) stay out of the timeline lanes (no phantom execution segments)", async () => {
    const T = (sec: string) => `2026-07-05T10:00:${sec}Z`;
    await writeTraceFile(root, P, A, "2026-07-05", S, 8, [
      sessionMeta(metaPayload()),
      at(T("00.000"), userText("q")),
      at(T("01.000"), requestBegin()),
      at(
        T("02.000"),
        toolCall({
          name: "exec_command",
          arguments: "{}",
          toolCallId: "t1",
          stopReason: "timeout",
        }),
      ),
      at(T("02.500"), requestEnd("timeout")),
      at(T("03.000"), requestBegin()),
      at(T("04.000"), toolCall({ name: "read_file", arguments: "{}", toolCallId: "t2" })),
      at(T("04.500"), toolCallOutput({ output: "ok", toolCallId: "t2" })),
      at(T("05.000"), requestEnd("completed")),
    ]);
    const a = await service.analyze(P, A, S, 8);
    // A phantom call gets no lane: only t2 goes into toolSpans.
    expect(a.toolSpans.map((sp) => sp.toolCallId)).toEqual(["t2"]);
    // But the duration list still records t1 (flagged with the interrupted status).
    expect(a.toolCalls.find((c) => c.toolCallId === "t1")?.stopReason).toBe("timeout");
  });
});
