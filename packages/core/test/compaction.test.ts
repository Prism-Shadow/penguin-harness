/**
 * Context compaction tests.
 *
 * - Trigger: context usage (the request.total of the most recent token_usage) or the session's
 *   cumulative turn count **reaching** the threshold (>=); the check runs after every LLM
 *   request emits token_usage, both mid-task and at the wrap-up round (reaching the threshold at
 *   task end triggers compaction immediately, without waiting for the next task).
 * - summarize: appends a compaction prompt to the old LLM (merging in all of this round's tool
 *   results first if mid-task); the summary is wrapped as a `[context_summary]` user text and fed
 *   as the first input to the new LLM instance. The compaction request carries the session's
 *   toolset unchanged (the prompt-cache prefix must stay byte-identical, #84). Each committed
 *   response is a summary, a round or empty; the harness counts the rounds and answers a
 *   response that advanced nothing with a corrective line (at most two), and transport failures
 *   take the reconnect ladder. When no summary can be had the next context opens with a
 *   salvaged summary or a hand-off note, and the compaction still completes: only a stop or a
 *   next context that cannot be opened keeps the old one.
 * - discard: deferred until task end if mid-task; sends no compaction request, just swaps in a new LLM instance directly.
 * - Process visibility: the compaction's requests, their text and every tool call stream between
 *   the paired compaction events; the Prompt and the harness lines stay in the old trace, and on
 *   completion the trace rotates into a new file (index+1, the new file starts with session_meta;
 *   rotation is deferred until the new context has its first message to write).
 * - Thinking level: the compaction request goes out at the Session's live level like a turn, and
 *   its Trace-only `request_begin` records that level; with no pin and no default nothing is sent
 *   and nothing is recorded.
 */
import { mkdtemp, rm, access, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assistantText,
  compactionBegin,
  compactionEnd,
  mcpConnectBegin,
  mcpConnectEnd,
  partialText,
  partialThinking,
  requestBegin,
  requestEnd,
  sessionMeta,
  thinkingMessage,
  tokenUsage,
  toolCall,
  toolCallOutput,
  toolListReady,
  userText,
} from "@prismshadow/amsp/records";
import type {
  CompactionBeginPayload,
  CompactionEndPayload,
  AmspRecord,
  RequestEndPayload,
  SessionMetaPayload,
  TextPayload,
  TokenUsagePayload,
} from "@prismshadow/amsp/records";
import type {
  ApproveFn,
  EnvironmentInterface,
  GenerativeModelParameters,
  LLMInterface,
  LLMOutcome,
  ThinkingLevelName,
} from "../src/interfaces/index.js";
import { ContextEngine } from "../src/engine/context-engine.js";
import { Session } from "../src/session.js";
import type { CompactionSettings, CompactionToolGate } from "../src/engine/context-engine.js";
import { GenerativeModel } from "../src/llm/index.js";
import type { UniConfig, UniEvent, UniMessage } from "@prismshadow/mmsp";
import {
  buildContextSummaryText,
  transcribeRequestError,
  transcribeToolCallOutput,
  transcribeUserInput,
} from "@prismshadow/amsp/markers";
import { Writer, readTrace, resumeTrace } from "../src/trace/index.js";
import { compactionToolGate } from "../src/internal/compaction-tool-gate.js";
import { buildCompactionHandoff } from "../src/engine/compaction-carry.js";
import {
  CLOSED_LINE,
  EMPTY_LINE,
  REFUSED_NO_ROUND,
  TRUNCATED_LINE,
  roundLine,
} from "../src/engine/compaction-lines.js";
import { REJECTED_IMAGE_NOTE } from "../src/engine/rejected-images.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

interface ScriptedResponse {
  messages: AmspRecord[];
  outcome?: LLMOutcome;
}

/** Fake LLM that responds according to a script, recording each input it receives. */
class ScriptedLLM implements LLMInterface {
  calls: AmspRecord[][] = [];
  /** The per-request thinking level of each call, in the same order as `calls`. */
  levels: (ThinkingLevelName | undefined)[] = [];
  constructor(
    private readonly responses: ScriptedResponse[],
    readonly label = "llm",
    readonly defaultThinkingLevel?: ThinkingLevelName,
  ) {}

  async *streamGenerate(params: GenerativeModelParameters): AsyncGenerator<AmspRecord, LLMOutcome> {
    this.calls.push(params.newMessages);
    this.levels.push(params.thinkingLevel);
    const next = this.responses.shift();
    if (!next) {
      return { status: "retryable", errorMessage: `${this.label}: no scripted response` };
    }
    for (const msg of next.messages) yield msg;
    return next.outcome ?? { status: "completed" };
  }
}

/** Fake Environment that never runs real commands: any tool call returns a fixed output. */
const fakeEnvironment: EnvironmentInterface = {
  async listTools() {
    return [];
  },
  async *executeTool({ toolCall: tc }) {
    yield toolCallOutput({
      output: "tool ran",
      toolCallId: tc.payload.tool_call_id,
      status: "completed",
    });
  },
  toolPermission() {
    return "rw";
  },
};

const allowAll: ApproveFn = async () => "allow";

/** Builds a token_usage: request.total is the context-usage figure, session.total is the cumulative one. */
const usage = (requestTotal: number, sessionTotal: number): AmspRecord =>
  tokenUsage(
    { cache_read: 0, cache_write: 0, output: 0, total: sessionTotal },
    { cache_read: 0, cache_write: 0, output: 0, total: requestTotal },
  );

const settings = (over: Partial<CompactionSettings> = {}): CompactionSettings => ({
  maxContextLength: 100,
  maxSessionTurns: -1,
  mode: "summarize",
  prompt: "COMPACT NOW",
  ...over,
});

const metaMessage = sessionMeta({
  session_id: "sess_compact",
  provider: "custom",
  model_id: "test-model",
  model_context_window: 200000,
  system_prompt: "sp",
  agent_state: "/tmp/state",
  workspace: "/tmp/ws",
  source: "user",
});

async function collect(gen: AsyncGenerator<AmspRecord>): Promise<AmspRecord[]> {
  const all: AmspRecord[] = [];
  for await (const msg of gen) all.push(msg);
  return all;
}

/** Like collect, but also captures the run generator's return value (RunCutoff | null). */
async function collectWithReturn<R>(
  gen: AsyncGenerator<AmspRecord, R>,
): Promise<{ all: AmspRecord[]; cutoff: R }> {
  const all: AmspRecord[] = [];
  for (;;) {
    const res = await gen.next();
    if (res.done) return { all, cutoff: res.value };
    all.push(res.value);
  }
}

type CompactionEventPayload = CompactionBeginPayload | CompactionEndPayload;

const compactionEvents = (msgs: AmspRecord[]): CompactionEventPayload[] =>
  msgs
    .filter((m) => {
      const t = (m.payload as { type?: string }).type ?? "";
      return t === "compaction_begin" || t === "compaction_end";
    })
    .map((m) => m.payload as CompactionEventPayload);

const payloadTypes = (msgs: AmspRecord[]): (string | undefined)[] =>
  msgs.map((m) => (m.payload as { type?: string }).type);

const textOf = (m: AmspRecord): string => (m.payload as TextPayload).text;

/** The last compaction_end on a stream. */
const endOf = (msgs: AmspRecord[]): CompactionEndPayload =>
  compactionEvents(msgs).findLast((e) => e.type === "compaction_end") as CompactionEndPayload;

/** The hand-off note the engine opens with when no builder is given (the bare one). */
const bareNote = (tracePath?: string): string =>
  buildCompactionHandoff([], tracePath !== undefined ? { tracePath } : {});

