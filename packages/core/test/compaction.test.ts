/**
 * Context compaction tests.
 *
 * - Trigger: context usage (the request.total of the most recent token_usage) or the session's
 *   cumulative turn count **reaching** the threshold (>=); the check runs after every LLM
 *   request emits token_usage, both mid-task and at the wrap-up round (reaching the threshold at
 *   task end triggers compaction immediately, without waiting for the next task).
 * - summarize: appends a compaction prompt to the old LLM (merging in all of this round's tool
 *   results first if mid-task); the summary is wrapped as a `<context_summary>` user text and fed
 *   as the first input to the new LLM instance; on failure the original context is kept, never downgraded to discard.
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
  sessionMeta,
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
import { ContextEngine } from "../src/engine/context-engine.js";
import type { CompactionSettings } from "../src/engine/context-engine.js";
import { Writer, readTrace } from "../src/trace/index.js";

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
      return { status: "failed", message: `${this.label}: no scripted response` };
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
  tools: [],
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
          messages: [assistantText("<summary>the distilled summary</summary>"), usage(160, 310)],
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
    // The compaction process is invisible to the human: the compaction prompt and summary text are never pushed to the output stream.
    const texts = out1.filter((m) => (m.payload as { type?: string }).type === "text").map(textOf);
    expect(texts.some((t) => t.includes("COMPACT NOW"))).toBe(false);
    expect(texts.some((t) => t.includes("distilled"))).toBe(false);
    // Exception: the compaction request's token_usage IS pushed to the output stream, sitting between the paired compaction events (the frontend counts it in stats).
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

    // The new LLM instance carries over the session's cumulative tokens (including compaction request usage).
    expect(factoryTokens).toMatchObject({ total: 310 });

    // The summary is merged with the next user prompt as the new LLM instance's first input.
    await collect(engine.run([userText("task two")], { approve: allowAll }));
    expect(llm1.calls).toHaveLength(2);
    expect(llm2.calls).toHaveLength(1);
    const firstInput = llm2.calls[0]!.map(textOf);
    expect(firstInput[0]).toBe("<context_summary>\nthe distilled summary\n</context_summary>");
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
        ((m.payload as { text?: string }).text ?? "").startsWith("<context_summary>"),
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
        { messages: [assistantText("<summary>continue: finish step 2</summary>")] },
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
      "<context_summary>\ncontinue: finish step 2\n</context_summary>",
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
        // Compaction request fails (not retryable).
        { messages: [], outcome: { status: "failed", message: "auth error" } },
        // Original context is kept: the task continues, tool outputs feed back into the old instance as usual (context usage keeps growing).
        { messages: [assistantText("finished on old context"), usage(190, 340)] },
        // Second trigger (context still over the limit) -> retries compaction at the boundary, this time succeeding.
        { messages: [assistantText("<summary>second try</summary>")] },
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

    // Two event pairs: the first has stop=failed (abandoned, original context kept), the second succeeds.
    const events = compactionEvents(out);
    expect(
      events.map((e) => `${e.type}:${(e as Partial<CompactionEndPayload>).status ?? ""}`),
    ).toEqual([
      "compaction_begin:",
      "compaction_end:failed",
      "compaction_begin:",
      "compaction_end:completed",
    ]);
    // No LLM swap and no trace file split at the moment of failure; rotation happens only after success.
    expect(created).toBe(1);
    expect(llm1.calls).toHaveLength(4);
    // After the failure, the input fed back into the old instance is this round's tool output.
    expect(payloadTypes(llm1.calls[2]!)).toEqual(["tool_call_output"]);
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
        { messages: [assistantText("<summary>s</summary>")] },
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
      ((newTrace[1]!.payload as { text?: string }).text ?? "").startsWith("<context_summary>"),
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
      maxReconnects: 1,
      reconnectBackoffMs: 1,
    });

    const out = await collect(engine.run([userText("go")], { approve: allowAll }));
    const events = compactionEvents(out);
    expect(events[1]).toMatchObject({ type: "compaction_end", status: "failed" });
    // The retry resends the original input (tool results + prompt; here there are no tool results, just the prompt).
    expect(llm1.calls).toHaveLength(3);
    expect(payloadTypes(llm1.calls[2]!)).toEqual(["text"]);
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
        { messages: [assistantText("<summary>s</summary>")] },
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
      "<context_summary>\ns\n</context_summary>",
      "task 2",
    ]);
  });

  it("context usage exactly equal to the threshold triggers compaction (>=, not >)", async () => {
    const llm1 = new ScriptedLLM(
      [
        // Wrap-up round context usage 100 == threshold 100 -> triggers.
        { messages: [assistantText("answer"), usage(100, 100)] },
        { messages: [assistantText("<summary>eq</summary>")] },
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

    // The next round's input is used as-is as the new instance's first input (no <context_summary>).
    await collect(engine.run([userText("next task")], { approve: allowAll }));
    expect(llm2.calls[0]!.map(textOf)).toEqual(["next task"]);

    // Trace splits into files: the new file starts with session_meta.
    const newTrace = await readTrace(trace.currentPath());
    expect(trace.currentPath()).not.toBe(oldPath);
    expect(newTrace[0]!.type).toBe("session_meta");
  });

  it("lenient extraction: output without <summary> tags is used verbatim", async () => {
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
      "<context_summary>\nplain summary text without tags\n</context_summary>",
    );
  });

  it("manual compaction skips threshold checks and reuses the same flow", async () => {
    const llm1 = new ScriptedLLM(
      [
        // One ordinary task (well under the limit).
        { messages: [assistantText("small"), usage(10, 10)] },
        // Manual compaction request.
        { messages: [assistantText("<summary>manual s</summary>")] },
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
      "<context_summary>\nmanual s\n</context_summary>",
      "next",
    ]);
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
        { messages: [assistantText("<summary>s</summary>")] }, // manual compaction request
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
