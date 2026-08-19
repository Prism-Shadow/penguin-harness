/**
 * Context compaction tests.
 *
 * - Trigger: context usage (the request.total of the most recent token_usage) or the session's
 *   cumulative turn count **reaching** the threshold (>=); the check runs after every LLM
 *   request emits token_usage, both mid-task and at the wrap-up round (reaching the threshold at
 *   task end triggers compaction immediately, without waiting for the next task).
 * - summarize: appends a compaction prompt to the old LLM (merging in all of this round's tool
 *   results first if mid-task); the summary is wrapped as a `[context_summary]` user text and fed
 *   as the first input to the new LLM instance; on failure the original context is kept, never downgraded to discard.
 *   The compaction request carries the session's toolset unchanged (the prompt-cache prefix must
 *   stay byte-identical, #84), and a completed response only counts as success with a valid
 *   summary — non-empty extracted text and no tool calls (issue #83). A rejected response has its
 *   tool calls answered by synthesized failed outputs (pairing repair) and is retried under a
 *   dedicated cap of 5 rejections; then the compaction fails. Retryable attempts
 *   (failed/timeout/malformed) take the compaction-specific reconnect cap — the same set the
 *   turn loop retries, on a shorter budget; only `auth` stops at once.
 * - discard: deferred until task end if mid-task; sends no compaction request, just swaps in a new LLM instance directly.
 * - Process visibility: the compaction request's streamed output is never surfaced to the human,
 *   only the paired compaction events are emitted; the dialogue is written to the old trace, and
 *   on success the trace rotates into a new file (index+1, the new file starts with session_meta;
 *   rotation is deferred until the new context has its first message to write).
 */
import { mkdtemp, rm, access, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assistantText,
  compactionBegin,
  compactionEnd,
  partialText,
  requestBegin,
  requestEnd,
  sessionMeta,
  thinkingMessage,
  tokenUsage,
  toolCall,
  toolCallOutput,
  userText,
} from "../src/omnimessage/index.js";
import type {
  CompactionBeginPayload,
  CompactionEndPayload,
  OmniMessage,
  TextPayload,
  TokenCounts,
  TokenUsagePayload,
} from "../src/omnimessage/index.js";
import type {
  ApproveFn,
  EnvironmentInterface,
  GenerativeModelParameters,
  LLMInterface,
  LLMOutcome,
} from "../src/interfaces.js";
import { ContextEngine, SUMMARY_RETRY_GUIDANCE } from "../src/engine/context-engine.js";
import type { CompactionSettings } from "../src/engine/context-engine.js";
import { GenerativeModel } from "../src/llm/index.js";
import type { UniConfig, UniEvent, UniMessage } from "@prismshadow/agenthub";
import { Writer, readTrace, resumeTrace } from "../src/trace/index.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

interface ScriptedResponse {
  messages: OmniMessage[];
  outcome?: LLMOutcome;
}

/** Fake LLM that responds according to a script, recording each input it receives. */
class ScriptedLLM implements LLMInterface {
  calls: OmniMessage[][] = [];
  constructor(
    private readonly responses: ScriptedResponse[],
    readonly label = "llm",
  ) {}

  async *streamGenerate(
    params: GenerativeModelParameters,
  ): AsyncGenerator<OmniMessage, LLMOutcome> {
    this.calls.push(params.newMessages);
    const next = this.responses.shift();
    if (!next) {
      return { status: "failed", errorMessage: `${this.label}: no scripted response` };
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
    });
  },
  toolPermission() {
    return "rw";
  },
};

const allowAll: ApproveFn = async () => "allow";

/** Builds a token_usage: request.total is the context-usage figure, session.total is the cumulative one. */
const usage = (requestTotal: number, sessionTotal: number): OmniMessage =>
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
});

async function collect(gen: AsyncGenerator<OmniMessage>): Promise<OmniMessage[]> {
  const all: OmniMessage[] = [];
  for await (const msg of gen) all.push(msg);
  return all;
}

type CompactionEventPayload = CompactionBeginPayload | CompactionEndPayload;

const compactionEvents = (msgs: OmniMessage[]): CompactionEventPayload[] =>
  msgs
    .filter((m) => {
      const t = (m.payload as { type?: string }).type ?? "";
      return t === "compaction_begin" || t === "compaction_end";
    })
    .map((m) => m.payload as CompactionEventPayload);

const payloadTypes = (msgs: OmniMessage[]): (string | undefined)[] =>
  msgs.map((m) => (m.payload as { type?: string }).type);