/** A summary long enough to be salvaged when its reply does not finish. */
const longSummary = (label: string, length: number): string =>
  `## Request\n${label} ${"x".repeat(length)}`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("context compaction", () => {
  let traces: string;

  beforeEach(async () => {
    traces = await mkdtemp(join(tmpdir(), "penguin-compaction-"));
  });

  afterEach(async () => {
    await rm(traces, { recursive: true, force: true });
  });

  it("summarize at task boundary: paired events, hidden dialogue, trace rotation, summary joins next prompt", async () => {
    const llm1 = new ScriptedLLM(
      [
        // Task 1's final reply: context usage 150 > threshold 100 -> triggers at the boundary.
        { messages: [assistantText("answer one"), usage(150, 150)] },
        // Compaction request: summary + usage (counted into the session cumulative total).
        {
          messages: [assistantText("[summary]the distilled summary[/summary]"), usage(160, 310)],
        },
      ],
      "llm1",
    );
    const llm2 = new ScriptedLLM(
      [{ messages: [assistantText("answer two"), usage(20, 330)] }],
      "llm2",
    );
    const trace = new Writer({ tracesDir: traces, sessionId: "sess_compact" });
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      trace,
      sessionMeta: metaMessage,
      compaction: settings(),
      openNextContext: () => ({ llm: llm2 }),
    });
    const oldPath = trace.currentPath();

    const out1 = await collect(engine.run([userText("task one")], { approve: allowAll }));

    // Paired compaction events: start carries reason/mode/context/turns, stop carries status.
    const events = compactionEvents(out1);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      type: "compaction_begin",
      reason: "context",
      mode: "summarize",
      context: 150,
      turns: 1,
    });
    expect(events[1]).toMatchObject({ type: "compaction_end", status: "completed" });
    // The compaction request's own input is invisible to the human: the compaction prompt is
    // never pushed to the output stream.
    const texts = out1.filter((m) => (m.payload as { type?: string }).type === "text").map(textOf);
    expect(texts.some((t) => t.includes("COMPACT NOW"))).toBe(false);
    // Two exceptions ride the stream between the paired compaction events: the compaction
    // request's token_usage (the frontend counts it in stats), and the summary being written
    // (issue #290 — this LLM yields only complete messages, so the complete text streams).
    const types1 = payloadTypes(out1);
    const between = out1.slice(
      types1.indexOf("compaction_begin") + 1,
      types1.lastIndexOf("compaction_end"),
    );
    const usageBetween = between.filter(
      (m) => (m.payload as { type?: string }).type === "token_usage",
    );
    expect(usageBetween).toHaveLength(1);
    expect((usageBetween[0]!.payload as TokenUsagePayload).request.total).toBe(160);
    const textBetween = between
      .filter((m) => (m.payload as { type?: string }).type === "text")
      .map(textOf);
    expect(textBetween).toEqual(["[summary]the distilled summary[/summary]"]);

    // The summary is merged with the next user prompt as the new LLM instance's first input.
    const out2 = await collect(engine.run([userText("task two")], { approve: allowAll }));
    // The engine authors the session series itself: the new context's token_usage continues
    // from 310 (compaction request usage included) — nothing is seeded on the LLM object.
    const usage2 = out2.find((m) => (m.payload as { type?: string }).type === "token_usage")!;
    expect((usage2.payload as TokenUsagePayload).session.total).toBe(330);
    expect(llm1.calls).toHaveLength(2);
    expect(llm2.calls).toHaveLength(1);
    const firstInput = llm2.calls[0]!.map(textOf);
    // With a Trace, the summary ends with the trailer naming the closed file.
    expect(firstInput[0]).toBe(
      buildContextSummaryText("the distilled summary", { tracePath: oldPath }),
    );
    expect(firstInput[1]).toBe("task two");

    // Trace splits into files: the old file contains the compaction dialogue and paired events; the new file starts with session_meta.
    const oldTrace = await readTrace(oldPath);
    const oldTypes = payloadTypes(oldTrace);
    expect(oldTypes.filter((t) => t?.startsWith("compaction_"))).toHaveLength(2);
    expect(oldTrace.some((m) => (m.payload as { text?: string }).text === "COMPACT NOW")).toBe(
      true,
    );
    const newTrace = await readTrace(trace.currentPath());
    expect(trace.currentPath()).not.toBe(oldPath);
    expect(newTrace[0]!.type).toBe("session_meta");
    // The opened context brought no meta of its own, so the new file repeats the first one's.
    expect(newTrace[0]!.payload).toEqual(metaMessage.payload);
    expect(
      newTrace.some((m) =>
        ((m.payload as { text?: string }).text ?? "").startsWith("[context_summary]"),
      ),
    ).toBe(true);
  });

  it("carries no thinking level when the Session has no pin, on a turn or a compaction", async () => {
    // The pinned half of the rule is engine.test.ts's "applies setThinkingLevel to every
    // request of the Session". This is the other half: with no pin and no construction default
    // on the LLM object the request says nothing at all, so the provider default stands. The
    // engine must not invent one for either kind of request — on the wire or in the Trace.
    const llm1 = new ScriptedLLM(
      [
        { messages: [assistantText("answer one"), usage(150, 150)] },
        { messages: [assistantText("[summary]the distilled summary[/summary]"), usage(160, 310)] },
      ],
      "llm1",
    );
    const llm2 = new ScriptedLLM([{ messages: [assistantText("answer two"), usage(20, 330)] }]);
    const trace = new Writer({ tracesDir: traces, sessionId: "sess_compact_nolevel" });
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      trace,
      sessionMeta: metaMessage,
      compaction: settings(),
      openNextContext: () => ({ llm: llm2 }),
    });
    const oldPath = trace.currentPath();

    await collect(engine.run([userText("task one")], { approve: allowAll }));

    expect(llm1.levels).toEqual([undefined, undefined]);
    const begins = (await readTrace(oldPath)).filter(
      (m) => (m.payload as { type?: string }).type === "request_begin",
    );
    expect(begins).toHaveLength(2);
    expect(begins.every((m) => !("thinking_level" in m.payload))).toBe(true);
  });

  it("the compaction request's Trace-only request_begin records the pinned level it went out at", async () => {
    // The LLM object's default is medium; the Session pins high before the run. The turn and
    // the compaction request both go out at high, and the old file says so for both.
    const llm1 = new ScriptedLLM(
      [
        { messages: [assistantText("answer one"), usage(150, 150)] },
        { messages: [assistantText("[summary]the distilled summary[/summary]"), usage(160, 310)] },
      ],
      "llm1",
      "medium",
    );
    const llm2 = new ScriptedLLM([{ messages: [assistantText("answer two"), usage(20, 330)] }]);
    const trace = new Writer({ tracesDir: traces, sessionId: "sess_compact_pinned" });
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      trace,
      sessionMeta: metaMessage,
      compaction: settings(),
      openNextContext: () => ({ llm: llm2 }),
    });
    const oldPath = trace.currentPath();
    engine.setThinkingLevel("high");

    const out = await collect(engine.run([userText("task one")], { approve: allowAll }));

    expect(compactionEvents(out).at(-1)).toMatchObject({ status: "completed" });
    expect(llm1.levels).toEqual(["high", "high"]);
    const levels = (await readTrace(oldPath))
      .filter((m) => (m.payload as { type?: string }).type === "request_begin")
      .map((m) => (m.payload as { thinking_level?: string }).thinking_level);
    expect(levels).toEqual(["high", "high"]);
  });

  it("the rotated Trace file opens with the meta the new context was opened with, and a later context without one keeps it", async () => {
    // The composition layer re-assembles the system prompt for each context and hands the
    // engine the session_meta recording it: that meta — not the Session's first — is what the
    // rotated file must start with, so every file's head describes the context it records.
    const llm1 = new ScriptedLLM(
      [
        { messages: [assistantText("answer one"), usage(150, 150)] },
        { messages: [assistantText("[summary]one[/summary]"), usage(160, 310)] },
      ],
      "llm1",
    );
    const llm2 = new ScriptedLLM(
      [
        { messages: [assistantText("answer two"), usage(150, 460)] },
        { messages: [assistantText("[summary]two[/summary]"), usage(160, 620)] },
      ],
      "llm2",
    );
    const llm3 = new ScriptedLLM(
      [{ messages: [assistantText("answer three"), usage(20, 640)] }],
      "llm3",
    );
    const refreshed = sessionMeta({
      ...(metaMessage.payload as SessionMetaPayload),
      system_prompt: "sp re-assembled for context two",
    });
    const trace = new Writer({ tracesDir: traces, sessionId: "sess_meta_rotation" });
    let opened = 0;
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      trace,
      sessionMeta: metaMessage,
      compaction: settings(),
      // Context two brings its meta; context three brings none (an opener that could not
      // re-assemble) and must inherit context two's, not fall back to the Session's first.
      openNextContext: async () => {
        opened += 1;
        return opened === 1 ? { llm: llm2, sessionMeta: refreshed } : { llm: llm3 };
      },
    });
    const firstPath = trace.currentPath();

    await collect(engine.run([userText("task one")], { approve: allowAll }));
    await collect(engine.run([userText("task two")], { approve: allowAll }));
    const secondPath = trace.currentPath();
    expect(secondPath).not.toBe(firstPath);
    const second = await readTrace(secondPath);
    expect(second[0]!.type).toBe("session_meta");
    expect((second[0]!.payload as SessionMetaPayload).system_prompt).toBe(
      "sp re-assembled for context two",
    );

    await collect(engine.run([userText("task three")], { approve: allowAll }));
    const thirdPath = trace.currentPath();
    expect(thirdPath).not.toBe(secondPath);
    const third = await readTrace(thirdPath);
    expect(third[0]!.type).toBe("session_meta");
    expect((third[0]!.payload as SessionMetaPayload).system_prompt).toBe(
      "sp re-assembled for context two",
    );
    expect(opened).toBe(2);
  });

  it("the compaction_end stays in the old file and the opener's records follow it on the stream and head the new file after the meta; a context that publishes none keeps the previous records", async () => {
    const llm1 = new ScriptedLLM(
      [
        { messages: [assistantText("answer one"), usage(150, 150)] },
        { messages: [assistantText("[summary]one[/summary]"), usage(160, 310)] },
      ],
      "llm1",
    );
    const llm2 = new ScriptedLLM(
      [
        { messages: [assistantText("answer two"), usage(150, 460)] },
        { messages: [assistantText("[summary]two[/summary]"), usage(160, 620)] },
      ],
      "llm2",
    );
    const llm3 = new ScriptedLLM(
      [{ messages: [assistantText("answer three"), usage(20, 640)] }],
      "llm3",
    );
    const firstToolList = toolListReady([{ name: "old_tool", description: "context one's" }]);
    const connectBegin = mcpConnectBegin(["fx"]);
    const connectEnd = mcpConnectEnd({ status: "completed", results: [] });
    const newToolList = toolListReady([{ name: "new_tool", description: "context two's" }]);
    const trace = new Writer({ tracesDir: traces, sessionId: "sess_records" });
    let opened = 0;
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      trace,
      sessionMeta: metaMessage,
      toolList: firstToolList,
      // What the Session hands a first run: the (here empty) connect pair, so the first
      // context's toolset record takes the bootstrap path — after the input, not at a head.
      bootstrapRecords: [],
      compaction: settings(),
      openNextContext: async ({ emit }) => {
        opened += 1;
        if (opened === 2) return { llm: llm3 };
        emit(connectBegin);
        await new Promise((resolve) => setTimeout(resolve, 20));
        emit(connectEnd);
        emit(newToolList);
        return { llm: llm2 };
      },
    });
    const firstPath = trace.currentPath();

    const out1 = await collect(engine.run([userText("task one")], { approve: allowAll }));
    // The compaction is declared complete once the context is open: the records follow the
    // compaction_end on the stream, in publication order.
    const types = payloadTypes(out1);
    expect(types.slice(types.lastIndexOf("compaction_end") + 1)).toEqual([
      "mcp_connect_begin",
      "mcp_connect_end",
      "tool_list_ready",
    ]);
    // The end closes the old file; the opener's records are not in it.
    const closed = payloadTypes(await readTrace(firstPath));
    expect(closed.at(-1)).toBe("compaction_end");
    expect(closed).not.toContain("mcp_connect_begin");

    // Trace: the rotated file opens with the meta, then exactly those records, then the
    // context's first input (the summary).
    await collect(engine.run([userText("task two")], { approve: allowAll }));
    const secondPath = trace.currentPath();
    expect(secondPath).not.toBe(firstPath);
    const second = await readTrace(secondPath);
    expect(second[0]!.type).toBe("session_meta");
    expect(payloadTypes(second.slice(1, 4))).toEqual([
      "mcp_connect_begin",
      "mcp_connect_end",
      "tool_list_ready",
    ]);
    expect((second[3]!.payload as { tools: { name: string }[] }).tools[0]!.name).toBe("new_tool");
    expect(textOf(second[4]!)).toContain("[context_summary]");
    // The first file's toolset record rode the first run's bootstrap path (after the input),
    // and it is the first context's — the new one never leaks backwards.
    const first = await readTrace(firstPath);
    expect(payloadTypes(first.slice(0, 2))).toEqual(["text", "tool_list_ready"]);
    expect((first[1]!.payload as { tools: { name: string }[] }).tools[0]!.name).toBe("old_tool");
    expect(payloadTypes(first).filter((t) => t === "tool_list_ready")).toHaveLength(1);

    // Context three's opener published nothing (it could not re-read the Agent State): the
    // third file repeats context two's records, never falls back to the first context's.
    await collect(engine.run([userText("task three")], { approve: allowAll }));
    const thirdPath = trace.currentPath();
    expect(thirdPath).not.toBe(secondPath);
    const third = await readTrace(thirdPath);
    expect(third[0]!.type).toBe("session_meta");
    expect(payloadTypes(third.slice(1, 4))).toEqual([
      "mcp_connect_begin",
      "mcp_connect_end",
      "tool_list_ready",
    ]);
    expect((third[3]!.payload as { tools: { name: string }[] }).tools[0]!.name).toBe("new_tool");
    expect(opened).toBe(2);
  });

  it("an opener that throws ends the compaction fatal with its message, keeps the old context current with no rotation pending, and the write it answered leads the next request", async () => {
    const scratch = join(traces, "scratchpad");
    const llm1 = new ScriptedLLM(
      [
        { messages: [assistantText("answer one"), usage(150, 150)] },
        // A summary with a hand-off write: committed, and the write's output is owed to it.
        {
          messages: [
            assistantText("[summary]one[/summary]"),
            toolCall({
              name: "write_file",
              arguments: JSON.stringify({ file_path: join(scratch, "handoff", "a.md") }),
              toolCallId: "w1",
            }),
            usage(160, 310),
          ],
        },
        { messages: [assistantText("still the old context"), usage(20, 330)] },
      ],
      "llm1",
    );
    const trace = new Writer({ tracesDir: traces, sessionId: "sess_opener_throws" });
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      trace,
      sessionMeta: metaMessage,
      compaction: settings({ maxRounds: 3 }),
      compactionToolGate: compactionToolGate(scratch),
      openNextContext: () => {
        throw new Error("Invalid Agent State config");
      },
    });
    const firstPath = trace.currentPath();

    const { all, cutoff } = await collectWithReturn(
      engine.run([userText("task one")], { approve: allowAll }),
    );

    expect(cutoff).toBeNull();
    expect(endOf(all)).toMatchObject({
      status: "fatal",
      error_message: "Invalid Agent State config",
    });
    expect(endOf(all).error_code).toBeUndefined();
    expect(engine.compactability()).toBe("ok");
    // The old LLM object is still current and nothing rotates: the next run appends to the
    // same file, goes to the same object, and answers the committed call first.
    const out = await collect(engine.run([userText("task two")], { approve: allowAll }));
    expect(out.map((m) => (m.payload as { text?: string }).text)).toContain(
      "still the old context",
    );
    expect(trace.currentPath()).toBe(firstPath);
    expect(llm1.calls).toHaveLength(3);
    expect(payloadTypes(llm1.calls[2]!)).toEqual(["tool_call_output", "text"]);
    expect(llm1.calls[2]![0]!.payload).toMatchObject({ tool_call_id: "w1", status: "completed" });
  });

  it("mid-Task, an opener that throws ends the run with compaction_failure and the turn's outputs carried over", async () => {
    const llm1 = new ScriptedLLM(
      [
        { messages: [toolCall({ name: "t", arguments: "{}", toolCallId: "c1" }), usage(150, 150)] },
        // Refused outright: nothing committed, so the turn's output is still owed.
        { messages: [], outcome: { status: "fatal", errorCode: "rejected", errorMessage: "no" } },
        { messages: [assistantText("on the old context"), usage(60, 400)] },
      ],
      "llm1",
    );
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      compaction: settings(),
      openNextContext: () => {
        throw new Error("no client for the model");
      },
    });

    const { all, cutoff } = await collectWithReturn(
      engine.run([userText("go")], { approve: allowAll }),
    );

    expect(cutoff).toEqual({ kind: "compaction_failure", errorMessage: "no client for the model" });
    expect(endOf(all)).toMatchObject({ status: "fatal", error_message: "no client for the model" });
    expect(payloadTypes(all)).not.toContain("abort");
    await collect(engine.run([userText("carry on")], { approve: allowAll }));
    expect(payloadTypes(llm1.calls[2]!)).toEqual(["tool_call_output", "text"]);
    expect((llm1.calls[2]![0]!.payload as { tool_call_id?: string }).tool_call_id).toBe("c1");
    expect(textOf(llm1.calls[2]![1]!)).toBe("carry on");
  });

  it("an opened context's maxTurns and compaction settings replace the engine's from then on", async () => {
    // Context one compacts at 100. The opened context raises the threshold to 1000 and caps a
    // Task at one turn: task two's 150-token turn must not compact again, and its tool call
    // must end the Task at the cap instead of being followed up.
    const llm1 = new ScriptedLLM(
      [
        { messages: [assistantText("answer one"), usage(150, 150)] },
        { messages: [assistantText("[summary]one[/summary]"), usage(160, 310)] },
      ],
      "llm1",
    );
    const llm2 = new ScriptedLLM(
      [
        {
          messages: [toolCall({ name: "t", arguments: "{}", toolCallId: "c1" }), usage(150, 460)],
        },
        { messages: [assistantText("never requested"), usage(10, 470)] },
      ],
      "llm2",
    );
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      compaction: settings(),
      openNextContext: () => ({
        llm: llm2,
        maxTurns: 1,
        compaction: settings({ maxContextLength: 1000 }),
      }),
    });

    await collect(engine.run([userText("task one")], { approve: allowAll }));
    const out = await collect(engine.run([userText("task two")], { approve: allowAll }));
    expect(compactionEvents(out)).toEqual([]);
    expect(
      out.some(
        (m) =>
          (m.payload as { type?: string; error_code?: string }).type === "abort" &&
          (m.payload as { error_code?: string }).error_code === "max_turns",
      ),
    ).toBe(true);
    expect(llm2.calls).toHaveLength(1);
  });

  it("a live threshold lowered on disk compacts at the next checkpoint, with no rotation in between", async () => {
    // Compaction configuration is live tier: the engine asks `readCompaction` at every
    // checkpoint, so lowering the threshold under a running conversation takes effect on its
    // next request instead of waiting for a context to rotate.
    const llm1 = new ScriptedLLM(
      [
        { messages: [assistantText("answer one"), usage(150, 150)] },
        { messages: [assistantText("answer two"), usage(150, 300)] },
        { messages: [assistantText("[summary]lowered[/summary]"), usage(10, 310)] },
      ],
      "llm1",
    );
    const llm2 = new ScriptedLLM([], "llm2");
    let threshold = 1000;
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      compaction: settings({ maxContextLength: threshold }),
      readCompaction: () => settings({ maxContextLength: threshold }),
      openNextContext: () => ({ llm: llm2 }),
    });

    // 150 tokens against a 1000-token threshold: nothing fires, and the context stays open.
    const out1 = await collect(engine.run([userText("task one")], { approve: allowAll }));
    expect(compactionEvents(out1)).toEqual([]);

    threshold = 100;
    const out2 = await collect(engine.run([userText("task two")], { approve: allowAll }));
    const events = compactionEvents(out2);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: "compaction_begin", reason: "context" });
    expect(events[1]).toMatchObject({ type: "compaction_end", status: "completed" });
    // Turn one, turn two, then the compaction request — all on the SAME context: the lowered
    // threshold was picked up without an opener ever running before it.
    expect(llm1.calls).toHaveLength(3);
  });

  it("a readCompaction that throws leaves the settings already in force", async () => {
    const llm1 = new ScriptedLLM(
      [
        { messages: [assistantText("answer one"), usage(150, 150)] },
        { messages: [assistantText("[summary]kept[/summary]"), usage(10, 160)] },
      ],
      "llm1",
    );
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      compaction: settings(),
      readCompaction: () => {
        throw new Error("config unreadable");
      },
      openNextContext: () => ({ llm: new ScriptedLLM([], "llm2") }),
    });

    const out = await collect(engine.run([userText("task one")], { approve: allowAll }));
    // The failed read neither ends the run nor changes the threshold: 150 still reaches the
    // static 100, and the static prompt is still what the compaction request carries.
    expect(compactionEvents(out)).toMatchObject([
      { type: "compaction_begin", reason: "context" },
      { type: "compaction_end", status: "completed" },
    ]);
    expect(llm1.calls[1]!.map(textOf).join("\n")).toContain("COMPACT NOW");
  });

  it("summarize mid-task: tool outputs pair into the compaction request, summary alone feeds the new LLM", async () => {
    const llm1 = new ScriptedLLM(
      [
        // Round 1: tool call + over-threshold usage -> triggers mid-task.
        {
          messages: [toolCall({ name: "t", arguments: "{}", toolCallId: "c1" }), usage(150, 150)],
        },
        // Compaction request (should include c1's tool_call_output plus the compaction prompt).
        { messages: [assistantText("[summary]continue: finish step 2[/summary]")] },
      ],
      "llm1",
    );
    const llm2 = new ScriptedLLM(
      [{ messages: [assistantText("task done"), usage(30, 200)] }],
      "llm2",
    );
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      sessionMeta: metaMessage,
      compaction: settings(),
      openNextContext: () => ({ llm: llm2 }),
    });

    const out = await collect(engine.run([userText("do task")], { approve: allowAll }));

    // Compaction request: all of this round's tool results, paired with their tool_calls, are sent to the old instance along with the compaction prompt.
    expect(llm1.calls).toHaveLength(2);
    const compactionInput = llm1.calls[1]!;
    const inputTypes = payloadTypes(compactionInput);
    expect(inputTypes).toEqual(["tool_call_output", "text"]);
    expect((compactionInput[1]!.payload as TextPayload).text).toBe("COMPACT NOW");

    // The summary itself is the new instance's first input (no hardcoded continuation instruction appended); the task is finished by the new context.
    expect(llm2.calls).toHaveLength(1);
    expect(llm2.calls[0]!.map(textOf)).toEqual([
      "[context_summary]\ncontinue: finish step 2\n[/context_summary]",
    ]);
    const finalTexts = out
      .filter((m) => (m.payload as { type?: string }).type === "text")
      .map(textOf);
    expect(finalTexts).toContain("task done");
    expect(compactionEvents(out).map((e) => e.type)).toEqual([
      "compaction_begin",
      "compaction_end",
    ]);
  });

  it("a fatal first request completes the compaction with a hand-off note at once, with no retry; mid-Task the next request goes to the new model object and carries the note", async () => {
    const llm1 = new ScriptedLLM(
      [
        {
          messages: [toolCall({ name: "t", arguments: "{}", toolCallId: "c1" }), usage(150, 150)],
        },
        // The provider refuses the compaction request outright (the context is too long).
        {
          messages: [],
          outcome: { status: "fatal", errorCode: "rejected", errorMessage: "prompt is too long" },
        },
      ],
      "llm1",
    );
    const llm2 = new ScriptedLLM(
      [{ messages: [assistantText("finished on the new context"), usage(30, 200)] }],
      "llm2",
    );
    const trace = new Writer({ tracesDir: traces, sessionId: "sess_handoff" });
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      trace,
      sessionMeta: metaMessage,
      compaction: settings(),
      openNextContext: () => ({ llm: llm2 }),
      // A wait would show here: a fatal request is not retried.
      reconnectBackoffMs: 60_000,
    });
    const oldPath = trace.currentPath();

    const { all, cutoff } = await collectWithReturn(
      engine.run([userText("go")], { approve: allowAll }),
    );

    expect(cutoff).toBeNull();
    expect(llm1.calls).toHaveLength(2);
    // Completed — with the reason it had to fall back.
    expect(endOf(all)).toMatchObject({
      status: "completed",
      attempt: 1,
      error_code: "rejected",
      error_message: "prompt is too long",
    });
    // The Task carried on in the new context, which opened with the note naming the old file.
    expect(llm2.calls[0]!.map(textOf)).toEqual([bareNote(oldPath)]);
    expect(all.map((m) => (m.payload as { text?: string }).text)).toContain(
      "finished on the new context",
    );
    const opened = await readTrace(trace.currentPath());
    expect(trace.currentPath()).not.toBe(oldPath);
    expect(textOf(opened[1]!)).toBe(bareNote(oldPath));
  });

  it("a rejected compaction request whose input holds an image is sent once more with the image replaced", async () => {
    const imageEnvironment: EnvironmentInterface = {
      ...fakeEnvironment,
      async *executeTool({ toolCall: tc }) {
        yield toolCallOutput({
          output: "screenshot taken",
          images: ["data:image/png;base64,AAAA"],
          toolCallId: tc.payload.tool_call_id,
          status: "completed",
        });
      },
    };
    const llm1 = new ScriptedLLM(
      [
        { messages: [toolCall({ name: "t", arguments: "{}", toolCallId: "c1" }), usage(150, 150)] },
        {
          messages: [],
          outcome: { status: "fatal", errorCode: "rejected", errorMessage: "bad image" },
        },
        { messages: [assistantText("[summary]after the image[/summary]"), usage(160, 310)] },
      ],
      "llm1",
    );
    const llm2 = new ScriptedLLM([{ messages: [assistantText("done"), usage(30, 340)] }], "llm2");
    const engine = new ContextEngine({
      llm: llm1,
      environment: imageEnvironment,
      compaction: settings(),
      openNextContext: () => ({ llm: llm2 }),
    });

    const out = await collect(engine.run([userText("go")], { approve: allowAll }));

    expect(llm1.calls).toHaveLength(3);
    const resent = llm1.calls[2]![0]!.payload as { images?: string[]; output: string };
    expect(resent.images).toBeUndefined();
    expect(resent.output).toContain(REJECTED_IMAGE_NOTE);
    expect(textOf(llm1.calls[2]![1]!)).toBe("COMPACT NOW");
    // The rejection is recorded as a retried attempt, as a turn's is, announcing a resend at
    // once, and the summary completed the compaction.
    const rejected = out.find(
      (m) => (m.payload as { type?: string; status?: string }).status === "retryable",
    )!;
    expect(rejected.payload).toMatchObject({
      type: "request_end",
      error_code: "image_rejected",
      retry_in_ms: 0,
    });
    expect(endOf(out)).toMatchObject({ status: "completed", attempt: 2 });
    expect(endOf(out)).not.toHaveProperty("error_code");
    expect(llm2.calls[0]!.map(textOf)).toEqual([
      "[context_summary]\nafter the image\n[/context_summary]",
    ]);
  });

  it("a mid-Task compaction whose every request fails does not end the run", async () => {
    const llm1 = new ScriptedLLM(
      [
        {
          messages: [toolCall({ name: "t", arguments: "{}", toolCallId: "c1" }), usage(150, 150)],
        },
        { messages: [], outcome: { status: "retryable", errorCode: "network" } },
        { messages: [], outcome: { status: "retryable", errorCode: "network" } },
      ],
      "llm1",
    );
    const llm2 = new ScriptedLLM([{ messages: [assistantText("done"), usage(30, 200)] }], "llm2");
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      compaction: settings(),
      openNextContext: () => ({ llm: llm2 }),
      compactionMaxReconnects: 1,
      reconnectBackoffMs: 1,
    });

    const { all, cutoff } = await collectWithReturn(
      engine.run([userText("go")], { approve: allowAll }),
    );

    expect(cutoff).toBeNull();
    expect(endOf(all)).toMatchObject({ status: "completed", attempt: 2, error_code: "network" });
    expect(llm2.calls[0]!.map(textOf)).toEqual([bareNote()]);
    expect(payloadTypes(all)).not.toContain("abort");
  });

  it("defers trace rotation after boundary compaction until the next run writes", async () => {
    const llm1 = new ScriptedLLM(
      [
        { messages: [assistantText("answer"), usage(150, 150)] },
        { messages: [assistantText("[summary]s[/summary]")] },
      ],
      "llm1",
    );
    const llm2 = new ScriptedLLM(
      [{ messages: [assistantText("next done"), usage(10, 160)] }],
      "llm2",
    );
    const trace = new Writer({ tracesDir: traces, sessionId: "sess_lazy" });
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      trace,
      sessionMeta: metaMessage,
      compaction: settings(),
      openNextContext: () => ({ llm: llm2 }),
    });
    const oldPath = trace.currentPath();

    await collect(engine.run([userText("task 1")], { approve: allowAll }));
    // A new file is not created right after boundary compaction completes: the current path is unchanged, and only the old file exists on disk.
    expect(trace.currentPath()).toBe(oldPath);
    expect(await readdir(dirname(oldPath))).toEqual(["sess_lazy_001.jsonl"]);

    await collect(engine.run([userText("task 2")], { approve: allowAll }));
    // Rotation happens only once the next round has a message to write: the new file opens with session_meta, followed by the summary and the new prompt.
    expect(trace.currentPath()).not.toBe(oldPath);
    const newTrace = await readTrace(trace.currentPath());
    expect(newTrace[0]!.type).toBe("session_meta");
    expect(
      ((newTrace[1]!.payload as { text?: string }).text ?? "").startsWith("[context_summary]"),
    ).toBe(true);
    expect((newTrace[2]!.payload as { text?: string }).text).toBe("task 2");
  });

  it("a stream that drops mid-summary every time until the transport budget is spent adopts the longest partial summary", async () => {
    const shorter = longSummary("shorter", 450);
    const longer = longSummary("longer", 900);
    const dropped = (text: string): ScriptedResponse => ({
      messages: [assistantText(`[summary]${text}`)],
      outcome: { status: "retryable", errorCode: "network", errorMessage: "socket hang up" },
    });
    const llm1 = new ScriptedLLM(
      [
        { messages: [assistantText("answer"), usage(150, 150)] },
        dropped(shorter),
        dropped(longer),
        dropped(shorter),
      ],
      "llm1",
    );
    const llm2 = new ScriptedLLM([{ messages: [assistantText("ok"), usage(10, 160)] }], "llm2");
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      compaction: settings(),
      openNextContext: () => ({ llm: llm2 }),
      compactionMaxReconnects: 2,
      reconnectBackoffMs: 1,
    });

    const out = await collect(engine.run([userText("go")], { approve: allowAll }));

    // The retries resend the same input: the Prompt alone here.
    expect(llm1.calls).toHaveLength(4);
    for (const call of llm1.calls.slice(1)) expect(call.map(textOf)).toEqual(["COMPACT NOW"]);
    expect(endOf(out)).toMatchObject({
      status: "completed",
      attempt: 3,
      error_code: "network",
      error_message: "socket hang up",
    });
    await collect(engine.run([userText("next")], { approve: allowAll }));
    expect(llm2.calls[0]!.map(textOf)).toEqual([
      buildContextSummaryText(longer, undefined, { cutOff: true }),
      "next",
    ]);
  });

  it("compaction transport retries default to the shared maxReconnects budget", async () => {
    // Issue #170: without an explicit compactionMaxReconnects, the compaction request gets
    // the same retry budget as the turn loop (here 4) — under the old tighter default of 3
    // this script would have failed before reaching the 5th, succeeding attempt.
    const failing = (n: number): ScriptedResponse => ({
      messages: [],
      outcome: { status: "retryable", errorMessage: `blip ${n}` },
    });
    const llm1 = new ScriptedLLM(
      [
        { messages: [assistantText("answer"), usage(150, 150)] },
        failing(1),
        failing(2),
        failing(3),
        failing(4),
        { messages: [assistantText("[summary]after the shared ladder[/summary]"), usage(30, 300)] },
      ],
      "llm1",
    );
    const llm2 = new ScriptedLLM([], "llm2");
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      compaction: settings(),
      openNextContext: () => ({ llm: llm2 }),
      maxReconnects: 4,
      reconnectBackoffMs: 1,
    });

    const out = await collect(engine.run([userText("go")], { approve: allowAll }));
    expect(compactionEvents(out)[1]).toMatchObject({
      type: "compaction_end",
      status: "completed",
      attempt: 5,
    });
    expect(llm1.calls).toHaveLength(6);
  });

  it("a retryable compaction request takes the ladder and can recover on a later attempt", async () => {
    // The compaction loop retries the same status the turn loop does: `retryable` is where
    // a transient fault lands whenever the fatal detector doesn't recognize the gateway's
    // wording, and giving up here keeps the full context, so the next request re-triggers
    // compaction against the same wall with less headroom.
    const llm1 = new ScriptedLLM(
      [
        { messages: [assistantText("answer"), usage(150, 150)] },
        { messages: [], outcome: { status: "retryable", errorMessage: "502 upstream" } },
        { messages: [assistantText("[summary]recovered[/summary]")] },
      ],
      "llm1",
    );
    const llm2 = new ScriptedLLM([], "llm2");
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      compaction: settings(),
      openNextContext: () => ({ llm: llm2 }),
      compactionMaxReconnects: 2,
      reconnectBackoffMs: 1,
    });

    const out = await collect(engine.run([userText("go")], { approve: allowAll }));
    expect(compactionEvents(out)[1]).toMatchObject({
      type: "compaction_end",
      status: "completed",
    });
    // 1 turn request + 2 compaction attempts (the failed one, then the retry that succeeds).
    expect(llm1.calls).toHaveLength(3);
    // The retry resends the same input (tool results + prompt; only the prompt here).
    expect(payloadTypes(llm1.calls[2]!)).toEqual(["text"]);
  });

  it("an explicit compactionMaxReconnects overrides the shared maxReconnects budget", async () => {
    // The dep still allows a caller to bound compaction retries independently: with
    // compactionMaxReconnects=2, the compaction request runs 1+2 attempts and falls back to
    // the hand-off note — even though maxReconnects is far larger (the default merely
    // *follows* maxReconnects, it does not override an explicit value).
    const llm1 = new ScriptedLLM(
      [
        { messages: [assistantText("answer"), usage(150, 150)] },
        { messages: [], outcome: { status: "retryable" } },
        { messages: [], outcome: { status: "retryable" } },
        { messages: [], outcome: { status: "retryable" } },
        // Never reached: the compaction cap stops at 3 compaction attempts in total.
        { messages: [assistantText("[summary]late[/summary]")] },
      ],
      "llm1",
    );
    const recorded: AmspRecord[] = [];
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      compaction: settings(),
      openNextContext: () => ({ llm: llm1 }),
      maxReconnects: 8,
      compactionMaxReconnects: 2,
      reconnectBackoffMs: 1,
      trace: {
        write: async (m) => {
          recorded.push(m);
        },
      },
    });

    const out = await collect(engine.run([userText("go")], { approve: allowAll }));
    const events = compactionEvents(out);
    expect(events[1]).toMatchObject({
      type: "compaction_end",
      status: "completed",
      attempt: 3,
      error_code: "malformed",
    });
    // 1 turn request + 3 compaction attempts (initial + compactionMaxReconnects retries).
    expect(llm1.calls).toHaveLength(4);
    // The Trace-written compaction request_ends announce the planned backoff under the
    // COMPACTION cap (base 1ms: 1, then 2), with none on the final failure — these events
    // are never streamed, so the value lands in the Trace record only.
    const compactionEnds = recorded.filter(
      (m) => (m.payload as { type?: string }).type === "request_end",
    );
    const retryPlans = compactionEnds.map(
      (m) => (m.payload as { retry_in_ms?: number }).retry_in_ms,
    );
    expect(retryPlans).toEqual([undefined, 1, 2, undefined]);
    // The attempt ordinal rides the same events: the turn's clean completion stays
    // unstamped, the three compaction failures count 1..3.
    const attempts = compactionEnds.map((m) => (m.payload as { attempt?: number }).attempt);
    expect(attempts).toEqual([undefined, 1, 2, 3]);
  });

  it("an empty reply is asked again with the corrective line, at most twice and with no backoff wait, then the context opens with the hand-off note", async () => {
    // Issue #83: a completed request that yields no summary. Committing it as an empty
    // `[context_summary]` would lose the task state; it is a correction instead — asked again
    // at once — and once the corrections are spent the harness writes the opening itself.
    const empty = (n: number): ScriptedResponse => ({
      messages: [thinkingMessage(`pondering, attempt ${n}, no text`)],
    });
    const llm1 = new ScriptedLLM(
      [{ messages: [assistantText("answer one"), usage(150, 150)] }, empty(1), empty(2), empty(3)],
      "llm1",
    );
    const llm2 = new ScriptedLLM([{ messages: [assistantText("fresh"), usage(20, 200)] }], "llm2");
    const trace = new Writer({ tracesDir: traces, sessionId: "sess_empty" });
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      trace,
      sessionMeta: metaMessage,
      compaction: settings(),
      openNextContext: () => ({ llm: llm2 }),
      // A backoff would time the test out: corrections never wait.
      reconnectBackoffMs: 60_000,
    });
    const oldPath = trace.currentPath();

    const out1 = await collect(engine.run([userText("task one")], { approve: allowAll }));

    // Turn + three compaction requests: the Prompt, then the corrective line alone twice
    // (each empty reply is committed, so the Prompt is never sent again).
    expect(llm1.calls).toHaveLength(4);
    expect(llm1.calls[1]!.map(textOf)).toEqual(["COMPACT NOW"]);
    expect(llm1.calls[2]!.map(textOf)).toEqual([EMPTY_LINE]);
    expect(llm1.calls[3]!.map(textOf)).toEqual([EMPTY_LINE]);
    expect(endOf(out1)).toMatchObject({
      status: "completed",
      attempt: 3,
      error_code: "malformed",
      error_message: "the response contained no usable summary",
    });
    // The corrective lines are Trace-only.
    const streamed = out1.map((m) => (m.payload as { text?: string }).text);
    expect(streamed).not.toContain(EMPTY_LINE);
    expect((await readTrace(oldPath)).map((m) => (m.payload as { text?: string }).text)).toContain(
      EMPTY_LINE,
    );

    await collect(engine.run([userText("task two")], { approve: allowAll }));
    expect(llm2.calls[0]!.map(textOf)).toEqual([bareNote(oldPath), "task two"]);
  });

  it("a summary on the request after the second correction still completes, and every request's usage streams", async () => {
    const llm1 = new ScriptedLLM(
      [
        { messages: [assistantText("answer"), usage(150, 150)] },
        { messages: [thinkingMessage("blank stare 1"), usage(160, 310)] },
        { messages: [thinkingMessage("blank stare 2")] },
        // The last allowed correction: a real summary -> the compaction completes with it.
        { messages: [assistantText("[summary]third attempt wins[/summary]"), usage(170, 480)] },
      ],
      "llm1",
    );
    const llm2 = new ScriptedLLM([{ messages: [assistantText("fresh"), usage(20, 500)] }], "llm2");
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      compaction: settings(),
      openNextContext: () => ({ llm: llm2 }),
    });

    const out = await collect(engine.run([userText("task one")], { approve: allowAll }));
    const events = compactionEvents(out);
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ type: "compaction_end", status: "completed" });
    expect(events[1]!).not.toHaveProperty("error_code");
    // Every attempt's token_usage is surfaced between the paired events — unusable attempts
    // burn real tokens (issue #170). Here the 1st (empty) and 3rd (adopted) carry usage.
    expect(events[1]).toMatchObject({ attempt: 3 });
    const types = payloadTypes(out);
    const between = out.slice(
      types.indexOf("compaction_begin") + 1,
      types.lastIndexOf("compaction_end"),
    );
    const usageBetween = between.filter(
      (m) => (m.payload as { type?: string }).type === "token_usage",
    );
    expect(usageBetween.map((m) => (m.payload as TokenUsagePayload).request.total)).toEqual([
      160, 170,
    ]);
    // The new context opens with the 3rd attempt's summary; the engine-authored session
    // series continues from 480 (the unusable attempts' usage included).
    const out2 = await collect(engine.run([userText("task two")], { approve: allowAll }));
    const usage2 = out2.find((m) => (m.payload as { type?: string }).type === "token_usage")!;
    expect((usage2.payload as TokenUsagePayload).session.total).toBe(500);
    expect(llm1.calls).toHaveLength(4);
    expect(llm2.calls[0]!.map(textOf)).toEqual([
      "[context_summary]\nthird attempt wins\n[/context_summary]",
      "task two",
    ]);
  });

  it("with no round open, a tool-calling response without a summary is refused and corrected with the closed line, not the Prompt again", async () => {
    // The response is committed on the live LLM object with a tool_use the harness will not
    // run: each call is answered with a refusal (written, streamed), and the next request
    // carries the refusals and the corrective line, so the provider sees the pairing whole.
    const llm1 = new ScriptedLLM(
      [
        { messages: [assistantText("answer"), usage(150, 150)] },
        // A preamble and a call: no tagged summary, so a round — and no round is open.
        {
          messages: [
            assistantText("Let me look at the code first."),
            toolCall({ name: "t", arguments: "{}", toolCallId: "c1" }),
          ],
        },
        { messages: [assistantText("[summary]real summary[/summary]"), usage(170, 400)] },
      ],
      "llm1",
    );
    const llm2 = new ScriptedLLM([{ messages: [assistantText("fresh"), usage(20, 420)] }], "llm2");
    const trace = new Writer({ tracesDir: traces, sessionId: "sess_repair" });
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      trace,
      sessionMeta: metaMessage,
      compaction: settings(),
      openNextContext: () => ({ llm: llm2 }),
      reconnectBackoffMs: 1,
    });
    const oldPath = trace.currentPath();

    const out = await collect(engine.run([userText("task one")], { approve: allowAll }));
    expect(endOf(out)).toMatchObject({ status: "completed", attempt: 2 });
    expect(endOf(out)).not.toHaveProperty("error_code");

    // The next request answers the call first, then carries the corrective line.
    expect(llm1.calls).toHaveLength(3);
    const retry = llm1.calls[2]!;
    expect(payloadTypes(retry)).toEqual(["tool_call_output", "text"]);
    expect(retry[0]!.payload).toMatchObject({
      tool_call_id: "c1",
      output: `[tool error] ${REFUSED_NO_ROUND}`,
      status: "fatal",
    });
    expect(textOf(retry[1]!)).toBe(CLOSED_LINE);
    // The refusal is written once and streamed like any output, with no approval asked.
    const refusals = (await readTrace(oldPath)).filter((m) => {
      const p = m.payload as { type?: string; tool_call_id?: string };
      return p.type === "tool_call_output" && p.tool_call_id === "c1";
    });
    expect(refusals).toHaveLength(1);
    expect(payloadTypes(out)).toContain("tool_call_output");
    expect(payloadTypes(out)).not.toContain("approval_decision");

    // The new context opens with the summary, and its record of the call says it did not run.
    await collect(engine.run([userText("task two")], { approve: allowAll }));
    const opening = textOf(llm2.calls[0]![0]!);
    expect(opening.startsWith("[context_summary]\nreal summary\n\n")).toBe(true);
    expect(opening).toContain('id="c1" status="fatal"');
    expect(opening).not.toContain("Let me look at the code first.");
  });

  it("mid-task: a committed response absorbs the turn's tool outputs — later requests never resend them — and the Task carries on after the hand-off", async () => {
    // Issue #85, strict-provider scenario: the first committed response puts the turn's tool
    // outputs (folded into the compaction input) into the old LLM object's history. From then
    // on the requests carry only what answers the latest response — resending the outputs
    // would be rejected as stale tool_results. Every correction spent, the Task goes on in
    // the next context, which opens with the note and carries none of the old outputs.
    const llm1 = new ScriptedLLM(
      [
        // Turn 1: a tool call, over the threshold -> mid-task compaction.
        {
          messages: [toolCall({ name: "t", arguments: "{}", toolCallId: "ct" }), usage(150, 150)],
        },
        // Committed, and its call is refused (no round open) -> absorbs [output(ct), Prompt].
        { messages: [toolCall({ name: "t", arguments: "{}", toolCallId: "c1" })] },
        // Committed but empty, twice: the corrections are spent.
        { messages: [thinkingMessage("blank 2")] },
        { messages: [thinkingMessage("blank 3")] },
      ],
      "llm1",
    );
    const llm2 = new ScriptedLLM(
      [{ messages: [assistantText("next step done"), usage(70, 970)] }],
      "llm2",
    );
    const trace = new Writer({ tracesDir: traces, sessionId: "sess_absorb" });
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      trace,
      sessionMeta: metaMessage,
      compaction: settings(),
      openNextContext: () => ({ llm: llm2 }),
    });
    const oldPath = trace.currentPath();

    const { all, cutoff } = await collectWithReturn(
      engine.run([userText("task one")], { approve: allowAll }),
    );

    expect(cutoff).toBeNull();
    expect(llm1.calls).toHaveLength(4);
    // The first request folds the turn's tool output in; the second answers c1 and corrects;
    // the third corrects alone — none resends the absorbed output.
    expect(payloadTypes(llm1.calls[1]!)).toEqual(["tool_call_output", "text"]);
    expect((llm1.calls[1]![0]!.payload as { tool_call_id?: string }).tool_call_id).toBe("ct");
    expect(payloadTypes(llm1.calls[2]!)).toEqual(["tool_call_output", "text"]);
    expect((llm1.calls[2]![0]!.payload as { tool_call_id?: string }).tool_call_id).toBe("c1");
    expect(textOf(llm1.calls[2]![1]!)).toBe(CLOSED_LINE);
    expect(llm1.calls[3]!.map(textOf)).toEqual([EMPTY_LINE]);
    expect(endOf(all)).toMatchObject({ status: "completed", attempt: 3, error_code: "malformed" });
    // The Task's next request is the new context's first, and it is the note alone.
    expect(llm2.calls[0]!.map(textOf)).toEqual([bareNote(oldPath)]);
    expect(all.map((m) => (m.payload as { text?: string }).text)).toContain("next step done");
  });

  it("a reply cut at the output limit is asked again with the shorter-summary line; cut three times, the longest cut text opens the next context marked as cut off, and the Task carries on", async () => {
    const cut = (text: string): ScriptedResponse => ({
      messages: [assistantText(`[summary]${text}`), usage(170, 400)],
      outcome: {
        status: "retryable",
        errorCode: "output_truncated",
        errorMessage: "the response stopped at the output limit (finish_reason: length)",
      },
    });
    const first = longSummary("first", 500);
    const longest = longSummary("longest", 1200);
    const third = longSummary("third", 800);
    const llm1 = new ScriptedLLM(
      [
        { messages: [toolCall({ name: "t", arguments: "{}", toolCallId: "c1" }), usage(150, 150)] },
        cut(first),
        cut(longest),
        cut(third),
      ],
      "llm1",
    );
    const llm2 = new ScriptedLLM([{ messages: [assistantText("done"), usage(30, 500)] }], "llm2");
    const trace = new Writer({ tracesDir: traces, sessionId: "sess_cut" });
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      trace,
      sessionMeta: metaMessage,
      compaction: settings(),
      openNextContext: () => ({ llm: llm2 }),
      // A backoff would time the test out: a cut reply is a correction, asked again at once.
      reconnectBackoffMs: 60_000,
    });
    const oldPath = trace.currentPath();

    const { all, cutoff } = await collectWithReturn(
      engine.run([userText("go")], { approve: allowAll }),
    );

    expect(cutoff).toBeNull();
    // Never committed, so each retry sends the same input again — the turn's output and the
    // Prompt — with the shorter-summary line added once.
    expect(llm1.calls).toHaveLength(4);
    expect(payloadTypes(llm1.calls[1]!)).toEqual(["tool_call_output", "text"]);
    for (const retry of [llm1.calls[2]!, llm1.calls[3]!]) {
      expect(retry.slice(0, 2)).toEqual(llm1.calls[1]);
      expect(retry.slice(2).map(textOf)).toEqual([TRUNCATED_LINE]);
    }
    expect(endOf(all)).toMatchObject({
      status: "completed",
      attempt: 3,
      error_code: "output_truncated",
    });
    expect(llm2.calls[0]!.map(textOf)).toEqual([
      buildContextSummaryText(longest, { tracePath: oldPath }, { cutOff: true }),
    ]);
    expect(all.map((m) => (m.payload as { text?: string }).text)).toContain("done");
  });

  it("a cut reply with fewer than 400 characters inside the tag is not adopted: the hand-off note is", async () => {
    const cut: ScriptedResponse = {
      messages: [assistantText("[summary]## Request\nonly the start")],
      outcome: { status: "retryable", errorCode: "output_truncated" },
    };
    const llm1 = new ScriptedLLM(
      [{ messages: [assistantText("answer"), usage(150, 150)] }, cut, cut, cut],
      "llm1",
    );
    const llm2 = new ScriptedLLM([{ messages: [assistantText("ok"), usage(10, 160)] }], "llm2");
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      compaction: settings(),
      openNextContext: () => ({ llm: llm2 }),
    });

    const out = await collect(engine.run([userText("go")], { approve: allowAll }));
    await collect(engine.run([userText("next")], { approve: allowAll }));

    expect(endOf(out)).toMatchObject({ status: "completed", error_code: "output_truncated" });
    expect(llm2.calls[0]!.map(textOf)).toEqual([bareNote(), "next"]);
    // With no Trace sink the note has no file to name.
    expect(textOf(llm2.calls[0]![0]!)).not.toContain(".jsonl");
  });

  it("a stop that arrives after the summary failed and before the fallback keeps the old context", async () => {
    const controller = new AbortController();
    const llm1 = new ScriptedLLM(
      [
        { messages: [toolCall({ name: "t", arguments: "{}", toolCallId: "c1" }), usage(150, 150)] },
        { messages: [], outcome: { status: "fatal", errorCode: "auth", errorMessage: "nope" } },
        { messages: [assistantText("on the old context"), usage(60, 400)] },
      ],
      "llm1",
    );
    let opened = 0;
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      compaction: settings(),
      openNextContext: () => {
        opened += 1;
        return { llm: new ScriptedLLM([], "llm2") };
      },
    });

    const all: AmspRecord[] = [];
    const run = engine.run([userText("go")], { approve: allowAll, signal: controller.signal });
    let cutoff: unknown;
    for (;;) {
      const res = await run.next();
      if (res.done) {
        cutoff = res.value;
        break;
      }
      all.push(res.value);
      // The compaction request has just failed: the user stops before the fallback.
      const p = res.value.payload as { type?: string; status?: string };
      if (p.type === "request_end" && p.status === "fatal") controller.abort();
    }

    expect(cutoff).toEqual({ kind: "abort", errorCode: "compaction_interrupted" });
    expect(endOf(all)).toMatchObject({ status: "aborted" });
    expect(opened).toBe(0);
    // Nothing was committed: the turn's output rides the next run, on the old context.
    await collect(engine.run([userText("go on")], { approve: allowAll }));
    expect(payloadTypes(llm1.calls[2]!)).toEqual(["tool_call_output", "text"]);
  });

  it("a stop during a backoff wait keeps the old context", async () => {
    const controller = new AbortController();
    const llm1 = new ScriptedLLM(
      [
        { messages: [assistantText("answer"), usage(150, 150)] },
        { messages: [], outcome: { status: "retryable", errorCode: "network" } },
      ],
      "llm1",
    );
    let opened = 0;
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      compaction: settings(),
      openNextContext: () => {
        opened += 1;
        return { llm: new ScriptedLLM([], "llm2") };
      },
      reconnectBackoffMs: 60_000,
    });

    const all: AmspRecord[] = [];
    for await (const msg of engine.run([userText("go")], {
      approve: allowAll,
      signal: controller.signal,
    })) {
      all.push(msg);
      const p = msg.payload as { type?: string; status?: string };
      // The failed request announced its wait; the stop lands during it.
      if (p.type === "request_end" && p.status === "retryable") {
        setTimeout(() => controller.abort(), 10);
      }
    }

    expect(endOf(all)).toMatchObject({ status: "aborted", attempt: 1 });
    expect(opened).toBe(0);
    expect(engine.compactability()).toBe("ok");
  });

  it("mid-task: an abort after a committed response merges the stash — refusals ride, absorbed outputs do not", async () => {
    // The abort-in-window case (issue #85): the stash must merge, not be overwritten. After a
    // committed response the turn outputs are absorbed, so the case-A carry-over is skipped
    // entirely and only the outputs owed to that response ride the next run.
    const llm1 = new ScriptedLLM(
      [
        {
          messages: [toolCall({ name: "t", arguments: "{}", toolCallId: "ct" }), usage(150, 150)],
        },
        // Committed, its call refused -> absorbs the outputs, the refusal owed.
        { messages: [toolCall({ name: "t", arguments: "{}", toolCallId: "c1" })] },
        // The request carrying the refusal: the user aborts mid-request -> uncommitted, the
        // refusal is still owed and gets stashed.
        { messages: [], outcome: { status: "aborted" } },
        // Next run: the stash leads, then the new prompt.
        { messages: [assistantText("back"), usage(60, 500)] },
      ],
      "llm1",
    );
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      compaction: settings(),
      openNextContext: () => ({ llm: new ScriptedLLM([], "llm2") }),
      reconnectBackoffMs: 1,
    });

    const out = await collect(engine.run([userText("go")], { approve: allowAll }));
    const events = compactionEvents(out);
    expect(events[1]).toMatchObject({ type: "compaction_end", status: "aborted" });
    expect(payloadTypes(out)).toContain("abort");
    expect(llm1.calls).toHaveLength(3);
    // The aborted request carried the refusal + corrective line (not the absorbed outputs).
    expect(payloadTypes(llm1.calls[2]!)).toEqual(["tool_call_output", "text"]);
    expect((llm1.calls[2]![0]!.payload as { tool_call_id?: string }).tool_call_id).toBe("c1");

    // The next run leads with the still-owed refusal; the absorbed turn outputs are NOT
    // re-held as carry-over (no duplicate ct output).
    await collect(engine.run([userText("next")], { approve: allowAll }));
    const nextRun = llm1.calls[3]!;
    expect(payloadTypes(nextRun)).toEqual(["tool_call_output", "text"]);
    expect((nextRun[0]!.payload as { tool_call_id?: string }).tool_call_id).toBe("c1");
    expect(textOf(nextRun[1]!)).toBe("next");
  });

  it("the compaction request carries exactly the same tools as ordinary requests (prompt-cache pin)", async () => {
    // Owner constraint (#84): compaction runs exactly when the context is at its largest, and
    // the provider's prompt cache only holds if the request prefix — the tool list included —
    // stays byte-identical to the ordinary turns'. The engine passes no per-request tool
    // override of any kind, and GenerativeModel serves every request from the same frozen
    // config, so the compaction request's tools are the session's tools, verbatim.
    const configs: (UniConfig | undefined)[] = [];
    const scripted = [
      // Turn 1 answer: usage above the compaction threshold (total 151 >= 100).
      { text: "answer one", promptTokens: 150 },
      // Compaction request: a valid summary.
      { text: "[summary]s[/summary]", promptTokens: 160 },
    ];
    class CapturingModel extends GenerativeModel {
      protected override openStream(
        _uni: UniMessage,
        _signal: AbortSignal,
        config?: UniConfig,
      ): AsyncIterable<UniEvent> {
        configs.push(config);
        const next = scripted.shift()!;
        return (async function* () {
          const event = (item: UniEvent["content_items"][number]): UniEvent => ({
            role: "assistant",
            event_type: "delta",
            content_items: [item],
            finish_reason: null,
            usage_metadata: null,
          });
          yield event({ type: "text.delta", text: next.text });
          yield event({ type: "text.done", text: next.text });
          yield {
            role: "assistant",
            event_type: "stop",
            content_items: [],
            finish_reason: "stop",
            usage_metadata: {
              cached_tokens: 0,
              prompt_tokens: next.promptTokens,
              thoughts_tokens: 0,
              response_tokens: 1,
            },
          };
        })();
      }
    }
    const model = new CapturingModel({
      modelId: "claude-sonnet-4-6",
      tools: [
        { name: "exec_command", description: "run a command" },
        { name: "read_file", description: "read a file" },
      ],
    });
    const engine = new ContextEngine({
      llm: model,
      environment: fakeEnvironment,
      compaction: settings(),
      openNextContext: () => ({ llm: new ScriptedLLM([], "llm2") }),
    });

    const out = await collect(engine.run([userText("go")], { approve: allowAll }));
    expect(compactionEvents(out)[1]).toMatchObject({
      type: "compaction_end",
      status: "completed",
    });
    expect(configs).toHaveLength(2);
    // Identical config object -> identical serialized prefix; the tool list is present and
    // unchanged (not omitted, not [], no tool_choice override).
    expect(configs[1]).toBe(configs[0]);
    expect(configs[1]?.tools?.map((t) => t.name)).toEqual(["exec_command", "read_file"]);
    expect(configs[1] !== undefined && "tool_choice" in configs[1]).toBe(false);
  });

  it("session turns reaching (==) the threshold compact at task end — no waiting for the next task", async () => {
    const llm1 = new ScriptedLLM(
      [
        // Task 1: two LLM requests (a tool round + the final reply).
        // After round 1, turns=1 < 2 doesn't trigger; round 2 (task wrap-up), turns=2 >= 2 -> compacts immediately.
        {
          messages: [toolCall({ name: "t", arguments: "{}", toolCallId: "c1" }), usage(10, 10)],
        },
        { messages: [assistantText("t1 done"), usage(10, 20)] },
        // Compaction request (sent out immediately when task 1 ends).
        { messages: [assistantText("[summary]s[/summary]")] },
      ],
      "llm1",
    );
    const llm2 = new ScriptedLLM([{ messages: [assistantText("t2 done"), usage(10, 30)] }], "llm2");
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      compaction: settings({ maxContextLength: -1, maxSessionTurns: 2 }),
      openNextContext: () => ({ llm: llm2 }),
    });

    // Triggers right at task 1's wrap-up (compacts as soon as the threshold is reached, without waiting for the next task); the summary request goes to the old instance.
    const out1 = await collect(engine.run([userText("task 1")], { approve: allowAll }));
    const events = compactionEvents(out1);
    expect(events[0]).toMatchObject({ type: "compaction_begin", reason: "turns", turns: 2 });
    expect(events[1]).toMatchObject({ type: "compaction_end", status: "completed" });
    expect(llm1.calls).toHaveLength(3);

    // The counter resets after compaction completes: task 2 is picked up by the new instance (summary + new prompt), and no further trigger fires.
    const out2 = await collect(engine.run([userText("task 2")], { approve: allowAll }));
    expect(compactionEvents(out2)).toHaveLength(0);
    expect(llm2.calls).toHaveLength(1);
    expect(llm2.calls[0]!.map(textOf)).toEqual([
      "[context_summary]\ns\n[/context_summary]",
      "task 2",
    ]);
  });

  it("context usage exactly equal to the threshold triggers compaction (>=, not >)", async () => {
    const llm1 = new ScriptedLLM(
      [
        // Wrap-up round context usage 100 == threshold 100 -> triggers.
        { messages: [assistantText("answer"), usage(100, 100)] },
        { messages: [assistantText("[summary]eq[/summary]")] },
      ],
      "llm1",
    );
    const llm2 = new ScriptedLLM([], "llm2");
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      compaction: settings(),
      openNextContext: () => ({ llm: llm2 }),
    });

    const out = await collect(engine.run([userText("go")], { approve: allowAll }));
    const events = compactionEvents(out);
    expect(events[0]).toMatchObject({
      type: "compaction_begin",
      reason: "context",
      context: 100,
    });
    expect(events[1]).toMatchObject({ type: "compaction_end", status: "completed" });
  });

  it("discard defers mid-task, then swaps the LLM at task end without a compaction request", async () => {
    const llm1 = new ScriptedLLM(
      [
        // Round 1: over the limit, but the task is still in progress -> deferred.
        {
          messages: [toolCall({ name: "t", arguments: "{}", toolCallId: "c1" }), usage(150, 150)],
        },
        // Round 2: task ends -> performs discard (no compaction request sent).
        { messages: [assistantText("done"), usage(160, 310)] },
      ],
      "llm1",
    );
    const llm2 = new ScriptedLLM([{ messages: [assistantText("fresh"), usage(10, 320)] }], "llm2");
    const trace = new Writer({ tracesDir: traces, sessionId: "sess_discard" });
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      trace,
      sessionMeta: metaMessage,
      compaction: settings({ mode: "discard" }),
      openNextContext: () => ({ llm: llm2 }),
    });
    const oldPath = trace.currentPath();

    const out = await collect(engine.run([userText("go")], { approve: allowAll }));

    // Triggers exactly once, at task end; the old LLM is called exactly twice (no compaction request).
    const events = compactionEvents(out);
    expect(events.map((e) => `${e.type}:${e.mode}`)).toEqual([
      "compaction_begin:discard",
      "compaction_end:discard",
    ]);
    expect(llm1.calls).toHaveLength(2);

    // The next round's input is used as-is as the new instance's first input (no [context_summary]).
    await collect(engine.run([userText("next task")], { approve: allowAll }));
    expect(llm2.calls[0]!.map(textOf)).toEqual(["next task"]);

    // Trace splits into files: the new file starts with session_meta.
    const newTrace = await readTrace(trace.currentPath());
    expect(trace.currentPath()).not.toBe(oldPath);
    expect(newTrace[0]!.type).toBe("session_meta");
  });

  it("lenient extraction: output without [summary] tags is used verbatim", async () => {
    const llm1 = new ScriptedLLM(
      [
        { messages: [assistantText("answer"), usage(150, 150)] },
        { messages: [assistantText("plain summary text without tags")] },
      ],
      "llm1",
    );
    const llm2 = new ScriptedLLM([{ messages: [assistantText("ok"), usage(10, 160)] }], "llm2");
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      compaction: settings(),
      openNextContext: () => ({ llm: llm2 }),
    });

    await collect(engine.run([userText("go")], { approve: allowAll }));
    await collect(engine.run([userText("next")], { approve: allowAll }));
    expect(textOf(llm2.calls[0]![0]!)).toBe(
      "[context_summary]\nplain summary text without tags\n[/context_summary]",
    );
  });

  it("rescues a summary written outside the tags (issue #170) on the first attempt", async () => {
    // deepseek-v4-flash writes `[summary]\n[/summary]` as a "title" and the body after the
    // closing tag. Extraction salvages the outside text, so the very first attempt succeeds —
    // no rejection loop, no burned retries.
    const llm1 = new ScriptedLLM(
      [
        { messages: [assistantText("answer"), usage(150, 150)] },
        {
          messages: [
            assistantText("[summary]\n[/summary]\nRescued body outside the tags."),
            usage(40, 200),
          ],
        },
      ],
      "llm1",
    );
    const llm2 = new ScriptedLLM([{ messages: [assistantText("fresh"), usage(10, 210)] }], "llm2");
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      compaction: settings(),
      openNextContext: () => ({ llm: llm2 }),
      reconnectBackoffMs: 1,
    });

    const out = await collect(engine.run([userText("task one")], { approve: allowAll }));
    expect(compactionEvents(out)[1]).toMatchObject({
      type: "compaction_end",
      status: "completed",
      attempt: 1,
    });
    // No rejection retry: the turn request plus a single compaction attempt.
    expect(llm1.calls).toHaveLength(2);
    await collect(engine.run([userText("task two")], { approve: allowAll }));
    expect(llm2.calls[0]!.map(textOf)).toEqual([
      "[context_summary]\nRescued body outside the tags.\n[/context_summary]",
      "task two",
    ]);
  });

  it("manual compaction skips threshold checks and reuses the same flow", async () => {
    const llm1 = new ScriptedLLM(
      [
        // One ordinary task (well under the limit).
        { messages: [assistantText("small"), usage(10, 10)] },
        // Manual compaction request.
        { messages: [assistantText("[summary]manual s[/summary]")] },
      ],
      "llm1",
    );
    const llm2 = new ScriptedLLM([{ messages: [assistantText("after"), usage(5, 20)] }], "llm2");
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      compaction: settings(),
      openNextContext: () => ({ llm: llm2 }),
    });

    await collect(engine.run([userText("hi")], { approve: allowAll }));
    const out = await collect(engine.compact());
    const events = compactionEvents(out);
    expect(events[0]).toMatchObject({ type: "compaction_begin", reason: "manual" });
    expect(events[1]).toMatchObject({ type: "compaction_end", status: "completed" });

    await collect(engine.run([userText("next")], { approve: allowAll }));
    expect(llm2.calls[0]!.map(textOf)).toEqual([
      "[context_summary]\nmanual s\n[/context_summary]",
      "next",
    ]);
  });

  it("a manual compaction stopped before anything committed restores the prior carry-over verbatim", async () => {
    // The carry seam's binary (PR #87 review): the request was stopped, so nothing reached
    // MMSP — the folded carry-over comes back exactly as it was (the very same message
    // objects, not routed through any absorption logic), with nothing owed to interleave with.
    const llm1 = new ScriptedLLM(
      [
        { messages: [assistantText("hi"), usage(10, 10)] },
        { messages: [], outcome: { status: "aborted" } },
        // Run 3: the restored carry-over leads the input, exactly as before the compact().
        { messages: [assistantText("resumed"), usage(20, 40)] },
      ],
      "llm1",
    );
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      compaction: settings(),
      openNextContext: () => ({ llm: new ScriptedLLM([], "llm2") }),
    });
    await collect(engine.run([userText("start")], { approve: allowAll }));
    // An aborted-before-issue run leaves its input as carry-over.
    const aborted = new AbortController();
    aborted.abort();
    const pendingMsg = userText("pending question");
    await collect(engine.run([pendingMsg], { signal: aborted.signal, approve: allowAll }));
    expect(llm1.calls).toHaveLength(1); // the aborted run never reached the LLM

    const result = await collectWithReturn(engine.compact());
    expect(result.cutoff).toBe("aborted");
    expect(endOf(result.all)).toMatchObject({ status: "aborted" });
    // The compaction folded the carry-over into its (uncommitted) request...
    expect(llm1.calls[1]!.map(textOf)).toEqual(["pending question", "COMPACT NOW"]);

    // ...and restored it verbatim: the next run resends the very same message object first.
    await collect(engine.run([userText("run3")], { approve: allowAll }));
    expect(llm1.calls[2]![0]).toBe(pendingMsg);
    expect(llm1.calls[2]!.map(textOf)).toEqual(["pending question", "run3"]);
  });

  it("a manual compaction stopped after a committed response consumes the carry-over; only the outputs owed to it remain pending", async () => {
    // The other side of the binary: the first committed response put the folded carry-over
    // into MMSP history, so it is disposed of at the seam — never restored — and the next
    // input reflects the committed state plus the refusal owed to the last committed response.
    const llm1 = new ScriptedLLM(
      [
        { messages: [assistantText("hi"), usage(10, 10)] },
        // Committed but empty -> absorbs the folded carry-over into history.
        { messages: [thinkingMessage("blank 1")] },
        // Committed with a call, refused -> the refusal is owed.
        { messages: [toolCall({ name: "t", arguments: "{}", toolCallId: "c9" })] },
        // The request carrying it is stopped.
        { messages: [], outcome: { status: "aborted" } },
        // Run 3: the refusal leads; the consumed carry-over is NOT resent.
        { messages: [assistantText("resumed"), usage(20, 40)] },
      ],
      "llm1",
    );
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      compaction: settings(),
      openNextContext: () => ({ llm: new ScriptedLLM([], "llm2") }),
    });
    await collect(engine.run([userText("start")], { approve: allowAll }));
    const aborted = new AbortController();
    aborted.abort();
    await collect(
      engine.run([userText("pending question")], { signal: aborted.signal, approve: allowAll }),
    );

    const out = await collect(engine.compact());
    expect(endOf(out)).toMatchObject({ status: "aborted" });
    expect(llm1.calls).toHaveLength(4);
    // The first request folded the carry-over in (and committed it); the later ones carry
    // the corrective lines — the absorbed carry-over never again.
    expect(llm1.calls[1]!.map(textOf)).toEqual(["pending question", "COMPACT NOW"]);
    expect(llm1.calls[2]!.map(textOf)).toEqual([EMPTY_LINE]);
    expect(payloadTypes(llm1.calls[3]!)).toEqual(["tool_call_output", "text"]);

    // The carry-over is consumed at the seam — the next run leads with the owed refusal
    // alone, continuing from committed history.
    await collect(engine.run([userText("run3")], { approve: allowAll }));
    const run3 = llm1.calls[4]!;
    expect(payloadTypes(run3)).toEqual(["tool_call_output", "text"]);
    expect((run3[0]!.payload as { tool_call_id?: string }).tool_call_id).toBe("c9");
    expect(textOf(run3[1]!)).toBe("run3");
  });

  it("a manual compaction that falls back keeps the pending text input behind the note and drops pending tool outputs", async () => {
    const llm1 = new ScriptedLLM(
      [
        // A turn whose tool call is left unanswered by a stop: its placeholder is carry-over.
        {
          messages: [toolCall({ name: "t", arguments: "{}", toolCallId: "c1" }), usage(10, 10)],
        },
        { messages: [], outcome: { status: "fatal", errorCode: "rejected", errorMessage: "no" } },
      ],
      "llm1",
    );
    const llm2 = new ScriptedLLM([{ messages: [assistantText("fresh"), usage(5, 20)] }], "llm2");
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      compaction: settings(),
      openNextContext: () => ({ llm: llm2 }),
    });
    const stop = new AbortController();
    await collect(
      engine.run([userText("start")], {
        signal: stop.signal,
        approve: async () => {
          stop.abort();
          return "allow";
        },
      }),
    );
    const aborted = new AbortController();
    aborted.abort();
    await collect(
      engine.run([userText("pending question")], { signal: aborted.signal, approve: allowAll }),
    );

    const out = await collect(engine.compact());
    // The refused request carried both, ahead of the Prompt.
    expect(payloadTypes(llm1.calls[1]!)).toEqual(["tool_call_output", "text", "text"]);
    expect(endOf(out)).toMatchObject({ status: "completed", error_code: "rejected" });

    await collect(engine.run([userText("run3")], { approve: allowAll }));
    expect(payloadTypes(llm2.calls[0]!)).toEqual(["text", "text", "text"]);
    expect(llm2.calls[0]!.map(textOf)).toEqual([bareNote(), "pending question", "run3"]);
  });

  it("a Task-end compaction that falls back leaves the note pending; the next run sends it ahead of the Prompt and opens the new file with it", async () => {
    const llm1 = new ScriptedLLM(
      [
        { messages: [assistantText("answer one"), usage(150, 150)] },
        { messages: [], outcome: { status: "fatal", errorCode: "auth", errorMessage: "nope" } },
      ],
      "llm1",
    );
    const llm2 = new ScriptedLLM([{ messages: [assistantText("two"), usage(20, 170)] }], "llm2");
    const trace = new Writer({ tracesDir: traces, sessionId: "sess_pending_note" });
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      trace,
      sessionMeta: metaMessage,
      compaction: settings(),
      openNextContext: () => ({ llm: llm2 }),
    });
    const oldPath = trace.currentPath();

    const out1 = await collect(engine.run([userText("task one")], { approve: allowAll }));
    expect(endOf(out1)).toMatchObject({ status: "completed", error_code: "auth" });
    expect(engine.hasPendingInput()).toBe(true);
    // Nothing is opened before there is something to write.
    expect(trace.currentPath()).toBe(oldPath);

    await collect(engine.run([userText("task two")], { approve: allowAll }));
    expect(llm2.calls[0]!.map(textOf)).toEqual([bareNote(oldPath), "task two"]);
    const opened = await readTrace(trace.currentPath());
    expect(trace.currentPath()).not.toBe(oldPath);
    expect(opened[0]!.type).toBe("session_meta");
    expect(payloadTypes(opened.slice(1, 3))).toEqual(["text", "text"]);
    expect(textOf(opened[1]!)).toBe(bareNote(oldPath));
  });

  it("the note the composition layer builds is the one the next context opens with", async () => {
    const built = userText("[context_summary]\nthe composition layer's note\n[/context_summary]");
    const llm1 = new ScriptedLLM(
      [
        { messages: [assistantText("answer one"), usage(150, 150)] },
        { messages: [], outcome: { status: "fatal", errorCode: "rejected" } },
      ],
      "llm1",
    );
    const llm2 = new ScriptedLLM([{ messages: [assistantText("two"), usage(20, 170)] }], "llm2");
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      compaction: settings(),
      openNextContext: () => ({ llm: llm2 }),
      buildHandoff: async () => built,
    });

    await collect(engine.run([userText("task one")], { approve: allowAll }));
    await collect(engine.run([userText("task two")], { approve: allowAll }));
    expect(llm2.calls[0]![0]).toBe(built);
  });

  it("a hand-off builder that throws gives the bare note, and the compaction still completes", async () => {
    const llm1 = new ScriptedLLM(
      [
        { messages: [assistantText("answer one"), usage(150, 150)] },
        { messages: [], outcome: { status: "fatal", errorCode: "rejected" } },
      ],
      "llm1",
    );
    const llm2 = new ScriptedLLM([{ messages: [assistantText("two"), usage(20, 170)] }], "llm2");
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      compaction: settings(),
      openNextContext: () => ({ llm: llm2 }),
      buildHandoff: () => {
        throw new Error("the Trace file could not be read");
      },
    });

    const out = await collect(engine.run([userText("task one")], { approve: allowAll }));
    await collect(engine.run([userText("task two")], { approve: allowAll }));
    expect(endOf(out)).toMatchObject({ status: "completed" });
    expect(llm2.calls[0]!.map(textOf)).toEqual([bareNote(), "task two"]);
  });

  it("an opened context that brings a notice has it in the opening text", async () => {
    const notice = "the previous configuration is still in force";
    const llm1 = new ScriptedLLM(
      [
        { messages: [assistantText("answer one"), usage(150, 150)] },
        { messages: [assistantText("[summary]the plan[/summary]"), usage(160, 310)] },
      ],
      "llm1",
    );
    const llm2 = new ScriptedLLM([{ messages: [assistantText("two"), usage(20, 330)] }], "llm2");
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      compaction: settings(),
      openNextContext: () => ({ llm: llm2, notice }),
    });

    await collect(engine.run([userText("task one")], { approve: allowAll }));
    await collect(engine.run([userText("task two")], { approve: allowAll }));
    expect(llm2.calls[0]!.map(textOf)).toEqual([
      buildContextSummaryText("the plan", undefined, { notice }),
      "task two",
    ]);
  });

  it("no compaction capability (openNextContext missing) means thresholds never fire and compact() is a no-op", async () => {
    const llm1 = new ScriptedLLM(
      [{ messages: [assistantText("big"), usage(999999, 999999)] }],
      "llm1",
    );
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      compaction: settings(),
    });
    const out = await collect(engine.run([userText("go")], { approve: allowAll }));
    expect(compactionEvents(out)).toHaveLength(0);
    expect(await collect(engine.compact())).toHaveLength(0);
    expect(llm1.calls).toHaveLength(1);
  });

  it('compactability(): reports each specific "cannot compact" reason instead of a blanket false', async () => {
    // compact() emits **zero messages** when there is nothing compactable. The caller (Web / CLI)
    // must be able to ask ahead of time, otherwise it can only wait forever for a compaction
    // banner that never comes -- exactly how "no response from /compact after interrupting on the
    // web" happens: interrupt the first request -> token_usage is never received -> sessionTurns
    // stays at 0 -> compact() returns immediately.
    // The reason also needs to distinguish "just compacted" from "haven't chatted yet" -- both
    // have sessionTurns == 0, but they're two completely different messages to the user: telling
    // someone who just finished compacting that there's "no completed conversation turn yet" is
    // effectively saying nothing useful.
    // The compaction request goes to the **current** LLM (the script's second entry); openNextContext
    // supplies the LLM used for the new context after compaction.
    const llm1 = new ScriptedLLM(
      [
        // Usage is kept under maxContextLength (100 per settings()) so automatic compaction doesn't jump in first and reset sessionTurns.
        { messages: [assistantText("hi"), usage(10, 10)] },
        { messages: [assistantText("[summary]s[/summary]")] }, // manual compaction request
      ],
      "llm1",
    );
    const llm2 = new ScriptedLLM([{ messages: [assistantText("after"), usage(5, 20)] }], "llm2");

    // (1) No compaction capability configured (no compaction / openNextContext).
    const noCap = new ContextEngine({ llm: llm1, environment: fakeEnvironment });
    expect(noCap.compactability()).toBe("unsupported");

    // (2) Capability configured, but the current context hasn't finished a single round yet: not compactable, and compact() indeed emits no messages.
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      compaction: settings(),
      openNextContext: () => ({ llm: llm2 }),
    });
    expect(engine.compactability()).toBe("empty");
    expect(await collect(engine.compact())).toHaveLength(0);

    // (3) Compactable only after a round finishes (token_usage received).
    await collect(engine.run([userText("go")], { approve: allowAll }));
    expect(engine.compactability()).toBe("ok");
    expect(compactionEvents(await collect(engine.compact()))).not.toHaveLength(0);

    // (4) Compacting again right after a compaction: also not compactable (the new context is
    // empty), but the reason is "just compacted" -- it must not say "no completed conversation
    // turn yet" again, since the user clearly just finished a whole round.
    expect(engine.compactability()).toBe("just_compacted");
    expect(await collect(engine.compact())).toHaveLength(0);

    // (5) Compactable again once a round finishes in the new context.
    await collect(engine.run([userText("next")], { approve: allowAll }));
    expect(engine.compactability()).toBe("ok");
  });

  it("a resumed engine restores the turn count and the just-compacted reason", async () => {
    // Trace replay hands these back through EngineInitialState. Without them the engine that a
    // restart rebuilds starts from zero and reports a conversation-less context.
    const withTurns = new ContextEngine({
      llm: new ScriptedLLM([]),
      environment: fakeEnvironment,
      compaction: settings(),
      openNextContext: () => ({ llm: new ScriptedLLM([]) }),
      initialState: { sessionTurns: 4 },
    });
    expect(withTurns.compactability()).toBe("ok");

    // Zero turns because the Trace ended on a completed compaction, not because nothing was said.
    const justCompacted = new ContextEngine({
      llm: new ScriptedLLM([]),
      environment: fakeEnvironment,
      compaction: settings(),
      openNextContext: () => ({ llm: new ScriptedLLM([]) }),
      initialState: { sessionTurns: 0, fromCompaction: true },
    });
    expect(justCompacted.compactability()).toBe("just_compacted");
  });

  it("a resumed Session compacts on request instead of silently doing nothing", async () => {
    // A restart leaves the Session with real history on disk but no engine — that is built by
    // the first run's bootstrap (ensureReady). A compaction asked for before anything has run
    // must build it and fold the conversation: the caller has already been told compaction is
    // available, so a silent no-op leaves it waiting for a banner that never arrives.
    const resumedLLM = new ScriptedLLM([{ messages: [assistantText("[summary]s[/summary]")] }]);
    const newContextLLM = new ScriptedLLM([{ messages: [assistantText("on it")] }]);
    const written: AmspRecord[] = [];
    const session = new Session({
      meta: metaMessage.payload,
      // Like the real opener, the bootstrap publishes the context's toolset record.
      bootstrap: async ({ emit }) => {
        emit(toolListReady([]));
        return { llm: resumedLLM };
      },
      environment: fakeEnvironment,
      trace: {
        write: async (msg) => {
          written.push(msg);
        },
      },
      openNextContext: () => ({ llm: newContextLLM }),
      compaction: settings(),
      // What agent.resumeSession derives from the Trace: three completed turns of history.
      metaAlreadyWritten: true,
      initialEngineState: { sessionTurns: 3, lastRequestTotal: 80 },
      imagesDir: "/tmp/penguin-test-scratch",
      modelHasVision: true,
    });

    expect(session.compactability()).toBe("ok");
    const events = compactionEvents(await collect(session.compact()));
    expect(events.map((e) => e.type)).toEqual(["compaction_begin", "compaction_end"]);
    expect(events[1]).toMatchObject({ status: "completed" });
    // The compaction request went to the LLM the bootstrap produced (the one resume seeds with
    // the replayed history), so the summary folds the actual conversation.
    expect(resumedLLM.calls).toHaveLength(1);
    // Compaction reset the context, and the reason stays specific rather than falling back to
    // "nothing said yet".
    expect(session.compactability()).toBe("just_compacted");
    // The engine was built for this call rather than by a run, so the context's first-run
    // records were still owed to the Trace. They describe the context the compaction closed,
    // and are dropped with it: the one toolset record is the one the rotation writes at the
    // head of the next context's file, and the next run writes no second one behind its input.
    await collect(session.run([userText("next")], { approve: allowAll }));
    const types = payloadTypes(written);
    const input = written.findIndex((m) => (m.payload as { text?: string }).text === "next");
    expect(types.filter((t) => t === "tool_list_ready")).toHaveLength(1);
    expect(types.indexOf("tool_list_ready")).toBeLessThan(input);
    session.dispose();
  });

  it("a Session's hand-off note is built from the Trace file being closed: it quotes the user's messages and names the file", async () => {
    const llm1 = new ScriptedLLM([
      { messages: [assistantText("answer one"), usage(150, 150)] },
      {
        messages: [],
        outcome: { status: "fatal", errorCode: "rejected", errorMessage: "too long" },
      },
    ]);
    const llm2 = new ScriptedLLM([{ messages: [assistantText("two"), usage(20, 170)] }]);
    const trace = new Writer({ tracesDir: traces, sessionId: "sess_session_note" });
    const session = new Session({
      meta: metaMessage.payload,
      bootstrap: async () => ({ llm: llm1 }),
      environment: fakeEnvironment,
      trace,
      openNextContext: () => ({ llm: llm2 }),
      compaction: settings(),
      imagesDir: "/tmp/penguin-test-scratch",
      modelHasVision: true,
    });
    const oldPath = trace.currentPath();

    await collect(session.run([userText("please refactor the parser")], { approve: allowAll }));
    await collect(session.run([userText("task two")], { approve: allowAll }));

    const note = textOf(llm2.calls[0]![0]!);
    expect(note).not.toBe(bareNote(oldPath));
    expect(note).toContain("please refactor the parser");
    expect(note).toContain(oldPath);
    session.dispose();
  });

  it("a Session whose Trace file cannot be read opens with the note that names the file and quotes nothing", async () => {
    const llm1 = new ScriptedLLM([
      { messages: [assistantText("answer one"), usage(150, 150)] },
      { messages: [], outcome: { status: "fatal", errorCode: "rejected" } },
    ]);
    const llm2 = new ScriptedLLM([{ messages: [assistantText("two"), usage(20, 170)] }]);
    const missing = join(traces, "gone", "sess_unreadable_001.jsonl");
    const session = new Session({
      meta: metaMessage.payload,
      bootstrap: async () => ({ llm: llm1 }),
      environment: fakeEnvironment,
      trace: { write: async () => {}, currentPath: () => missing },
      openNextContext: () => ({ llm: llm2 }),
      compaction: settings(),
      imagesDir: "/tmp/penguin-test-scratch",
      modelHasVision: true,
    });

    await collect(session.run([userText("task one")], { approve: allowAll }));
    await collect(session.run([userText("task two")], { approve: allowAll }));

    expect(textOf(llm2.calls[0]![0]!)).toBe(bareNote(missing));
    session.dispose();
  });

  it("a never-run Session stays a strict no-op on compact, writing no Trace records", async () => {
    // The guard the fix above must not loosen: a Session created in this process has no
    // context, and compacting it must not bootstrap — trace records (session_meta /
    // tool_list_ready) would make an untouched session look resumable.
    let bootstrapped = false;
    const written: AmspRecord[] = [];
    const session = new Session({
      meta: metaMessage.payload,
      bootstrap: async () => {
        bootstrapped = true;
        return { llm: new ScriptedLLM([]) };
      },
      environment: fakeEnvironment,
      trace: {
        write: async (msg) => {
          written.push(msg);
        },
      },
      openNextContext: () => ({ llm: new ScriptedLLM([]) }),
      compaction: settings(),
      imagesDir: "/tmp/penguin-test-scratch",
      modelHasVision: true,
    });

    expect(session.compactability()).toBe("empty");
    expect(await collect(session.compact())).toHaveLength(0);
    expect(bootstrapped).toBe(false);
    expect(written).toHaveLength(0);
    session.dispose();
  });

  it("user abort during the compaction request keeps the context and carries tool outputs over", async () => {
    const controller = new AbortController();
    const llm1 = new ScriptedLLM(
      [
        {
          messages: [toolCall({ name: "t", arguments: "{}", toolCallId: "c1" }), usage(150, 150)],
        },
        { messages: [], outcome: { status: "aborted" } },
      ],
      "llm1",
    );
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      compaction: settings(),
      openNextContext: () => ({ llm: llm1 }),
    });
    // The abort signal is already pending before the compaction request: the fake LLM finishes straight to aborted.
    const approveThenAbort: ApproveFn = async () => "allow";
    const runGen = engine.run([userText("go")], {
      approve: approveThenAbort,
      signal: controller.signal,
    });
    const out: AmspRecord[] = [];
    for await (const msg of runGen) {
      out.push(msg);
      // Simulates a user abort right after the compaction start event (the compaction request then returns aborted).
      const p = msg.payload as { type?: string };
      if (p.type === "compaction_begin") controller.abort();
    }

    const events = compactionEvents(out);
    expect(events[1]).toMatchObject({ type: "compaction_end", status: "aborted" });
    // Interrupt cleanup: the tool output is held as carry-over per case A, and the run wraps up with an abort event.
    expect(payloadTypes(out)).toContain("abort");
  });
});

describe("compaction summary streaming (issue #290)", () => {
  let traces: string;

  beforeEach(async () => {
    traces = await mkdtemp(join(tmpdir(), "penguin-compaction-s-"));
  });

  afterEach(async () => {
    await rm(traces, { recursive: true, force: true });
  });

  /** The text messages the compaction span pushed to the stream, in order. */
  const streamedTexts = (msgs: AmspRecord[]): string[] =>
    msgs
      .filter((m) => {
        const t = (m.payload as { type?: string }).type;
        return t === "partial_text" || t === "text";
      })
      .map((m) => (m.payload as { text?: string }).text ?? "");

  it("streams the summary's own partial_text between the paired events; the complete text stays off the stream", async () => {
    const llm1 = new ScriptedLLM(
      [
        { messages: [assistantText("answer one"), usage(150, 150)] },
        {
          messages: [
            partialText("start"),
            partialText("delta", "[summary]the "),
            partialText("delta", "plan[/summary]"),
            partialText("stop"),
            assistantText("[summary]the plan[/summary]"),
            usage(160, 310),
          ],
        },
      ],
      "llm1",
    );
    const trace = new Writer({ tracesDir: traces, sessionId: "sess_stream" });
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      trace,
      sessionMeta: metaMessage,
      compaction: settings(),
      openNextContext: () => ({ llm: new ScriptedLLM([], "llm2") }),
    });
    const oldPath = trace.currentPath();

    const out = await collect(engine.run([userText("task one")], { approve: allowAll }));

    // The span's fragments ride the stream verbatim — every phase, and the complete text
    // that follows them does NOT re-emit (each character reaches consumers once). The
    // task's own first-turn reply ("answer one") streams no partials in this fixture, so
    // its complete text is the only other entry.
    const types = payloadTypes(out);
    const begin = types.indexOf("compaction_begin");
    const end = types.indexOf("compaction_end");
    const spanTypes = types.slice(begin + 1, end);
    expect(spanTypes.filter((t) => t === "partial_text")).toHaveLength(4);
    expect(spanTypes).not.toContain("text");
    expect(streamedTexts(out.slice(begin + 1, end))).toEqual([
      "",
      "[summary]the ",
      "plan[/summary]",
      "",
    ]);
    // The compaction dialogue is recorded in the old Trace as before — the complete text
    // included (that is what history rebuild reads back), and partials never persist.
    const recorded = await readTrace(oldPath);
    const recordedTexts = recorded
      .filter((m) => (m.payload as { type?: string }).type === "text")
      .map((m) => (m.payload as { text?: string }).text);
    expect(recordedTexts).toContain("[summary]the plan[/summary]");
    expect(payloadTypes(recorded)).not.toContain("partial_text");
  });

  it("an LLM that yields only complete text streams that text instead", async () => {
    const llm1 = new ScriptedLLM(
      [
        { messages: [assistantText("answer one"), usage(150, 150)] },
        { messages: [assistantText("[summary]whole[/summary]"), usage(160, 310)] },
      ],
      "llm1",
    );
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      sessionMeta: metaMessage,
      compaction: settings(),
      openNextContext: () => ({ llm: new ScriptedLLM([], "llm2") }),
    });

    const out = await collect(engine.run([userText("task one")], { approve: allowAll }));
    const types = payloadTypes(out);
    const begin = types.indexOf("compaction_begin");
    const end = types.indexOf("compaction_end");
    expect(streamedTexts(out.slice(begin + 1, end))).toEqual(["[summary]whole[/summary]"]);
  });

  /** The thinking messages the compaction span pushed to the stream, in order. */
  const streamedThinking = (msgs: AmspRecord[]): string[] =>
    msgs
      .filter((m) => {
        const t = (m.payload as { type?: string }).type;
        return t === "partial_thinking" || t === "thinking";
      })
      .map((m) => (m.payload as { thinking?: string }).thinking ?? "");

  it("streams the request's partial_thinking ahead of the summary the same way; the complete thinking stays off the stream", async () => {
    const llm1 = new ScriptedLLM(
      [
        { messages: [assistantText("answer one"), usage(150, 150)] },
        {
          messages: [
            partialThinking("start"),
            partialThinking("delta", "what matters is "),
            partialThinking("delta", "the plan"),
            partialThinking("stop"),
            thinkingMessage("what matters is the plan"),
            partialText("start"),
            partialText("delta", "[summary]the plan[/summary]"),
            partialText("stop"),
            assistantText("[summary]the plan[/summary]"),
            usage(160, 310),
          ],
        },
      ],
      "llm1",
    );
    const trace = new Writer({ tracesDir: traces, sessionId: "sess_stream_thinking" });
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      trace,
      sessionMeta: metaMessage,
      compaction: settings(),
      openNextContext: () => ({ llm: new ScriptedLLM([], "llm2") }),
    });
    const oldPath = trace.currentPath();

    const out = await collect(engine.run([userText("task one")], { approve: allowAll }));

    const types = payloadTypes(out);
    const begin = types.indexOf("compaction_begin");
    const end = types.indexOf("compaction_end");
    const span = out.slice(begin + 1, end);
    const spanTypes = payloadTypes(span);
    // Every phase of the thinking fragment rides the stream, in front of the summary's own
    // fragments, and the complete thinking that follows does not re-emit.
    expect(spanTypes.filter((t) => t === "partial_thinking")).toHaveLength(4);
    expect(spanTypes).not.toContain("thinking");
    expect(spanTypes.indexOf("partial_thinking")).toBeLessThan(spanTypes.indexOf("partial_text"));
    expect(streamedThinking(span)).toEqual(["", "what matters is ", "the plan", ""]);
    expect(streamedTexts(span)).toEqual(["", "[summary]the plan[/summary]", ""]);
    // The old Trace records the complete thinking as before; partials never persist.
    const recorded = await readTrace(oldPath);
    expect(streamedThinking(recorded)).toContain("what matters is the plan");
    expect(payloadTypes(recorded)).not.toContain("partial_thinking");
  });

  it("an LLM that yields only complete thinking streams that thinking instead; a blank fidelity-only thinking stays off the stream", async () => {
    const llm1 = new ScriptedLLM(
      [
        { messages: [assistantText("answer one"), usage(150, 150)] },
        {
          messages: [
            thinkingMessage("whole thought"),
            thinkingMessage("", { signature: "opaque" }),
            assistantText("[summary]whole[/summary]"),
            usage(160, 310),
          ],
        },
      ],
      "llm1",
    );
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      sessionMeta: metaMessage,
      compaction: settings(),
      openNextContext: () => ({ llm: new ScriptedLLM([], "llm2") }),
    });

    const out = await collect(engine.run([userText("task one")], { approve: allowAll }));
    const types = payloadTypes(out);
    const begin = types.indexOf("compaction_begin");
    const end = types.indexOf("compaction_end");
    expect(streamedThinking(out.slice(begin + 1, end))).toEqual(["whole thought"]);
  });
});