const textOf = (m: OmniMessage): string => (m.payload as TextPayload).text;

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
    let factoryTokens: TokenCounts | null = null;
    const trace = new Writer({ tracesDir: traces, sessionId: "sess_compact" });
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      trace,
      sessionMeta: metaMessage,
      compaction: settings(),
      createLLM: (tokens) => {
        factoryTokens = tokens;
        return llm2;
      },
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

    // The new LLM instance carries over the session's cumulative tokens (including compaction request usage).
    expect(factoryTokens).toMatchObject({ total: 310 });

    // The summary is merged with the next user prompt as the new LLM instance's first input.
    await collect(engine.run([userText("task two")], { approve: allowAll }));
    expect(llm1.calls).toHaveLength(2);
    expect(llm2.calls).toHaveLength(1);
    const firstInput = llm2.calls[0]!.map(textOf);
    expect(firstInput[0]).toBe("[context_summary]\nthe distilled summary\n[/context_summary]");
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
    expect(
      newTrace.some((m) =>
        ((m.payload as { text?: string }).text ?? "").startsWith("[context_summary]"),
      ),
    ).toBe(true);
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
      createLLM: () => llm2,
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

  it("summarize failure keeps the old context and does NOT downgrade to discard", async () => {
    const llm1 = new ScriptedLLM(
      [
        {
          messages: [toolCall({ name: "t", arguments: "{}", toolCallId: "c1" }), usage(150, 150)],
        },
        // Compaction request fails on the one status no ladder can fix (a rejected credential).
        { messages: [], outcome: { status: "auth", errorMessage: "auth error" } },
        // Original context is kept. The mid-task failure ends the run by the interruption
        // flow, so the next run resends this round's tool output with the user's message and
        // the task finishes on the old instance (context usage keeps growing).
        { messages: [assistantText("finished on old context"), usage(190, 340)] },
        // Second trigger (context still over the limit) -> compaction is made up at that
        // run's task boundary, this time succeeding.
        { messages: [assistantText("[summary]second try[/summary]")] },
      ],
      "llm1",
    );
    const llm2 = new ScriptedLLM([], "llm2");
    let created = 0;
    const trace = new Writer({ tracesDir: traces, sessionId: "sess_keep" });
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      trace,
      sessionMeta: metaMessage,
      compaction: settings(),
      createLLM: () => {
        created += 1;
        return llm2;
      },
    });
    const oldPath = trace.currentPath();

    const out = await collect(engine.run([userText("go")], { approve: allowAll }));
    // The mid-task failure ends this run: stop=failed, original context kept, no LLM swap.
    expect(
      compactionEvents(out).map(
        (e) => `${e.type}:${(e as Partial<CompactionEndPayload>).status ?? ""}`,
      ),
    ).toEqual(["compaction_begin:", "compaction_end:failed"]);
    expect(payloadTypes(out)).toContain("abort");
    expect(created).toBe(0);

    // The next run resends the held tool output with the new message, and the compaction is
    // made up at that run's boundary — the second pair completes.
    const out2 = await collect(engine.run([userText("continue")], { approve: allowAll }));
    expect(
      compactionEvents(out2).map(
        (e) => `${e.type}:${(e as Partial<CompactionEndPayload>).status ?? ""}`,
      ),
    ).toEqual(["compaction_begin:", "compaction_end:completed"]);
    // The LLM swap happens only after success.
    expect(created).toBe(1);
    expect(llm1.calls).toHaveLength(4);
    // The resent input leads with this round's tool output (pairing intact), then the message.
    expect(payloadTypes(llm1.calls[2]!)).toEqual(["tool_call_output", "text"]);
    const oldTrace = await readTrace(oldPath);
    // Still written to the same file after a failed stop (the failed compaction attempt stays auditable); the old file is closed off only after success.
    expect(payloadTypes(oldTrace).filter((t) => t?.startsWith("compaction_"))).toHaveLength(4);
    // Trace rotation is deferred until the next message to write: the current path is unchanged right after a successful compaction.
    expect(trace.currentPath()).toBe(oldPath);
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
      createLLM: () => llm2,
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

  it("reconnect exhaustion on the compaction request converges to failed", async () => {
    const llm1 = new ScriptedLLM(
      [
        { messages: [assistantText("answer"), usage(150, 150)] },
        { messages: [], outcome: { status: "timeout" } },
        { messages: [], outcome: { status: "timeout" } },
      ],
      "llm1",
    );
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      compaction: settings(),
      createLLM: () => llm1,
      compactionMaxReconnects: 1,
      reconnectBackoffMs: 1,
    });

    const out = await collect(engine.run([userText("go")], { approve: allowAll }));
    const events = compactionEvents(out);
    // The end event reports the attempts spent (issue #170's cost-center row message).
    expect(events[1]).toMatchObject({
      type: "compaction_end",
      status: "failed",
      attempt: 2,
    });
    // The retry resends the original input (tool results + prompt; here there are no tool results, just the prompt).
    expect(llm1.calls).toHaveLength(3);
    expect(payloadTypes(llm1.calls[2]!)).toEqual(["text"]);
  });

  it("compaction transport retries default to the shared maxReconnects budget", async () => {
    // Issue #170: without an explicit compactionMaxReconnects, the compaction request gets
    // the same retry budget as the turn loop (here 4) — under the old tighter default of 3
    // this script would have failed before reaching the 5th, succeeding attempt.
    const failing = (n: number): ScriptedResponse => ({
      messages: [],
      outcome: { status: "failed", errorMessage: `blip ${n}` },
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
      createLLM: () => llm2,
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

  it("a failed compaction request takes the ladder and can recover on a later attempt", async () => {
    // The compaction loop retries the same statuses the turn loop does: `failed` is where a
    // transient fault lands whenever the classifier doesn't recognize the gateway's wording,
    // and giving up here keeps the full context, so the next request re-triggers compaction
    // against the same wall with less headroom.
    const llm1 = new ScriptedLLM(
      [
        { messages: [assistantText("answer"), usage(150, 150)] },
        { messages: [], outcome: { status: "failed", errorMessage: "502 upstream" } },
        { messages: [assistantText("[summary]recovered[/summary]")] },
      ],
      "llm1",
    );
    const llm2 = new ScriptedLLM([], "llm2");
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      compaction: settings(),
      createLLM: () => llm2,
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
    // compactionMaxReconnects=2, the compaction request runs 1+2 attempts and gives up —
    // even though maxReconnects is far larger (the default merely *follows* maxReconnects,
    // it does not override an explicit value).
    const llm1 = new ScriptedLLM(
      [
        { messages: [assistantText("answer"), usage(150, 150)] },
        { messages: [], outcome: { status: "timeout" } },
        { messages: [], outcome: { status: "timeout" } },
        { messages: [], outcome: { status: "timeout" } },
        // Never reached: the compaction cap stops at 3 compaction attempts in total.
        { messages: [assistantText("[summary]late[/summary]")] },
      ],
      "llm1",
    );
    const recorded: OmniMessage[] = [];
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      compaction: settings(),
      createLLM: () => llm1,
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
    expect(events[1]).toMatchObject({ type: "compaction_end", status: "failed" });
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

  it("an empty compaction response (thinking only, no text) is retried like any failure: 5 attempts, then failed with the context kept", async () => {
    // Issue #83/#170: the compaction request completes but yields no text. Committing the
    // empty summary would discard the whole context and lose the task state — the response
    // counts as one more failed attempt on the unified reconnect budget, and once the budget
    // is exhausted the compaction fails while the original context and Trace file stay current.
    const empty = (n: number): ScriptedResponse => ({
      messages: [thinkingMessage(`pondering, attempt ${n}, no text`)],
    });
    const llm1 = new ScriptedLLM(
      [
        { messages: [assistantText("answer one"), usage(150, 150)] },
        // Five completed-but-empty compaction attempt: 4 retries of budget allow exactly 5.
        empty(1),
        empty(2),
        empty(3),
        empty(4),
        empty(5),
        // Original context kept: the next run stays on this instance (usage under the
        // threshold here so the failed compaction isn't immediately retriggered).
        { messages: [assistantText("continuing on the old context"), usage(60, 370)] },
      ],
      "llm1",
    );
    let created = 0;
    const trace = new Writer({ tracesDir: traces, sessionId: "sess_empty" });
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      trace,
      sessionMeta: metaMessage,
      compaction: settings(),
      createLLM: () => {
        created += 1;
        return new ScriptedLLM([], "llm2");
      },
      compactionMaxReconnects: 4,
      reconnectBackoffMs: 1,
    });
    const oldPath = trace.currentPath();

    const out1 = await collect(engine.run([userText("task one")], { approve: allowAll }));

    // Exactly one event pair, ending failed — an empty summary is never a completed compaction.
    // The end event reports the attempts spent (issue #170).
    const events = compactionEvents(out1);
    expect(
      events.map((e) => `${e.type}:${(e as Partial<CompactionEndPayload>).status ?? ""}`),
    ).toEqual(["compaction_begin:", "compaction_end:failed"]);
    expect(events[1]).toMatchObject({
      attempt: 5,
      error_message: "the response contained no usable summary",
    });
    // These scripted attempts carry no token_usage of their own, so none appears between the
    // paired events (attempts that do carry usage surface it — see the 5th-attempt test).
    const types1 = payloadTypes(out1);
    const between = out1.slice(
      types1.indexOf("compaction_begin") + 1,
      types1.lastIndexOf("compaction_end"),
    );
    expect(between.filter((m) => (m.payload as { type?: string }).type === "token_usage")).toEqual(
      [],
    );
    // Turn + exactly five compaction attempts (the 5th exhausts the budget, no 6th
    // request); each retry leads with the corrective note, then the prompt — an empty
    // response needs no repair.
    expect(llm1.calls).toHaveLength(6);
    expect(llm1.calls[1]!.map(textOf)).toEqual(["COMPACT NOW"]);
    for (let i = 2; i <= 5; i += 1) {
      expect(llm1.calls[i]!.map(textOf)).toEqual([SUMMARY_RETRY_GUIDANCE, "COMPACT NOW"]);
    }
    // An unusable attempt's request_end carries status `completed`, for which no retry_in_ms
    // is ever announced (the backoff wait still ran between attempts).
    const rejectionPlans = (await readTrace(oldPath))
      .filter((m) => (m.payload as { type?: string }).type === "request_end")
      .map((m) => (m.payload as { retry_in_ms?: number }).retry_in_ms);
    expect(rejectionPlans.every((p) => p === undefined)).toBe(true);
    // No LLM swap and no Trace rotation: the old file is still current.
    expect(created).toBe(0);
    expect(trace.currentPath()).toBe(oldPath);

    // Subsequent turns still run on the original context: the same instance serves the next
    // run and its input is the plain new prompt — no [context_summary] injected.
    await collect(engine.run([userText("task two")], { approve: allowAll }));
    expect(llm1.calls).toHaveLength(7);
    expect(llm1.calls[6]!.map(textOf)).toEqual(["task two"]);
    expect(trace.currentPath()).toBe(oldPath);
    expect(await readdir(dirname(oldPath))).toEqual(["sess_empty_001.jsonl"]);
  });

  it("tool-calling responses exhaust the retry budget: every call is paired, and the next ordinary turn stays clean", async () => {
    // A tool-calling response is not a summary — even when it also carries plausible summary
    // text — but its assistant turn IS committed on the live LLM object. Each such attempt's
    // calls are answered with synthesized failed outputs (written to Trace, prepended to the
    // retried input), so no tool_use ever dangles: after the compaction fails, the same
    // object must still serve ordinary turns with a well-formed history (#84 review).
    const callWith = (id: string): ScriptedResponse => ({
      messages: [
        assistantText("[summary]looks plausible[/summary]"),
        toolCall({ name: "t", arguments: "{}", toolCallId: id }),
      ],
    });
    const llm1 = new ScriptedLLM(
      [
        { messages: [assistantText("answer"), usage(150, 150)] },
        callWith("c1"),
        callWith("c2"),
        callWith("c3"),
        callWith("c4"),
        callWith("c5"),
        { messages: [assistantText("still on the old context"), usage(60, 300)] },
      ],
      "llm1",
    );
    let created = 0;
    const trace = new Writer({ tracesDir: traces, sessionId: "sess_paired" });
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      trace,
      sessionMeta: metaMessage,
      compaction: settings(),
      createLLM: () => {
        created += 1;
        return new ScriptedLLM([], "llm2");
      },
      compactionMaxReconnects: 4,
      reconnectBackoffMs: 1,
    });
    const oldPath = trace.currentPath();

    const out = await collect(engine.run([userText("go")], { approve: allowAll }));
    const events = compactionEvents(out);
    expect(events[1]).toMatchObject({ type: "compaction_end", status: "failed" });
    // The rejected tool calls are never approved or executed, and nothing of the compaction
    // dialogue (repairs included) reaches the output stream.
    expect(payloadTypes(out)).not.toContain("approval_decision");
    expect(payloadTypes(out)).not.toContain("tool_call_output");
    expect(created).toBe(0);

    // The end event reports the attempts spent and the last failure (issue #170's
    // cost-center row message and the frontend banner detail).
    expect(events[1]).toMatchObject({
      attempt: 5,
      error_message: "the response called tools instead of writing a summary",
    });
    // Five attempts; from the second on, the input leads with the repair answering the
    // previous attempt's call, then the corrective note, then the prompt.
    expect(llm1.calls).toHaveLength(6);
    for (let attempt = 2; attempt <= 5; attempt += 1) {
      const retry = llm1.calls[attempt]!;
      expect(payloadTypes(retry)).toEqual(["tool_call_output", "text", "text"]);
      const repair = retry[0]!.payload as {
        tool_call_id: string;
        output: string;
        stop_reason?: string;
      };
      expect(repair.tool_call_id).toBe(`c${attempt - 1}`);
      expect(repair.output).toBe(
        "[tool error] the compaction request expects a summary, not tool calls",
      );
      expect(repair.stop_reason).toBe("failed");
      expect(textOf(retry[1]!)).toBe(SUMMARY_RETRY_GUIDANCE);
      expect(textOf(retry[2]!)).toBe("COMPACT NOW");
    }

    // All five synthesized repairs are written to the (old) Trace for replay to mirror.
    const repairIds = (await readTrace(oldPath))
      .filter((m) => {
        const p = m.payload as { type?: string; output?: string };
        return (
          p.type === "tool_call_output" &&
          p.output === "[tool error] the compaction request expects a summary, not tool calls"
        );
      })
      .map((m) => (m.payload as { tool_call_id: string }).tool_call_id);
    expect(repairIds).toEqual(["c1", "c2", "c3", "c4", "c5"]);

    // The next ordinary turn on the SAME engine runs cleanly: the final rejection's repair is
    // held as carry-over and leads the next request, so the committed history the LLM sees
    // never leaves c5's tool_use unanswered — no dangling pairing, no [context_summary].
    await collect(engine.run([userText("next")], { approve: allowAll }));
    expect(llm1.calls).toHaveLength(7);
    const nextTurn = llm1.calls[6]!;
    expect(payloadTypes(nextTurn)).toEqual(["tool_call_output", "text"]);
    expect((nextTurn[0]!.payload as { tool_call_id: string }).tool_call_id).toBe("c5");
    expect(textOf(nextTurn[1]!)).toBe("next");
    // Carry-over is spent: it does not leak into later runs.
    await collect(engine.run([userText("later")], { approve: allowAll }));
    expect(llm1.calls[7]!.map(textOf)).toEqual(["later"]);
  });

  it("a valid summary on the 5th and final allowed attempt completes the compaction", async () => {
    // Counting pin for the unified budget: four failed attempts spend the 4 retries, but the
    // 5th (last allowed) attempt still gets its chance — a valid summary there succeeds
    // (a 5th failure would exhaust the budget instead).
    const llm1 = new ScriptedLLM(
      [
        { messages: [assistantText("answer"), usage(150, 150)] },
        // Attempts 1-4: empty (thinking only) -> rejected, retried.
        { messages: [thinkingMessage("blank stare 1"), usage(160, 310)] },
        { messages: [thinkingMessage("blank stare 2")] },
        { messages: [thinkingMessage("blank stare 3")] },
        { messages: [thinkingMessage("blank stare 4")] },
        // Attempt 5: a real summary -> the compaction completes with THIS attempt's output.
        { messages: [assistantText("[summary]fifth attempt wins[/summary]"), usage(170, 480)] },
      ],
      "llm1",
    );
    const llm2 = new ScriptedLLM([{ messages: [assistantText("fresh"), usage(20, 500)] }], "llm2");
    let factoryTokens: TokenCounts | null = null;
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      compaction: settings(),
      createLLM: (tokens) => {
        factoryTokens = tokens;
        return llm2;
      },
      compactionMaxReconnects: 4,
      reconnectBackoffMs: 1,
    });

    const out = await collect(engine.run([userText("task one")], { approve: allowAll }));
    const events = compactionEvents(out);
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ type: "compaction_end", status: "completed" });
    // Every attempt's token_usage is surfaced between the paired events — rejected attempts
    // burn real tokens, and hiding them understated the cost center (issue #170). Here the
    // 1st (rejected) and 5th (adopted) attempts carry usage.
    expect(events[1]).toMatchObject({ attempt: 5 });
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
    // Session cumulative tokens carried into the new instance include the rejected attempts' usage.
    expect(factoryTokens).toMatchObject({ total: 480 });

    // The new context opens with the 5th attempt's summary.
    await collect(engine.run([userText("task two")], { approve: allowAll }));
    expect(llm1.calls).toHaveLength(6);
    expect(llm2.calls[0]!.map(textOf)).toEqual([
      "[context_summary]\nfifth attempt wins\n[/context_summary]",
      "task two",
    ]);
  });

  it("a tool-calling rejection is repaired and the retry's summary completes the compaction", async () => {
    // The pairing repair (#84 review): the rejected attempt's assistant turn — committed by
    // the stateful LLM — ends in tool_use blocks that were never dispatched. Before retrying,
    // the engine answers each with a synthesized failed tool_call_output (written to Trace),
    // prepended to the retried input so the provider sees tool_use/tool_result paired, and
    // the retry then has a real chance to summarize.
    const llm1 = new ScriptedLLM(
      [
        { messages: [assistantText("answer"), usage(150, 150)] },
        // Attempt 1: rejected — the model reached for a tool instead of summarizing.
        {
          messages: [
            assistantText("[summary]tempting[/summary]"),
            toolCall({ name: "t", arguments: "{}", toolCallId: "c1" }),
          ],
        },
        // Attempt 2 (carrying the repair): a real summary.
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
      createLLM: () => llm2,
      reconnectBackoffMs: 1,
    });
    const oldPath = trace.currentPath();

    const out = await collect(engine.run([userText("task one")], { approve: allowAll }));
    expect(compactionEvents(out)[1]).toMatchObject({
      type: "compaction_end",
      status: "completed",
    });

    // The retried input answers the rejected attempt's call first, then carries the
    // corrective note and re-issues the prompt.
    expect(llm1.calls).toHaveLength(3);
    const retry = llm1.calls[2]!;
    expect(payloadTypes(retry)).toEqual(["tool_call_output", "text", "text"]);
    const repair = retry[0]!.payload as {
      tool_call_id: string;
      output: string;
      stop_reason?: string;
    };
    expect(repair.tool_call_id).toBe("c1");
    expect(repair.output).toBe(
      "[tool error] the compaction request expects a summary, not tool calls",
    );
    expect(repair.stop_reason).toBe("failed");
    expect(textOf(retry[1]!)).toBe(SUMMARY_RETRY_GUIDANCE);
    expect(textOf(retry[2]!)).toBe("COMPACT NOW");

    // The repair belongs to the compaction dialogue: written to the old Trace (so replay
    // mirrors the pairing), never pushed to the output stream.
    const repairsInTrace = (await readTrace(oldPath)).filter((m) => {
      const p = m.payload as { type?: string; tool_call_id?: string };
      return p.type === "tool_call_output" && p.tool_call_id === "c1";
    });
    expect(repairsInTrace).toHaveLength(1);
    expect(payloadTypes(out)).not.toContain("tool_call_output");

    // The new context opens with the retry's summary.
    await collect(engine.run([userText("task two")], { approve: allowAll }));
    expect(llm2.calls[0]!.map(textOf)).toEqual([
      "[context_summary]\nreal summary\n[/context_summary]",
      "task two",
    ]);
  });

  it("a non-completed tool_call (interruption-closure shape) does not reject the summary", async () => {
    // Same filter as the ordinary turn loop: only stop_reason === "completed" tool_calls are
    // real requests. A tool_call synthesized to close out an interruption carries the
    // interruption reason — it is structural, gets no synthesized repair, and must not cost
    // a rejection attempt.
    const llm1 = new ScriptedLLM(
      [
        { messages: [assistantText("answer"), usage(150, 150)] },
        {
          messages: [
            toolCall({ name: "t", arguments: "", toolCallId: "cz", stopReason: "timeout" }),
            assistantText("[summary]still fine[/summary]"),
          ],
        },
      ],
      "llm1",
    );
    const llm2 = new ScriptedLLM([{ messages: [assistantText("ok"), usage(10, 200)] }], "llm2");
    const trace = new Writer({ tracesDir: traces, sessionId: "sess_closure" });
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      trace,
      sessionMeta: metaMessage,
      compaction: settings(),
      createLLM: () => llm2,
    });
    const oldPath = trace.currentPath();

    const out = await collect(engine.run([userText("go")], { approve: allowAll }));
    expect(compactionEvents(out)[1]).toMatchObject({
      type: "compaction_end",
      status: "completed",
    });
    // One compaction attempt, no retry, and no repair synthesized for the closure call.
    expect(llm1.calls).toHaveLength(2);
    const closureRepairs = (await readTrace(oldPath)).filter((m) => {
      const p = m.payload as { type?: string; tool_call_id?: string };
      return p.type === "tool_call_output" && p.tool_call_id === "cz";
    });
    expect(closureRepairs).toEqual([]);
  });

  it("mid-task: a committed rejection absorbs the turn's tool outputs — retries never resend them, and an empty-handed abandonment ends the run by the interruption flow", async () => {
    // Issue #85, strict-provider scenario: the first committed attempt puts the turn's tool
    // outputs (folded into the compaction input) into the old LLM object's history. From then
    // on the retries must carry only the repairs and the Prompt — resending the outputs would
    // be rejected as stale tool_results — and after the compaction is abandoned the next run
    // must not resend them either. Here the final rejection is empty (no repairs left to
    // stash), so the run ends at the abort with nothing pending: the context is intact and
    // the next prompt continues from the committed state, where the still-standing threshold
    // makes the compaction up at its next trigger.
    const llm1 = new ScriptedLLM(
      [
        // Turn 1: a tool call, over the threshold -> mid-task compaction.
        {
          messages: [toolCall({ name: "t", arguments: "{}", toolCallId: "ct" }), usage(150, 150)],
        },
        // Attempt 1: committed but rejected (tool call) -> absorbs [output(ct), prompt].
        {
          messages: [
            assistantText("[summary]nope[/summary]"),
            toolCall({ name: "t", arguments: "{}", toolCallId: "c1" }),
          ],
        },
        // Attempts 2-5: committed but empty -> rejected; the base has shrunk to the Prompt.
        { messages: [thinkingMessage("blank 2")] },
        { messages: [thinkingMessage("blank 3")] },
        { messages: [thinkingMessage("blank 4")] },
        { messages: [thinkingMessage("blank 5")] },
        // Next run: served by the same instance, plain prompt.
        { messages: [assistantText("next task"), usage(70, 970)] },
      ],
      "llm1",
    );
    let created = 0;
    const trace = new Writer({ tracesDir: traces, sessionId: "sess_absorb" });
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      trace,
      sessionMeta: metaMessage,
      compaction: settings(),
      createLLM: () => {
        created += 1;
        return new ScriptedLLM([], "llm2");
      },
      compactionMaxReconnects: 4,
      reconnectBackoffMs: 1,
    });
    const oldPath = trace.currentPath();

    const out1 = await collect(engine.run([userText("task one")], { approve: allowAll }));

    expect(compactionEvents(out1)[1]).toMatchObject({ type: "compaction_end", status: "failed" });
    // The abandonment ends the run through the interruption flow: an abort follows the
    // failed compaction_end, and no further request is issued in this run.
    const abort = out1.find((m) => (m.payload as { type?: string }).type === "abort");
    expect(abort?.payload).toMatchObject({ reason: "compaction failed" });
    expect(llm1.calls).toHaveLength(6);
    // Attempt 1 folds the turn's tool output in; attempt 2 carries the repair + note + Prompt
    // but NOT the absorbed output; attempts 3-5 are note + Prompt.
    expect(payloadTypes(llm1.calls[1]!)).toEqual(["tool_call_output", "text"]);
    expect((llm1.calls[1]![0]!.payload as { tool_call_id?: string }).tool_call_id).toBe("ct");
    expect(payloadTypes(llm1.calls[2]!)).toEqual(["tool_call_output", "text", "text"]);
    expect((llm1.calls[2]![0]!.payload as { tool_call_id?: string }).tool_call_id).toBe("c1");
    expect(textOf(llm1.calls[2]![1]!)).toBe(SUMMARY_RETRY_GUIDANCE);
    expect(textOf(llm1.calls[2]![2]!)).toBe("COMPACT NOW");
    for (let attempt = 3; attempt <= 5; attempt += 1) {
      expect(llm1.calls[attempt]!.map(textOf)).toEqual([SUMMARY_RETRY_GUIDANCE, "COMPACT NOW"]);
    }
    // Original context kept: no LLM swap, no Trace rotation.
    expect(created).toBe(0);
    expect(trace.currentPath()).toBe(oldPath);

    // The next run continues from the committed state: the absorbed outputs are not resent
    // and nothing was stashed (the final rejection was empty).
    await collect(engine.run([userText("task two")], { approve: allowAll }));
    expect(llm1.calls[6]!.map(textOf)).toEqual(["task two"]);
  });

  it("mid-task: abandonment with a trailing tool-calling rejection stashes the repair for the next run", async () => {
    // Any committed attempt absorbs — here the FIRST (empty) rejection commits the turn
    // outputs, and the FINAL rejection leaves unanswered tool calls. The run ends through
    // the interruption flow with the repair stashed as carry-over (never the absorbed
    // outputs): the next run leads with it, keeping the live object's history well-formed.
    const llm1 = new ScriptedLLM(
      [
        {
          messages: [toolCall({ name: "t", arguments: "{}", toolCallId: "ct" }), usage(150, 150)],
        },
        // Attempts 1-4: empty rejections (attempt 1 commits and absorbs the outputs).
        { messages: [thinkingMessage("blank 1")] },
        { messages: [thinkingMessage("blank 2")] },
        { messages: [thinkingMessage("blank 3")] },
        { messages: [thinkingMessage("blank 4")] },
        // Attempt 5: rejected with a tool call -> its repair is stashed at the abandonment.
        { messages: [toolCall({ name: "t", arguments: "{}", toolCallId: "c5" })] },
        // Next run: the stashed repair leads, then the new prompt.
        { messages: [assistantText("recovered"), usage(60, 900)] },
      ],
      "llm1",
    );
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      compaction: settings(),
      createLLM: () => new ScriptedLLM([], "llm2"),
      compactionMaxReconnects: 4,
      reconnectBackoffMs: 1,
    });

    const out = await collect(engine.run([userText("go")], { approve: allowAll }));
    expect(compactionEvents(out)[1]).toMatchObject({ type: "compaction_end", status: "failed" });
    expect(payloadTypes(out)).toContain("abort");
    expect(llm1.calls).toHaveLength(6);
    // Attempt 1 folds the outputs; attempts 2-5 are note + Prompt (absorbed by the first commit).
    expect(payloadTypes(llm1.calls[1]!)).toEqual(["tool_call_output", "text"]);
    for (let attempt = 2; attempt <= 5; attempt += 1) {
      expect(llm1.calls[attempt]!.map(textOf)).toEqual([SUMMARY_RETRY_GUIDANCE, "COMPACT NOW"]);
    }
    // The next run leads with the repair answering c5 — no absorbed outputs — followed by
    // the new prompt.
    await collect(engine.run([userText("again")], { approve: allowAll }));
    expect(payloadTypes(llm1.calls[6]!)).toEqual(["tool_call_output", "text"]);
    const cont = llm1.calls[6]![0]!.payload as { tool_call_id: string; output: string };
    expect(cont.tool_call_id).toBe("c5");
    expect(cont.output).toBe(
      "[tool error] the compaction request expects a summary, not tool calls",
    );
    expect(textOf(llm1.calls[6]![1]!)).toBe("again");
  });

  it("mid-task: an all-transport abandonment absorbs nothing — the outputs carry to the next run", async () => {
    // Counter-case: timeout/malformed attempts never commit, so the turn's tool outputs were
    // never absorbed. The run ends through the interruption flow with the outputs held as
    // case-A carry-over (their tool_use pairing is still unanswered on the live object), and
    // the next run resends them exactly as before, ahead of the new prompt.
    const llm1 = new ScriptedLLM(
      [
        {
          messages: [toolCall({ name: "t", arguments: "{}", toolCallId: "ct" }), usage(150, 150)],
        },
        { messages: [], outcome: { status: "timeout" } },
        { messages: [], outcome: { status: "timeout" } },
        // Next run: the carried outputs lead, then the new prompt (under the threshold).
        { messages: [assistantText("done on old context"), usage(60, 400)] },
      ],
      "llm1",
    );
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      compaction: settings(),
      createLLM: () => new ScriptedLLM([], "llm2"),
      compactionMaxReconnects: 1,
      reconnectBackoffMs: 1,
    });

    const out = await collect(engine.run([userText("go")], { approve: allowAll }));
    expect(compactionEvents(out)[1]).toMatchObject({ type: "compaction_end", status: "failed" });
    expect(payloadTypes(out)).toContain("abort");
    expect(llm1.calls).toHaveLength(3);

    await collect(engine.run([userText("carry on")], { approve: allowAll }));
    expect(payloadTypes(llm1.calls[3]!)).toEqual(["tool_call_output", "text"]);
    expect((llm1.calls[3]![0]!.payload as { tool_call_id?: string }).tool_call_id).toBe("ct");
    expect(textOf(llm1.calls[3]![1]!)).toBe("carry on");
  });

  it("mid-task: an abort after a committed rejection merges the stash — repairs ride, absorbed outputs do not", async () => {
    // The abort-in-window case (issue #85): the stash must merge, not be overwritten. After a
    // committed rejection the turn outputs are absorbed, so the case-A carry-over is skipped
    // entirely and only the unanswered repair rides the next run.
    const llm1 = new ScriptedLLM(
      [
        {
          messages: [toolCall({ name: "t", arguments: "{}", toolCallId: "ct" }), usage(150, 150)],
        },
        // Attempt 1: committed rejection with a tool call -> absorbs outputs, repair pending.
        { messages: [toolCall({ name: "t", arguments: "{}", toolCallId: "c1" })] },
        // Attempt 2 (carrying the repair): the user aborts mid-request -> uncommitted, the
        // repair is still unanswered and gets stashed.
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
      createLLM: () => new ScriptedLLM([], "llm2"),
      reconnectBackoffMs: 1,
    });

    const out = await collect(engine.run([userText("go")], { approve: allowAll }));
    const events = compactionEvents(out);
    expect(events[1]).toMatchObject({ type: "compaction_end", status: "aborted" });
    expect(payloadTypes(out)).toContain("abort");
    expect(llm1.calls).toHaveLength(3);
    // Attempt 2 carried the repair + note + Prompt (not the absorbed outputs).
    expect(payloadTypes(llm1.calls[2]!)).toEqual(["tool_call_output", "text", "text"]);
    expect((llm1.calls[2]![0]!.payload as { tool_call_id?: string }).tool_call_id).toBe("c1");

    // The next run leads with the still-unanswered repair; the absorbed turn outputs are
    // NOT re-held as carry-over (no duplicate ct output).
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
          const event: UniEvent = {
            role: "assistant",
            event_type: "delta",
            content_items: [{ type: "text", text: next.text }],
            finish_reason: "stop",
            usage_metadata: {
              cached_tokens: 0,
              prompt_tokens: next.promptTokens,
              thoughts_tokens: 0,
              response_tokens: 1,
            },
          };
          yield event;
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
      createLLM: () => new ScriptedLLM([], "llm2"),
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
      createLLM: () => llm2,
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
      createLLM: () => llm2,
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
      createLLM: () => llm2,
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
      createLLM: () => llm2,
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
      createLLM: () => llm2,
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
      createLLM: () => llm2,
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

  it("manual compaction that commits nothing restores the prior carry-over verbatim", async () => {
    // The carry seam's binary (PR #87 review): every attempt was a transport failure, so
    // nothing reached AgentHub — the folded carry-over comes back exactly as it was (the very
    // same message objects, not routed through any absorption logic), and with zero committed
    // attempts there are no repairs to interleave with.
    const llm1 = new ScriptedLLM(
      [
        { messages: [assistantText("hi"), usage(10, 10)] },
        // Manual compaction attempts: transport failures only — nothing committed.
        { messages: [], outcome: { status: "timeout" } },
        { messages: [], outcome: { status: "timeout" } },
        // Run 3: the restored carry-over leads the input, exactly as before the compact().
        { messages: [assistantText("resumed"), usage(20, 40)] },
      ],
      "llm1",
    );
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      compaction: settings(),
      createLLM: () => new ScriptedLLM([], "llm2"),
      compactionMaxReconnects: 1,
      reconnectBackoffMs: 1,
    });
    await collect(engine.run([userText("start")], { approve: allowAll }));
    // An aborted-before-issue run leaves its input as carry-over.
    const aborted = new AbortController();
    aborted.abort();
    const pendingMsg = userText("pending question");
    await collect(engine.run([pendingMsg], { signal: aborted.signal, approve: allowAll }));
    expect(llm1.calls).toHaveLength(1); // the aborted run never reached the LLM

    const out = await collect(engine.compact());
    expect(compactionEvents(out)[1]).toMatchObject({ type: "compaction_end", status: "failed" });
    // The compaction folded the carry-over into its (uncommitted) attempts...
    expect(llm1.calls).toHaveLength(3);
    expect(llm1.calls[1]!.map(textOf)).toEqual(["pending question", "COMPACT NOW"]);
    expect(llm1.calls[2]!.map(textOf)).toEqual(["pending question", "COMPACT NOW"]);

    // ...and restored it verbatim: the next run resends the very same message object first.
    await collect(engine.run([userText("run3")], { approve: allowAll }));
    expect(llm1.calls[3]![0]).toBe(pendingMsg);
    expect(llm1.calls[3]!.map(textOf)).toEqual(["pending question", "run3"]);
  });

  it("manual compaction with a committed attempt consumes the carry-over; only repairs remain pending", async () => {
    // The other side of the binary: the first committed attempt put the folded carry-over
    // into AgentHub history, so it is disposed of at the seam — never restored — and the next
    // input reflects the committed state plus the repair stash left by the final rejection.
    const llm1 = new ScriptedLLM(
      [
        { messages: [assistantText("hi"), usage(10, 10)] },
        // Attempt 1: committed but empty -> absorbs the folded carry-over into history.
        { messages: [thinkingMessage("blank 1")] },
        // Attempts 2-4: still empty; the base has shrunk to the Prompt.
        { messages: [thinkingMessage("blank 2")] },
        { messages: [thinkingMessage("blank 3")] },
        { messages: [thinkingMessage("blank 4")] },
        // Attempt 5: rejected with a tool call -> its repair is stashed at the abandonment.
        { messages: [toolCall({ name: "t", arguments: "{}", toolCallId: "c9" })] },
        // Run 3: the repair leads; the consumed carry-over is NOT resent.
        { messages: [assistantText("resumed"), usage(20, 40)] },
      ],
      "llm1",
    );
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      compaction: settings(),
      createLLM: () => new ScriptedLLM([], "llm2"),
      compactionMaxReconnects: 4,
      reconnectBackoffMs: 1,
    });
    await collect(engine.run([userText("start")], { approve: allowAll }));
    const aborted = new AbortController();
    aborted.abort();
    await collect(
      engine.run([userText("pending question")], { signal: aborted.signal, approve: allowAll }),
    );

    const out = await collect(engine.compact());
    expect(compactionEvents(out)[1]).toMatchObject({ type: "compaction_end", status: "failed" });
    expect(llm1.calls).toHaveLength(6);
    // Attempt 1 folded the carry-over in (and committed it); later attempts resend the note +
    // Prompt — the absorbed carry-over never again.
    expect(llm1.calls[1]!.map(textOf)).toEqual(["pending question", "COMPACT NOW"]);
    for (let attempt = 2; attempt <= 5; attempt += 1) {
      expect(llm1.calls[attempt]!.map(textOf)).toEqual([SUMMARY_RETRY_GUIDANCE, "COMPACT NOW"]);
    }

    // The carry-over is consumed at the seam — the next run leads with the stashed repair
    // alone, continuing from committed history.
    await collect(engine.run([userText("run3")], { approve: allowAll }));
    const run3 = llm1.calls[6]!;
    expect(payloadTypes(run3)).toEqual(["tool_call_output", "text"]);
    expect((run3[0]!.payload as { tool_call_id?: string }).tool_call_id).toBe("c9");
    expect(textOf(run3[1]!)).toBe("run3");
  });

  it("no compaction capability (createLLM missing) means thresholds never fire and compact() is a no-op", async () => {
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
    // The compaction request goes to the **current** LLM (the script's second entry); createLLM
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

    // (1) No compaction capability configured (no compaction / createLLM).
    const noCap = new ContextEngine({ llm: llm1, environment: fakeEnvironment });
    expect(noCap.compactability()).toBe("unsupported");

    // (2) Capability configured, but the current context hasn't finished a single round yet: not compactable, and compact() indeed emits no messages.
    const engine = new ContextEngine({
      llm: llm1,
      environment: fakeEnvironment,
      compaction: settings(),
      createLLM: () => llm2,
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
      createLLM: () => llm1,
    });
    // The abort signal is already pending before the compaction request: the fake LLM finishes straight to aborted.
    const approveThenAbort: ApproveFn = async () => "allow";
    const runGen = engine.run([userText("go")], {
      approve: approveThenAbort,
      signal: controller.signal,
    });
    const out: OmniMessage[] = [];
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
  const streamedTexts = (msgs: OmniMessage[]): string[] =>
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
      createLLM: () => new ScriptedLLM([], "llm2"),
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
      createLLM: () => new ScriptedLLM([], "llm2"),
    });

    const out = await collect(engine.run([userText("task one")], { approve: allowAll }));
    const types = payloadTypes(out);
    const begin = types.indexOf("compaction_begin");
    const end = types.indexOf("compaction_end");
    expect(streamedTexts(out.slice(begin + 1, end))).toEqual(["[summary]whole[/summary]"]);
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
          yield toolCallOutput({ output: "tool ran", toolCallId: tc.payload.tool_call_id });
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
      createLLM: () => llm2,
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
      createLLM: () => new ScriptedLLM([{ messages: [assistantText("done"), usage(1, 1)] }], "l2"),
    });

    const gen = engine.run([userText("go")], { approve: allowAll });
    const seen: OmniMessage[] = [];
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
          stopReason: "failed",
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
      createLLM: () => new ScriptedLLM([{ messages: [assistantText("ok"), usage(1, 1)] }], "l2"),
    });

    await collect(engine.run([userText("go")], { approve: allowAll }));
    const compactionInput = llm1.calls[1]!;
    expect(payloadTypes(compactionInput)).toEqual(["tool_call_output", "text"]);
    const out = compactionInput[0]!.payload as { output: string; stop_reason?: string };
    expect(out.output).toBe("[tool error] boom");
    expect(out.stop_reason).toBe("failed");
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
      createLLM: () => new ScriptedLLM([{ messages: [assistantText("ok"), usage(1, 1)] }], "l2"),
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
      createLLM: () => new ScriptedLLM([], "llm2"),
    });
    await collect(engine.run([userText("hi")], { approve: allowAll }));
    await collect(engine.compact());
    expect(llm1.calls[1]!.map(textOf)).toEqual(["COMPACT NOW"]);
  });
});