describe("a compaction the user quit out of (issue #288)", () => {
  it("resumeTrace reports the unmatched compaction_begin, and discards the interrupted draft", () => {
    // The interrupted compaction's half-written summary is never adopted: the replay
    // reconstructs no [context_summary] and the original context stands (best-effort).
    const interrupted = resumeTrace([
      metaMessage,
      userText("q1"),
      requestBegin(),
      assistantText("a1"),
      usage(150, 150),
      requestEnd("completed"),
      compactionBegin({ reason: "context", mode: "summarize", context: 150, turns: 1 }),
      userText("COMPACT NOW"),
      requestBegin(),
      assistantText("[summary]half-writ"),
    ]);
    expect(interrupted.danglingCompaction).toEqual({ reason: "context", mode: "summarize" });
    expect(interrupted.contextClosed).toBe(false);
    expect(interrupted.pendingSummary).toBeUndefined();
    // The compaction Prompt is not conversational input and is not resent as carry-over.
    expect(interrupted.carryOver.map((m) => (m.payload as TextPayload).text)).not.toContain(
      "COMPACT NOW",
    );
    // The context before the compaction is intact: the committed turn is still history.
    expect(interrupted.history.map((m) => (m.payload as TextPayload).text)).toEqual(["q1", "a1"]);
  });

  it("resumeTrace reports an unmatched compaction_begin for the resume path to close", () => {
    const dangling = resumeTrace([
      metaMessage,
      userText("q1"),
      requestBegin(),
      assistantText("a1"),
      usage(150, 150),
      requestEnd("completed"),
      compactionBegin({ reason: "context", mode: "summarize", context: 150, turns: 1 }),
      userText("COMPACT NOW"),
      requestBegin(),
    ]);
    expect(dangling.danglingCompaction).toEqual({ reason: "context", mode: "summarize" });

    // A matched pair reports nothing — no heal write on healthy traces.
    const closed = resumeTrace([
      metaMessage,
      userText("q1"),
      requestBegin(),
      assistantText("a1"),
      usage(150, 150),
      requestEnd("completed"),
      compactionBegin({ reason: "context", mode: "summarize", context: 150, turns: 1 }),
      userText("COMPACT NOW"),
      requestBegin(),
      requestEnd("aborted"),
      compactionEnd({ reason: "context", mode: "summarize", status: "aborted" }),
    ]);
    expect(closed.danglingCompaction).toBeUndefined();
  });
});

describe("mid-task compaction runs the tools first (issue #288)", () => {
  /** Environment whose tools resolve only when released, recording dispatch order. */
  function gatedEnvironment(): {
    env: EnvironmentInterface;
    dispatched: string[];
    release: () => void;
  } {
    const dispatched: string[] = [];
    let unblock: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    return {
      dispatched,
      release: () => unblock(),
      env: {
        async listTools() {
          return [];
        },
        async *executeTool({ toolCall: tc }) {
          dispatched.push(tc.payload.tool_call_id);
          await gate;
          yield toolCallOutput({
            output: "tool ran",
            toolCallId: tc.payload.tool_call_id,
            status: "completed",
          });
        },
        toolPermission() {
          return "rw";
        },
      },
    };
  }

  it("every tool of the turn completes before the compaction request goes out, and all results ride it", async () => {
    const llm1 = new ScriptedLLM(
      [
        // One turn, three parallel tool calls, then usage over the threshold.
        {
          messages: [
            toolCall({ name: "t", arguments: "{}", toolCallId: "c1" }),
            toolCall({ name: "t", arguments: "{}", toolCallId: "c2" }),
            toolCall({ name: "t", arguments: "{}", toolCallId: "c3" }),
            usage(150, 150),
          ],
        },
        { messages: [assistantText("[summary]continue: step 2[/summary]"), usage(160, 320)] },
      ],
      "llm1",
    );
    const llm2 = new ScriptedLLM([{ messages: [assistantText("done"), usage(30, 360)] }], "llm2");
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      sessionMeta: metaMessage,
      compaction: settings(),
      openNextContext: () => ({ llm: llm2 }),
    });

    const out = await collect(engine.run([userText("go")], { approve: allowAll }));

    // The compaction request carries all three results, in the original call order, ahead
    // of the compaction Prompt — the tools ran to completion first.
    expect(llm1.calls).toHaveLength(2);
    const compactionInput = llm1.calls[1]!;
    expect(payloadTypes(compactionInput)).toEqual([
      "tool_call_output",
      "tool_call_output",
      "tool_call_output",
      "text",
    ]);
    expect(
      compactionInput.slice(0, 3).map((m) => (m.payload as { tool_call_id?: string }).tool_call_id),
    ).toEqual(["c1", "c2", "c3"]);
    expect(textOf(compactionInput[3]!)).toBe("COMPACT NOW");
    // No synthetic assistant text was invented anywhere in the exchange.
    expect(compactionInput.map((m) => (m.payload as { role?: string }).role)).toEqual([
      "user",
      "user",
      "user",
      "user",
    ]);
    // The loop resumes the task on the new context.
    expect(llm2.calls[0]!.map(textOf)).toEqual([
      "[context_summary]\ncontinue: step 2\n[/context_summary]",
    ]);
    expect(out.map((m) => (m.payload as { text?: string }).text)).toContain("done");
  });

  it("a slow tool simply delays the compaction: nothing starts (or times out) until its result is in", async () => {
    const { env, dispatched, release } = gatedEnvironment();
    const llm1 = new ScriptedLLM(
      [
        {
          messages: [toolCall({ name: "t", arguments: "{}", toolCallId: "slow" }), usage(150, 150)],
        },
        { messages: [assistantText("[summary]s[/summary]"), usage(160, 320)] },
      ],
      "llm1",
    );
    const engine = new ContextEngine({
      llm: llm1,
      environment: env,
      sessionMeta: metaMessage,
      compaction: settings(),
      openNextContext: () => ({
        llm: new ScriptedLLM([{ messages: [assistantText("done"), usage(1, 1)] }], "l2"),
      }),
    });

    const gen = engine.run([userText("go")], { approve: allowAll });
    const seen: AmspRecord[] = [];
    // Drive until the tool has been dispatched but not yet answered.
    for (;;) {
      const next = gen.next();
      const settled = await Promise.race([
        next.then((r) => ({ r })),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 30)),
      ]);
      if (settled === null) break; // the loop is parked on the pending tool
      if (settled.r.done) break;
      seen.push(settled.r.value);
    }
    expect(dispatched).toEqual(["slow"]);
    // The compaction has NOT started while the tool is outstanding: no compaction event,
    // and the compaction request was never issued (the LLM saw only the first turn).
    expect(payloadTypes(seen)).not.toContain("compaction_begin");
    expect(llm1.calls).toHaveLength(1);

    release();
    for await (const msg of gen) seen.push(msg);
    // Once the result lands, the compaction runs and carries it.
    expect(compactionEvents(seen).map((e) => e.type)).toEqual([
      "compaction_begin",
      "compaction_end",
    ]);
    expect(payloadTypes(llm1.calls[1]!)).toEqual(["tool_call_output", "text"]);
  });

  it("a failing tool's error output is what rides the compaction request", async () => {
    const failingEnv: EnvironmentInterface = {
      async listTools() {
        return [];
      },
      async *executeTool({ toolCall: tc }) {
        yield toolCallOutput({
          output: "[tool error] boom",
          toolCallId: tc.payload.tool_call_id,
          status: "fatal",
        });
      },
      toolPermission() {
        return "rw";
      },
    };
    const llm1 = new ScriptedLLM(
      [
        { messages: [toolCall({ name: "t", arguments: "{}", toolCallId: "c1" }), usage(150, 150)] },
        { messages: [assistantText("[summary]after the failure[/summary]"), usage(160, 320)] },
      ],
      "llm1",
    );
    const engine = new ContextEngine({
      llm: llm1,
      environment: failingEnv,
      sessionMeta: metaMessage,
      compaction: settings(),
      openNextContext: () => ({
        llm: new ScriptedLLM([{ messages: [assistantText("ok"), usage(1, 1)] }], "l2"),
      }),
    });

    await collect(engine.run([userText("go")], { approve: allowAll }));
    const compactionInput = llm1.calls[1]!;
    expect(payloadTypes(compactionInput)).toEqual(["tool_call_output", "text"]);
    const out = compactionInput[0]!.payload as { output: string; status?: string };
    expect(out.output).toBe("[tool error] boom");
    expect(out.status).toBe("fatal");
  });

  it("a denied tool still pairs: the denial output rides the compaction request", async () => {
    const llm1 = new ScriptedLLM(
      [
        { messages: [toolCall({ name: "t", arguments: "{}", toolCallId: "c1" }), usage(150, 150)] },
        { messages: [assistantText("[summary]after the denial[/summary]"), usage(160, 320)] },
      ],
      "llm1",
    );
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      sessionMeta: metaMessage,
      compaction: settings(),
      openNextContext: () => ({
        llm: new ScriptedLLM([{ messages: [assistantText("ok"), usage(1, 1)] }], "l2"),
      }),
    });

    await collect(engine.run([userText("go")], { approve: async () => "deny" }));
    expect(payloadTypes(llm1.calls[1]!)).toEqual(["tool_call_output", "text"]);
    expect((llm1.calls[1]![0]!.payload as { output: string }).output).toBe(
      "Tool call denied by user.",
    );
  });

  it("manual /compact keeps its own semantics: no turn is pending, so only the Prompt goes out", async () => {
    const llm1 = new ScriptedLLM(
      [
        { messages: [assistantText("first answer"), usage(50, 50)] },
        { messages: [assistantText("[summary]manual[/summary]"), usage(60, 110)] },
      ],
      "llm1",
    );
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      sessionMeta: metaMessage,
      compaction: settings({ maxContextLength: 100000 }),
      openNextContext: () => ({ llm: new ScriptedLLM([], "llm2") }),
    });
    await collect(engine.run([userText("hi")], { approve: allowAll }));
    await collect(engine.compact());
    expect(llm1.calls[1]!.map(textOf)).toEqual(["COMPACT NOW"]);
  });
});

// ---------------------------------------------------------------------------
// Tool rounds: a compaction that hands files to the next context
// ---------------------------------------------------------------------------

/**
 * Tool rounds (CompactionSettings.maxRounds, with the Agent's gate — read_file anywhere,
 * write_file / edit_file inside the Session's scratchpad only):
 *
 * - A response holding a tagged summary and a scratchpad write ends the compaction in one
 *   request: the write is approved and run, and the next context opens with the summary and the
 *   write's result.
 * - Given rounds left, a response that writes a hand-off file with only a preamble is a round:
 *   the call is approved and run, its output goes out behind a line naming the rounds used and
 *   left, and the summary that request writes is adopted; the old Trace and the stream carry
 *   the round in one order, and the summary's trailer names the closed file and how to query it.
 * - A call the gate refuses (a command, a write outside the scratchpad) is answered with a fatal
 *   `[tool error]` naming what is allowed: never put to the approval callback, never run.
 * - A call the approval callback denies gets the denied output and never runs.
 * - Once the rounds are spent, or the window has no room for another, a tool call is refused
 *   without reaching the gate or the approval callback, and corrected with the closed line.
 * - A model that keeps calling tools gets its rounds and two corrections, then the hand-off.
 * - With no rounds (max_rounds 0, or no gate) a summary that also calls tools is adopted in one
 *   request, its calls refused.
 * - An interruption mid-round aborts the running tool, answers every open call, ends the
 *   compaction `aborted`, and the next run sends the outputs first, so the old context pairs.
 */
describe("compaction tool rounds", () => {
  let traces: string;
  let scratch: string;

  beforeEach(async () => {
    traces = await mkdtemp(join(tmpdir(), "penguin-compaction-rounds-"));
    scratch = join(traces, "scratchpad", "sess_rounds");
  });

  afterEach(async () => {
    await rm(traces, { recursive: true, force: true });
  });

  /** An Environment that records what ran; a call named `slow` waits for the signal. */
  const recordingEnvironment = (): { env: EnvironmentInterface; ran: string[] } => {
    const ran: string[] = [];
    const env: EnvironmentInterface = {
      async listTools() {
        return [];
      },
      async *executeTool({ toolCall: tc, signal }) {
        ran.push(tc.payload.name);
        if (tc.payload.name === "edit_file" && tc.payload.arguments.includes("slow")) {
          await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve()));
          yield toolCallOutput({
            output: "[interrupted]",
            toolCallId: tc.payload.tool_call_id,
            status: "aborted",
          });
          return;
        }
        yield toolCallOutput({
          output: `${tc.payload.name} ran`,
          toolCallId: tc.payload.tool_call_id,
          status: "completed",
        });
      },
      toolPermission() {
        return "rw";
      },
    };
    return { env, ran };
  };

  const writeCall = (id: string, file: string): AmspRecord =>
    toolCall({
      name: "write_file",
      arguments: JSON.stringify({ file_path: file, content: "the plan" }),
      toolCallId: id,
    });

  const span = (msgs: AmspRecord[]): AmspRecord[] => {
    const types = payloadTypes(msgs);
    return msgs.slice(types.indexOf("compaction_begin") + 1, types.lastIndexOf("compaction_end"));
  };

  it("a response holding a tagged summary and a scratchpad write ends the compaction in one request, and the next context opens with the summary and the write's result", async () => {
    const plan = join(scratch, "handoff", "plan.md");
    const llm1 = new ScriptedLLM(
      [
        { messages: [assistantText("answer one"), usage(150, 150)] },
        {
          messages: [
            assistantText("[summary]see the plan file[/summary]"),
            writeCall("w1", plan),
            usage(160, 310),
          ],
        },
      ],
      "llm1",
    );
    const llm2 = new ScriptedLLM([{ messages: [assistantText("answer two"), usage(20, 330)] }]);
    const { env, ran } = recordingEnvironment();
    const approved: string[] = [];
    const engine = new ContextEngine({
      llm: llm1,
      environment: env,
      sessionMeta: metaMessage,
      compaction: settings({ maxRounds: 3 }),
      compactionToolGate: compactionToolGate(scratch),
      openNextContext: () => ({ llm: llm2 }),
    });

    const out = await collect(
      engine.run([userText("task one")], {
        approve: async (tc) => {
          approved.push(tc.payload.tool_call_id);
          return "allow";
        },
      }),
    );

    // Approved and run like a turn's call, and nothing more is sent to the old model.
    expect(approved).toEqual(["w1"]);
    expect(ran).toEqual(["write_file"]);
    expect(llm1.calls).toHaveLength(2);
    expect(endOf(out)).toMatchObject({ status: "completed", attempt: 1 });
    expect(endOf(out)).not.toHaveProperty("error_code");
    expect(payloadTypes(span(out))).toEqual([
      "request_begin",
      "text",
      "tool_call",
      "token_usage",
      "request_end",
      "approval_decision",
      "tool_call_output",
    ]);

    await collect(engine.run([userText("task two")], { approve: allowAll }));
    const opening = textOf(llm2.calls[0]![0]!);
    expect(opening.startsWith("[context_summary]\nsee the plan file\n\n")).toBe(true);
    expect(opening).toContain('id="w1" status="completed"');
    expect(opening).toContain("write_file ran");
  });

  it("a summary response whose write was denied still completes, and the next context's opening shows that call as not completed", async () => {
    const llm1 = new ScriptedLLM(
      [
        { messages: [assistantText("answer one"), usage(150, 150)] },
        {
          messages: [
            assistantText("[summary]the plan is in plan.md[/summary]"),
            writeCall("w1", join(scratch, "handoff", "plan.md")),
            usage(160, 310),
          ],
        },
      ],
      "llm1",
    );
    const llm2 = new ScriptedLLM([{ messages: [assistantText("answer two"), usage(20, 330)] }]);
    const { env, ran } = recordingEnvironment();
    const engine = new ContextEngine({
      llm: llm1,
      environment: env,
      sessionMeta: metaMessage,
      compaction: settings({ maxRounds: 3 }),
      compactionToolGate: compactionToolGate(scratch),
      openNextContext: () => ({ llm: llm2 }),
    });

    const out = await collect(engine.run([userText("task one")], { approve: async () => "deny" }));
    await collect(engine.run([userText("task two")], { approve: allowAll }));

    expect(ran).toEqual([]);
    expect(endOf(out)).toMatchObject({ status: "completed", attempt: 1 });
    const opening = textOf(llm2.calls[0]![0]!);
    expect(opening.startsWith("[context_summary]\nthe plan is in plan.md\n\n")).toBe(true);
    expect(opening).toContain('id="w1" status="aborted"');
    expect(opening).not.toContain('id="w1" status="completed"');
  });

  it("a hand-off write with only a preamble is a round: approved, run, sent behind the round line, and the next request's summary is adopted with the trailer", async () => {
    const plan = join(scratch, "handoff", "plan.md");
    const llm1 = new ScriptedLLM(
      [
        { messages: [assistantText("answer one"), usage(150, 150)] },
        {
          messages: [
            assistantText("I will save the plan first."),
            writeCall("h1", plan),
            usage(160, 310),
          ],
        },
        { messages: [assistantText("[summary]see the plan file[/summary]"), usage(170, 480)] },
      ],
      "llm1",
    );
    const llm2 = new ScriptedLLM([{ messages: [assistantText("answer two"), usage(20, 500)] }]);
    const { env, ran } = recordingEnvironment();
    const approved: string[] = [];
    const trace = new Writer({ tracesDir: traces, sessionId: "sess_rounds" });
    const engine = new ContextEngine({
      llm: llm1,
      environment: env,
      trace,
      sessionMeta: metaMessage,
      compaction: settings({ maxRounds: 3 }),
      compactionToolGate: compactionToolGate(scratch),
      shell: "bash",
      openNextContext: () => ({ llm: llm2 }),
    });
    const oldPath = trace.currentPath();

    const out = await collect(
      engine.run([userText("task one")], {
        approve: async (tc) => {
          approved.push(tc.payload.tool_call_id);
          return "allow";
        },
      }),
    );

    expect(approved).toEqual(["h1"]);
    expect(ran).toEqual(["write_file"]);
    // The round's request carries its outputs and the round line: no Prompt again.
    expect(llm1.calls).toHaveLength(3);
    expect(payloadTypes(llm1.calls[2]!)).toEqual(["tool_call_output", "text"]);
    expect((llm1.calls[2]![0]!.payload as { output: string }).output).toBe("write_file ran");
    expect(textOf(llm1.calls[2]![1]!)).toBe(roundLine(1, 3, true));
    const events = compactionEvents(out);
    expect(events[1]).toMatchObject({ type: "compaction_end", status: "completed", attempt: 1 });
    // The stream carries the round as the Trace does; the Prompt and the round line stay
    // Trace-only.
    expect(payloadTypes(span(out))).toEqual([
      "request_begin",
      "text",
      "tool_call",
      "token_usage",
      "request_end",
      "approval_decision",
      "tool_call_output",
      "request_begin",
      "text",
      "token_usage",
      "request_end",
    ]);
    const recorded = payloadTypes(await readTrace(oldPath));
    expect(recorded.slice(recorded.indexOf("compaction_begin"))).toEqual([
      "compaction_begin",
      "text",
      "request_begin",
      "text",
      "tool_call",
      "token_usage",
      "request_end",
      "approval_decision",
      "tool_call_output",
      "text",
      "request_begin",
      "text",
      "token_usage",
      "request_end",
      "compaction_end",
    ]);

    await collect(engine.run([userText("task two")], { approve: allowAll }));
    const opening = textOf(llm2.calls[0]![0]!);
    // The summary is the second response's; the preamble is adopted by nobody.
    expect(opening.startsWith("[context_summary]\nsee the plan file\n\n")).toBe(true);
    expect(opening).not.toContain("I will save the plan first.");
    expect(opening).toContain('id="h1" status="completed"');
    expect(opening).toContain(
      `Transcript of the compacted context, for when the summary is not enough: ${oldPath}.`,
    );
    expect(opening).toContain("`rg -n -o '<pattern>' <file>`");
    expect(opening).not.toContain("Select-String");
    expect(opening.endsWith("[/context_summary]")).toBe(true);
  });

  it("a call the gate refuses is answered with the gate's reason and never approved or run", async () => {
    const llm1 = new ScriptedLLM(
      [
        { messages: [assistantText("answer one"), usage(150, 150)] },
        {
          messages: [
            toolCall({
              name: "exec_command",
              arguments: '{"cmd":"rm -rf build"}',
              toolCallId: "x1",
            }),
            writeCall("x2", join(traces, "outside.md")),
            usage(160, 310),
          ],
        },
        { messages: [assistantText("[summary]nothing written[/summary]"), usage(170, 480)] },
      ],
      "llm1",
    );
    const { env, ran } = recordingEnvironment();
    const approved: string[] = [];
    const engine = new ContextEngine({
      llm: llm1,
      environment: env,
      sessionMeta: metaMessage,
      compaction: settings({ maxRounds: 3 }),
      compactionToolGate: compactionToolGate(scratch),
      openNextContext: () => ({ llm: new ScriptedLLM([], "llm2") }),
    });

    await collect(
      engine.run([userText("task one")], {
        approve: async (tc) => {
          approved.push(tc.payload.tool_call_id);
          return "allow";
        },
      }),
    );

    expect(approved).toEqual([]);
    expect(ran).toEqual([]);
    // Refused inside an open round: the round is spent, and its line follows the refusals.
    expect(payloadTypes(llm1.calls[2]!)).toEqual(["tool_call_output", "tool_call_output", "text"]);
    expect(textOf(llm1.calls[2]![2]!)).toBe(roundLine(1, 3, true));
    const outputs = llm1.calls[2]!.slice(0, 2).map(
      (m) => m.payload as { output: string; status: string },
    );
    expect(outputs.map((o) => o.status)).toEqual(["fatal", "fatal"]);
    for (const o of outputs) {
      expect(o.output).toBe(
        "[tool error] only read_file, and write_file/edit_file inside this Session's scratchpad, are available while compacting",
      );
    }
  });

  it("a call the approval callback denies gets the denied output and never runs", async () => {
    const llm1 = new ScriptedLLM(
      [
        { messages: [assistantText("answer one"), usage(150, 150)] },
        { messages: [writeCall("d1", join(scratch, "handoff", "plan.md")), usage(160, 310)] },
        { messages: [assistantText("[summary]no file[/summary]"), usage(170, 480)] },
      ],
      "llm1",
    );
    const { env, ran } = recordingEnvironment();
    const engine = new ContextEngine({
      llm: llm1,
      environment: env,
      sessionMeta: metaMessage,
      compaction: settings({ maxRounds: 3 }),
      compactionToolGate: compactionToolGate(scratch),
      openNextContext: () => ({ llm: new ScriptedLLM([], "llm2") }),
    });

    const out = await collect(engine.run([userText("task one")], { approve: async () => "deny" }));

    expect(ran).toEqual([]);
    const decision = span(out).find((m) => payloadTypes([m])[0] === "approval_decision")!;
    expect(decision.payload).toMatchObject({ decision: "deny", tool_call_id: "d1" });
    expect(llm1.calls[2]![0]!.payload).toMatchObject({
      output: "Tool call denied by user.",
      status: "aborted",
    });
    expect(compactionEvents(out)[1]).toMatchObject({ status: "completed" });
  });

  /** The Agent's gate, recording every call it is asked about. */
  const askedGate = (): { gate: CompactionToolGate; asked: string[] } => {
    const asked: string[] = [];
    const real = compactionToolGate(scratch);
    return {
      asked,
      gate: (tc) => {
        asked.push(tc.payload.tool_call_id);
        return real(tc);
      },
    };
  };

  it("the line after the last allowed round says none is left; a further call is refused without reaching the gate or the approval callback, and the request after it carries the refusal and the closed line", async () => {
    const file = join(scratch, "handoff", "notes.md");
    const llm1 = new ScriptedLLM(
      [
        { messages: [assistantText("answer one"), usage(150, 150)] },
        { messages: [writeCall("r1", file), usage(160, 310)] },
        // The one round is spent: this call is refused.
        { messages: [writeCall("r2", file), usage(170, 480)] },
        { messages: [assistantText("[summary]done[/summary]"), usage(180, 660)] },
      ],
      "llm1",
    );
    const { env, ran } = recordingEnvironment();
    const { gate, asked } = askedGate();
    const approved: string[] = [];
    const engine = new ContextEngine({
      llm: llm1,
      environment: env,
      sessionMeta: metaMessage,
      compaction: settings({ maxRounds: 1 }),
      compactionToolGate: gate,
      openNextContext: () => ({ llm: new ScriptedLLM([], "llm2") }),
    });

    const out = await collect(
      engine.run([userText("task one")], {
        approve: async (tc) => {
          approved.push(tc.payload.tool_call_id);
          return "allow";
        },
      }),
    );

    expect(ran).toEqual(["write_file"]);
    expect(asked).toEqual(["r1"]);
    expect(approved).toEqual(["r1"]);
    expect(llm1.calls[2]!.map((m) => payloadTypes([m])[0])).toEqual(["tool_call_output", "text"]);
    expect(textOf(llm1.calls[2]![1]!)).toBe(roundLine(1, 1, false));
    expect(llm1.calls[3]!.map((m) => payloadTypes([m])[0])).toEqual(["tool_call_output", "text"]);
    expect(llm1.calls[3]![0]!.payload).toMatchObject({
      tool_call_id: "r2",
      output: `[tool error] ${REFUSED_NO_ROUND}`,
      status: "fatal",
    });
    expect(textOf(llm1.calls[3]![1]!)).toBe(CLOSED_LINE);
    // One correction and the summary; the round is no attempt.
    expect(endOf(out)).toMatchObject({ status: "completed", attempt: 2 });
    // The refused call streams like the one that ran.
    const spanCalls = span(out).filter((m) => payloadTypes([m])[0] === "tool_call");
    expect(spanCalls.map((m) => (m.payload as { tool_call_id: string }).tool_call_id)).toEqual([
      "r1",
      "r2",
    ]);
  });

  it("a round line names the rounds used and no total under the target; from the third it asks for the summary now and says how many more rounds run, and after the last that the harness runs no more", async () => {
    const read = (id: string): ScriptedResponse => ({
      messages: [
        toolCall({
          name: "read_file",
          arguments: JSON.stringify({ file_path: "/ws/a.ts" }),
          toolCallId: id,
        }),
        usage(160, 0),
      ],
    });
    const llm1 = new ScriptedLLM(
      [
        { messages: [assistantText("answer one"), usage(150, 150)] },
        ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => read(`r${n}`)),
        { messages: [assistantText("[summary]done[/summary]"), usage(170, 0)] },
      ],
      "llm1",
    );
    const { env, ran } = recordingEnvironment();
    const engine = new ContextEngine({
      llm: llm1,
      environment: env,
      compaction: settings({ maxRounds: 8 }),
      compactionToolGate: compactionToolGate(scratch),
      openNextContext: () => ({ llm: new ScriptedLLM([], "llm2") }),
    });

    const out = await collect(engine.run([userText("task one")], { approve: allowAll }));

    expect(ran).toEqual(Array<string>(8).fill("read_file"));
    // The request after each round ends with that round's line.
    const lines = llm1.calls.slice(2, 10).map((c) => textOf(c.at(-1)!));
    // Under the target: the round used, and neither a total nor a count left.
    expect(lines[0]).toContain("Tool round 1 done.");
    expect(lines[1]).toContain("Tool round 2 done.");
    for (const line of lines.slice(0, 2)) expect(line).not.toMatch(/\b8\b|more round|left/);
    // From the target on: the summary is due now, and the line says how many more rounds run.
    expect(lines[2]).toContain("Tool round 3 done;");
    expect(lines[2]).toContain("Reply with the summary now");
    expect(lines[2]).toContain("for 5 more rounds");
    expect(lines[6]).toContain("for 1 more round,");
    // After the last: none left.
    expect(lines[7]).toContain("Tool round 8 done; the harness runs no more.");
    expect(endOf(out)).toMatchObject({ status: "completed", attempt: 1 });
    expect(endOf(out)).not.toHaveProperty("error_code");
  });

  it("a model that keeps calling tools gets its eight rounds, then the refusals and two corrections, and the compaction completes with the hand-off note", async () => {
    const read = (id: string): ScriptedResponse => ({
      messages: [
        toolCall({
          name: "read_file",
          arguments: JSON.stringify({ file_path: "/ws/a.ts" }),
          toolCallId: id,
        }),
        usage(160, 0),
      ],
    });
    const llm1 = new ScriptedLLM(
      [
        { messages: [assistantText("answer one"), usage(150, 150)] },
        ...Array.from({ length: 11 }, (_, i) => read(`r${i + 1}`)),
        // Never requested.
        { messages: [assistantText("[summary]late[/summary]")] },
      ],
      "llm1",
    );
    const llm2 = new ScriptedLLM([{ messages: [assistantText("two"), usage(20, 0)] }], "llm2");
    const { env, ran } = recordingEnvironment();
    const engine = new ContextEngine({
      llm: llm1,
      environment: env,
      compaction: settings({ maxRounds: 8 }),
      compactionToolGate: compactionToolGate(scratch),
      openNextContext: () => ({ llm: llm2 }),
    });

    const out = await collect(engine.run([userText("task one")], { approve: allowAll }));
    await collect(engine.run([userText("task two")], { approve: allowAll }));

    // The turn, the Prompt's request, then eight rounds' and two corrections' requests.
    expect(llm1.calls).toHaveLength(12);
    expect(ran).toEqual(Array<string>(8).fill("read_file"));
    expect(llm1.calls.slice(10).map((c) => textOf(c.at(-1)!))).toEqual([CLOSED_LINE, CLOSED_LINE]);
    expect(endOf(out)).toMatchObject({ status: "completed", attempt: 3, error_code: "malformed" });
    expect(llm2.calls[0]!.map(textOf)).toEqual([bareNote(), "task two"]);
  });

  it("once the context is past the round limit, a tool-calling response is refused even with rounds left", async () => {
    const file = join(scratch, "handoff", "notes.md");
    const llm1 = new ScriptedLLM(
      [
        { messages: [assistantText("answer one"), usage(100, 100)] },
        // Under the limit: a round. Its own request brings the context past it.
        { messages: [writeCall("r1", file), usage(140, 240)] },
        { messages: [writeCall("r2", file), usage(150, 390)] },
        { messages: [assistantText("[summary]done[/summary]"), usage(160, 550)] },
      ],
      "llm1",
    );
    const { env, ran } = recordingEnvironment();
    const { gate, asked } = askedGate();
    const engine = new ContextEngine({
      llm: llm1,
      environment: env,
      sessionMeta: metaMessage,
      compaction: settings({ maxRounds: 8, roundLimit: 130 }),
      compactionToolGate: gate,
      openNextContext: () => ({ llm: new ScriptedLLM([], "llm2") }),
    });

    const out = await collect(engine.run([userText("task one")], { approve: allowAll }));

    expect(ran).toEqual(["write_file"]);
    expect(asked).toEqual(["r1"]);
    // The window, not the count, closed the next round: the line says so.
    expect(textOf(llm1.calls[2]![1]!)).toBe(roundLine(1, 8, false));
    expect(textOf(llm1.calls[2]![1]!)).toContain("no room for another");
    expect(llm1.calls[3]![0]!.payload).toMatchObject({
      tool_call_id: "r2",
      output: `[tool error] ${REFUSED_NO_ROUND}`,
    });
    expect(textOf(llm1.calls[3]![1]!)).toBe(CLOSED_LINE);
    expect(endOf(out)).toMatchObject({ status: "completed", attempt: 2 });
  });

  it("a model that keeps calling tools gets its rounds and two corrections and no more requests; the compaction then completes with the hand-off note and the Task carries on in the new context", async () => {
    const read = (id: string): ScriptedResponse => ({
      messages: [
        toolCall({
          name: "read_file",
          arguments: JSON.stringify({ file_path: "/ws/a.ts" }),
          toolCallId: id,
        }),
        usage(160, 0),
      ],
    });
    const llm1 = new ScriptedLLM(
      [
        { messages: [toolCall({ name: "t", arguments: "{}", toolCallId: "c0" }), usage(150, 150)] },
        read("r1"),
        read("r2"),
        read("r3"),
        read("r4"),
        read("r5"),
        read("r6"),
        // Never requested.
        { messages: [assistantText("[summary]late[/summary]")] },
      ],
      "llm1",
    );
    const llm2 = new ScriptedLLM([{ messages: [assistantText("done"), usage(30, 0)] }], "llm2");
    const { env, ran } = recordingEnvironment();
    const engine = new ContextEngine({
      llm: llm1,
      environment: env,
      compaction: settings({ maxRounds: 3 }),
      compactionToolGate: compactionToolGate(scratch),
      openNextContext: () => ({ llm: llm2 }),
    });

    const { all, cutoff } = await collectWithReturn(
      engine.run([userText("task one")], { approve: allowAll }),
    );

    // The turn, then 3 rounds + 3 refused responses (the third one ends the corrections).
    expect(llm1.calls).toHaveLength(7);
    expect(ran).toEqual(["t", "read_file", "read_file", "read_file"]);
    expect(llm1.calls.slice(2, 5).map((c) => textOf(c.at(-1)!))).toEqual([
      roundLine(1, 3, true),
      roundLine(2, 3, true),
      roundLine(3, 3, false),
    ]);
    expect(llm1.calls.slice(5).map((c) => textOf(c.at(-1)!))).toEqual([CLOSED_LINE, CLOSED_LINE]);
    expect(endOf(all)).toMatchObject({
      status: "completed",
      attempt: 3,
      error_code: "malformed",
      error_message: "the response called tools instead of writing a summary",
    });
    expect(cutoff).toBeNull();
    expect(llm2.calls[0]!.map(textOf)).toEqual([bareNote()]);
    expect(all.map((m) => (m.payload as { text?: string }).text)).toContain("done");
  });

  it.each([
    ["max_rounds 0", { maxRounds: 0 }, true],
    ["no gate", { maxRounds: 3 }, false],
  ] as const)(
    "with %s a summary that also calls tools is adopted in one request, its calls refused",
    async (_label, over, withGate) => {
      const llm1 = new ScriptedLLM(
        [
          { messages: [assistantText("answer one"), usage(150, 150)] },
          {
            messages: [
              assistantText("[summary]plain[/summary]"),
              writeCall("z1", join(scratch, "handoff", "plan.md")),
              usage(160, 310),
            ],
          },
        ],
        "llm1",
      );
      const llm2 = new ScriptedLLM([{ messages: [assistantText("two"), usage(20, 330)] }]);
      const { env, ran } = recordingEnvironment();
      const approved: string[] = [];
      const engine = new ContextEngine({
        llm: llm1,
        environment: env,
        sessionMeta: metaMessage,
        compaction: settings(over),
        ...(withGate ? { compactionToolGate: compactionToolGate(scratch) } : {}),
        openNextContext: () => ({ llm: llm2 }),
      });

      const out = await collect(
        engine.run([userText("task one")], {
          approve: async (tc) => {
            approved.push(tc.payload.tool_call_id);
            return "allow";
          },
        }),
      );
      await collect(engine.run([userText("task two")], { approve: allowAll }));

      expect(ran).toEqual([]);
      expect(approved).toEqual([]);
      expect(llm1.calls).toHaveLength(2);
      expect(endOf(out)).toMatchObject({ status: "completed", attempt: 1 });
      const refusal = span(out).find((m) => payloadTypes([m])[0] === "tool_call_output")!;
      expect(refusal.payload).toMatchObject({
        tool_call_id: "z1",
        output: `[tool error] ${REFUSED_NO_ROUND}`,
        status: "fatal",
      });
      const opening = textOf(llm2.calls[0]![0]!);
      expect(opening.startsWith("[context_summary]\nplain\n\n")).toBe(true);
      expect(opening).toContain('id="z1" status="fatal"');
    },
  );

  it("an interruption mid-round aborts the running tool, answers every open call, and the next run sends the outputs first", async () => {
    const ac = new AbortController();
    const llm1 = new ScriptedLLM(
      [
        { messages: [assistantText("answer one"), usage(150, 150)] },
        {
          messages: [
            toolCall({
              name: "edit_file",
              arguments: JSON.stringify({
                file_path: join(scratch, "slow.md"),
                old_string: "slow",
              }),
              toolCallId: "a1",
            }),
            writeCall("a2", join(scratch, "handoff", "next.md")),
            usage(160, 310),
          ],
        },
        { messages: [assistantText("on the old context"), usage(50, 360)] },
      ],
      "llm1",
    );
    const { env, ran } = recordingEnvironment();
    const trace = new Writer({ tracesDir: traces, sessionId: "sess_rounds_abort" });
    const engine = new ContextEngine({
      llm: llm1,
      environment: env,
      trace,
      sessionMeta: metaMessage,
      compaction: settings({ maxRounds: 3 }),
      compactionToolGate: compactionToolGate(scratch),
      openNextContext: () => ({ llm: new ScriptedLLM([], "llm2") }),
    });
    const oldPath = trace.currentPath();

    let approvals = 0;
    const out = await collect(
      engine.run([userText("task one")], {
        signal: ac.signal,
        approve: async () => {
          approvals += 1;
          // The slow edit is running; the user stops while the second call waits.
          if (approvals === 2) ac.abort();
          return "allow";
        },
      }),
    );

    expect(ran).toEqual(["edit_file"]);
    expect(compactionEvents(out)[1]).toMatchObject({ status: "aborted" });
    const outputs = span(out).filter((m) => payloadTypes([m])[0] === "tool_call_output");
    expect(outputs.map((m) => m.payload)).toEqual([
      expect.objectContaining({ tool_call_id: "a1", status: "aborted" }),
      expect.objectContaining({
        tool_call_id: "a2",
        status: "aborted",
        output: "[interrupted: tool aborted by user]",
      }),
    ]);
    // Written too, so a resume pairs the calls exactly as the live context does.
    const recorded = await readTrace(oldPath);
    expect(
      recorded.filter((m) => payloadTypes([m])[0] === "tool_call_output").map((m) => m.payload),
    ).toEqual(outputs.map((m) => m.payload));
    // The next run answers both calls first, on the old context.
    await collect(engine.run([userText("go on")], { approve: allowAll }));
    expect(payloadTypes(llm1.calls[2]!)).toEqual(["tool_call_output", "tool_call_output", "text"]);
    expect(trace.currentPath()).toBe(oldPath);
  });
});

/**
 * A request the provider refuses as sent (`rejected`) on a context that has completed a turn.
 *
 * - The run goes on: the context is closed with no compaction request — a span that holds no
 *   request and ends completed with the provider's error — and the next opens with the hand-off
 *   note; the refused request is recorded as a retried attempt.
 * - The turn is sent again behind the note, its text alone: steering rides, tool outputs do
 *   not, and the note quotes them and the refusal.
 * - Never on a context's first request (so never twice in a row), never for another code, at
 *   most three times a run, after the image rule; the mode and the threshold do not matter, the
 *   capability to open a context does. The resend is the same turn, for the turn cap too.
 * - A next context that cannot be opened ends the run `compaction_failure` on the kept context;
 *   a stop while it opens leaves the note pending.
 */
describe("a request the provider refuses hands off to a new context", () => {
  let traces: string;

  beforeEach(async () => {
    traces = await mkdtemp(join(tmpdir(), "penguin-refusal-"));
  });

  afterEach(async () => {
    await rm(traces, { recursive: true, force: true });
  });

  const refusal = "prompt is too long: 250000 tokens > 200000 maximum";
  const refused = (errorMessage = refusal): ScriptedResponse => ({
    messages: [],
    outcome: { status: "fatal", errorCode: "rejected", errorMessage },
  });
  const callTurn = (id: string): ScriptedResponse => ({
    messages: [toolCall({ name: "t", arguments: "{}", toolCallId: id }), usage(150, 0)],
  });
  const finished = (): ScriptedLLM =>
    new ScriptedLLM([{ messages: [assistantText("finished"), usage(40, 0)] }], "llm2");
  /** Far from the threshold: only a refusal closes the context. */
  const roomy = (over: Partial<CompactionSettings> = {}): CompactionSettings =>
    settings({ maxContextLength: 100_000, ...over });
  const requestEnds = (msgs: AmspRecord[]): RequestEndPayload[] =>
    msgs
      .filter((m) => payloadTypes([m])[0] === "request_end")
      .map((m) => m.payload as RequestEndPayload);
  const compactionEnds = (msgs: AmspRecord[]): CompactionEventPayload[] =>
    compactionEvents(msgs).filter((e) => e.type === "compaction_end");
  /** Each record's kind: its payload type, or `session_meta` (whose payload carries none). */
  const kinds = (msgs: AmspRecord[]): (string | undefined)[] =>
    msgs.map((m) => (m.type === "session_meta" ? m.type : payloadTypes([m])[0]));

  it("a refusal on a context that has completed a turn does not end the run: no compaction request is sent, the next context opens with the hand-off note, and the Task finishes there", async () => {
    const llm1 = new ScriptedLLM([callTurn("c1"), refused()], "llm1");
    const llm2 = finished();
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      compaction: roomy(),
      openNextContext: () => ({ llm: llm2 }),
    });

    const { all, cutoff } = await collectWithReturn(
      engine.run([userText("go")], { approve: allowAll }),
    );

    expect(cutoff).toBeNull();
    // The turn and the refused request: the old model is asked nothing more.
    expect(llm1.calls).toHaveLength(2);
    expect(llm2.calls).toHaveLength(1);
    expect(llm2.calls[0]!.map(textOf)).toEqual([bareNote()]);
    expect(all.map((m) => (m.payload as { text?: string }).text)).toContain("finished");
    expect(payloadTypes(all)).not.toContain("abort");
  });

  it("the refused request is recorded as a retried attempt, and the span that follows holds no request and ends completed with the provider's error", async () => {
    const llm1 = new ScriptedLLM([callTurn("c1"), refused()], "llm1");
    const trace = new Writer({ tracesDir: traces, sessionId: "sess_refused_shape" });
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      trace,
      sessionMeta: metaMessage,
      compaction: roomy(),
      openNextContext: () => ({ llm: finished() }),
    });
    const oldPath = trace.currentPath();

    const out = await collect(engine.run([userText("go")], { approve: allowAll }));

    const closed = await readTrace(oldPath);
    expect(payloadTypes(closed).slice(-4)).toEqual([
      "request_begin",
      "request_end",
      "compaction_begin",
      "compaction_end",
    ]);
    expect(closed.at(-3)!.payload).toMatchObject({
      status: "retryable",
      error_code: "rejected",
      error_message: refusal,
      attempt: 1,
      retry_in_ms: 0,
    });
    expect(closed.at(-2)!.payload).toMatchObject({
      reason: "context",
      mode: "summarize",
      context: 150,
      turns: 1,
    });
    expect(closed.at(-1)!.payload).toEqual({
      type: "compaction_end",
      reason: "context",
      mode: "summarize",
      status: "completed",
      error_code: "rejected",
      error_message: refusal,
    });
    // The next file: its meta, the note as its first input, then the same turn sent again.
    const opened = await readTrace(trace.currentPath());
    expect(kinds(opened)).toEqual([
      "session_meta",
      "text",
      "request_begin",
      "text",
      "token_usage",
      "request_end",
    ]);
    expect(textOf(opened[1]!)).toBe(bareNote(oldPath));
    expect(opened.at(-1)!.payload).toMatchObject({ status: "completed", attempt: 2 });
    // The stream carries the same records in the same order, the note itself excepted.
    const at = out.findIndex(
      (m) => (m.payload as { type?: string; status?: string }).status === "retryable",
    );
    expect(kinds(out.slice(at - 1))).toEqual([
      "request_begin",
      "request_end",
      "compaction_begin",
      "compaction_end",
      "session_meta",
      "request_begin",
      "text",
      "token_usage",
      "request_end",
    ]);
  });

  it("a steering message in the refused input is sent again behind the note; the turn's tool outputs are not, and the note quotes them and the provider's error", async () => {
    const llm1 = new ScriptedLLM([callTurn("c1"), refused()], "llm1");
    const llm2 = finished();
    const trace = new Writer({ tracesDir: traces, sessionId: "sess_refused_steer" });
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      trace,
      sessionMeta: metaMessage,
      compaction: roomy(),
      openNextContext: () => ({ llm: llm2 }),
      // What the Session supplies: the note built from the file being closed.
      buildHandoff: async () => {
        const path = trace.currentPath();
        return userText(buildCompactionHandoff(await readTrace(path), { tracePath: path }));
      },
    });

    await collect(
      engine.run([userText("go")], {
        approve: async () => {
          engine.steer([userText("use the smaller fixture")]);
          return "allow";
        },
      }),
    );

    // The refused request carried the turn's output and the steering message.
    expect(payloadTypes(llm1.calls[1]!)).toEqual(["tool_call_output", "text"]);
    const steering = llm1.calls[1]![1]!;
    const [note, ...behind] = llm2.calls[0]!;
    expect(behind).toEqual([steering]);
    expect(textOf(note!)).toContain(transcribeToolCallOutput("c1", "completed", "tool ran"));
    expect(textOf(note!)).toContain(transcribeRequestError("rejected", refusal));
  });

  it("the request right after a hand-off, refused too, ends the run with the provider's error; so does a refusal of a Session's first request", async () => {
    const llm1 = new ScriptedLLM([callTurn("c1"), refused()], "llm1");
    const llm2 = new ScriptedLLM([refused("still too long")], "llm2");
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      compaction: roomy(),
      openNextContext: () => ({ llm: llm2 }),
    });

    const { all, cutoff } = await collectWithReturn(
      engine.run([userText("go")], { approve: allowAll }),
    );

    expect(cutoff).toEqual({
      kind: "llm_failure",
      errorCode: "rejected",
      errorMessage: "still too long",
    });
    expect(compactionEnds(all)).toHaveLength(1);
    const last = requestEnds(all).at(-1)!;
    expect(last).toMatchObject({ status: "fatal", error_code: "rejected" });
    expect(last).not.toHaveProperty("retry_in_ms");

    const fresh = new ContextEngine({
      llm: new ScriptedLLM([refused()], "fresh"),
      environment: fakeEnvironment,
      compaction: roomy(),
      openNextContext: () => ({ llm: finished() }),
    });
    const first = await collectWithReturn(fresh.run([userText("go")], { approve: allowAll }));
    expect(first.cutoff).toEqual({
      kind: "llm_failure",
      errorCode: "rejected",
      errorMessage: refusal,
    });
    expect(compactionEvents(first.all)).toEqual([]);
  });

  it.each(["denied", "auth", "unsupported", "invalid_input"] as const)(
    "a %s request ends the run and keeps the context",
    async (errorCode) => {
      const llm1 = new ScriptedLLM(
        [
          callTurn("c1"),
          { messages: [], outcome: { status: "fatal", errorCode, errorMessage: "no" } },
          { messages: [assistantText("still here"), usage(40, 0)] },
        ],
        "llm1",
      );
      let opened = 0;
      const engine = new ContextEngine({
        llm: llm1,
        environment: fakeEnvironment,
        compaction: roomy(),
        openNextContext: () => {
          opened += 1;
          return { llm: finished() };
        },
      });

      const { all, cutoff } = await collectWithReturn(
        engine.run([userText("go")], { approve: allowAll }),
      );

      expect(cutoff).toEqual({ kind: "llm_failure", errorCode, errorMessage: "no" });
      expect(compactionEvents(all)).toEqual([]);
      expect(opened).toBe(0);
      await collect(engine.run([userText("again")], { approve: allowAll }));
      expect(llm1.calls).toHaveLength(3);
    },
  );

  it("a refused request whose input holds an image is first sent again with the image replaced; refused again, it hands off", async () => {
    const imageEnvironment: EnvironmentInterface = {
      ...fakeEnvironment,
      async *executeTool({ toolCall: tc }) {
        yield toolCallOutput({
          output: "screenshot taken",
          images: ["data:image/png;base64,AAAA"],
          toolCallId: tc.payload.tool_call_id,
          status: "completed",
        });
      },
    };
    const llm1 = new ScriptedLLM([callTurn("c1"), refused("bad image"), refused()], "llm1");
    const llm2 = finished();
    const engine = new ContextEngine({
      llm: llm1,
      environment: imageEnvironment,
      compaction: roomy(),
      openNextContext: () => ({ llm: llm2 }),
    });

    const { all, cutoff } = await collectWithReturn(
      engine.run([userText("go")], { approve: allowAll }),
    );

    expect(cutoff).toBeNull();
    expect(llm1.calls).toHaveLength(3);
    const resent = llm1.calls[2]![0]!.payload as { images?: string[]; output: string };
    expect(resent.images).toBeUndefined();
    expect(resent.output).toContain(REJECTED_IMAGE_NOTE);
    expect(requestEnds(all).slice(1, 3)).toEqual([
      expect.objectContaining({
        status: "retryable",
        error_code: "image_rejected",
        retry_in_ms: 0,
      }),
      expect.objectContaining({ status: "retryable", error_code: "rejected", retry_in_ms: 0 }),
    ]);
    expect(llm2.calls[0]!.map(textOf)).toEqual([bareNote()]);
  });

  it.each([
    ["the threshold off", { maxContextLength: 0 }],
    ["discard mode", { mode: "discard" as const }],
  ])("with %s a refusal still hands off", async (_label, over) => {
    const llm2 = finished();
    const engine = new ContextEngine({
      llm: new ScriptedLLM([callTurn("c1"), refused()], "llm1"),
      environment: fakeEnvironment,
      compaction: roomy(over),
      openNextContext: () => ({ llm: llm2 }),
    });

    const { all, cutoff } = await collectWithReturn(
      engine.run([userText("go")], { approve: allowAll }),
    );

    expect(cutoff).toBeNull();
    expect(endOf(all)).toMatchObject({ status: "completed", error_code: "rejected" });
    expect(llm2.calls[0]!.map(textOf)).toEqual([bareNote()]);
  });

  it("with no compaction configured a refusal ends the run", async () => {
    const engine = new ContextEngine({
      llm: new ScriptedLLM([callTurn("c1"), refused()], "llm1"),
      environment: fakeEnvironment,
    });

    const { all, cutoff } = await collectWithReturn(
      engine.run([userText("go")], { approve: allowAll }),
    );

    expect(cutoff).toEqual({ kind: "llm_failure", errorCode: "rejected", errorMessage: refusal });
    expect(compactionEvents(all)).toEqual([]);
  });

  it("a fourth refusal in one run ends the run", async () => {
    // Each context completes a turn that calls a tool, then refuses the request after it.
    const contexts = [1, 2, 3, 4].map(
      (n) => new ScriptedLLM([callTurn(`c${n}`), refused(`refusal ${n}`)], `llm${n}`),
    );
    let opened = 0;
    const engine = new ContextEngine({
      llm: contexts[0]!,
      environment: fakeEnvironment,
      compaction: roomy(),
      openNextContext: () => ({ llm: contexts[++opened]! }),
    });

    const { all, cutoff } = await collectWithReturn(
      engine.run([userText("go")], { approve: allowAll }),
    );

    expect(opened).toBe(3);
    expect(compactionEnds(all)).toHaveLength(3);
    expect(cutoff).toEqual({
      kind: "llm_failure",
      errorCode: "rejected",
      errorMessage: "refusal 4",
    });
  });

  it("a run capped at N turns still gets N turns when one of them was resent after a hand-off", async () => {
    const llm2 = new ScriptedLLM([callTurn("c2"), { messages: [assistantText("never")] }], "llm2");
    const engine = new ContextEngine({
      llm: new ScriptedLLM([callTurn("c1"), refused()], "llm1"),
      environment: fakeEnvironment,
      maxTurns: 2,
      compaction: roomy(),
      openNextContext: () => ({ llm: llm2 }),
    });

    const { cutoff } = await collectWithReturn(engine.run([userText("go")], { approve: allowAll }));

    // Turn one on the old context; turn two refused there and sent again on the new one.
    expect(llm2.calls).toHaveLength(1);
    expect(cutoff).toMatchObject({ kind: "max_turns" });
  });

  it("a hand-off whose next context cannot be opened ends fatal, returns compaction_failure, keeps the context, and the next run's first request is accepted by the old model", async () => {
    const llm1 = new ScriptedLLM(
      [
        callTurn("c1"),
        refused(),
        { messages: [assistantText("on the old context"), usage(60, 0)] },
      ],
      "llm1",
    );
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      compaction: roomy(),
      openNextContext: () => {
        throw new Error("no client for the model");
      },
    });

    const { all, cutoff } = await collectWithReturn(
      engine.run([userText("go")], { approve: allowAll }),
    );

    expect(cutoff).toEqual({ kind: "compaction_failure", errorMessage: "no client for the model" });
    expect(endOf(all)).toMatchObject({ status: "fatal", error_message: "no client for the model" });
    expect(endOf(all).error_code).toBeUndefined();
    expect(payloadTypes(all)).not.toContain("abort");
    expect(engine.compactability()).toBe("ok");
    const next = await collectWithReturn(engine.run([userText("carry on")], { approve: allowAll }));
    expect(next.cutoff).toBeNull();
    // The turn's output still answers the committed call, ahead of everything else.
    expect(payloadTypes(llm1.calls[2]!)).toEqual(["tool_call_output", "text", "text"]);
    expect(llm1.calls[2]![0]!.payload).toMatchObject({ tool_call_id: "c1" });
    expect(textOf(llm1.calls[2]![2]!)).toBe("carry on");
  });

  it("a stop that arrives while the next context opens leaves the note as pending input", async () => {
    const ac = new AbortController();
    // The new context's first request honours the stop, as a real model does.
    const llm2 = new ScriptedLLM(
      [
        { messages: [], outcome: { status: "aborted" } },
        { messages: [assistantText("resumed"), usage(40, 0)] },
      ],
      "llm2",
    );
    const engine = new ContextEngine({
      llm: new ScriptedLLM([callTurn("c1"), refused()], "llm1"),
      environment: fakeEnvironment,
      compaction: roomy(),
      openNextContext: () => {
        ac.abort();
        return { llm: llm2 };
      },
    });

    const { all, cutoff } = await collectWithReturn(
      engine.run([userText("go")], { signal: ac.signal, approve: allowAll }),
    );

    expect(cutoff).toEqual({ kind: "abort", errorCode: "user_abort" });
    expect(endOf(all)).toMatchObject({ status: "completed", error_code: "rejected" });
    expect(engine.hasPendingInput()).toBe(true);
    await collect(engine.run([userText("go on")], { approve: allowAll }));
    expect(llm2.calls).toHaveLength(2);
    expect(textOf(llm2.calls[1]![0]!)).toContain(transcribeUserInput(bareNote()));
    expect(textOf(llm2.calls[1]!.at(-1)!)).toBe("go on");
  });
});
