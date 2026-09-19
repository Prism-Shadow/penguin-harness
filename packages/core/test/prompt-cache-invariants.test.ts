/**
 * The harness's half of the prompt cache: every request is assembled as an extension of the last.
 *
 * A provider serves a cached prefix only when the request repeats the previous one byte for byte
 * from the front — tools, then the system prompt, then the messages. Everything the harness does
 * between two requests — running a turn, delivering a steering message, moving the thinking
 * level, compacting, reconnecting, resuming from a Trace — therefore has to leave the request an
 * extension of the one before it. Each case here drives a real `ContextEngine` over a real
 * `GenerativeModel` whose provider stream is scripted, and diagnoses each consecutive pair of
 * requests on the wire shape the client would have sent.
 *
 * These are assertions about bytes. Whether a prefix that could hit actually did — cache
 * lifetime, breakpoint lookback, minimum cacheable size — is `prompt-cache-lifecycle.test.ts`,
 * which puts the same kind of recording through the simulator.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sessionMeta, userText } from "../src/omnimessage/index.js";
import type { ApproveFn } from "../src/interfaces/index.js";
import { ContextEngine } from "../src/engine/context-engine.js";
import { Writer, readTrace, resumeTrace } from "../src/trace/index.js";
import {
  COMPACTION_PROMPT,
  META,
  NON_PREFIX_CONFIG_KEYS,
  SESSION_ID,
  allowAll,
  blockTypes,
  collect,
  compactionSettings,
  diagnoseCacheMiss,
  diagnoseSeries,
  fakeEnvironment,
  formatDiagnostics,
  modelConfig,
  recordingModel,
  toolTurn,
  wireHistoryOf,
  wireMessage,
} from "./helpers/prompt-cache/index.js";
import type {
  CacheMissReason,
  RecordedRequest,
  ScriptedReply,
} from "./helpers/prompt-cache/index.js";

// ---------------------------------------------------------------------------
// Fixtures of this suite's own
// ---------------------------------------------------------------------------

const metaMessage = sessionMeta(META);

/** Everything in a request's config that takes part in the cached prefix. */
function configFingerprint(request: RecordedRequest): string {
  const copy: Record<string, unknown> = { ...request.wireConfig };
  for (const key of NON_PREFIX_CONFIG_KEYS) delete copy[key];
  return JSON.stringify(copy);
}

const effortOf = (request: RecordedRequest): string | undefined =>
  (request.wireConfig.output_config as { effort?: string } | undefined)?.effort;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("prompt-cache invariants of request assembly", () => {
  let traces: string;

  beforeEach(async () => {
    traces = await mkdtemp(join(tmpdir(), "penguin-prompt-cache-"));
  });

  afterEach(async () => {
    await rm(traces, { recursive: true, force: true });
  });

  it("every request of a session extends the previous one on the wire", async () => {
    const { model, requests } = recordingModel(modelConfig(), [
      toolTurn(),
      { text: "The entry point re-exports the public API." },
      { text: "Nothing else changed since." },
    ]);
    const engine = new ContextEngine({ llm: model, environment: fakeEnvironment });

    await collect(engine.run([userText("what does the entry point do?")], { approve: allowAll }));
    await collect(engine.run([userText("anything else worth knowing?")], { approve: allowAll }));

    expect(requests).toHaveLength(3);
    const reasons = diagnoseSeries(requests);
    expect(reasons, formatDiagnostics(requests, reasons)).toEqual([
      { type: "none" },
      { type: "none" },
    ]);
    // The prefix grows, it never rewrites: each request carries the previous one plus a turn.
    expect(requests.map((r) => r.wire.length)).toEqual([1, 3, 5]);
    // Tools, system prompt and every other prompt-affecting parameter are one fixed prefix.
    expect(new Set(requests.map(configFingerprint)).size).toBe(1);
  });

  it("steering delivered mid-task rides the same user turn as the tool result", async () => {
    let engine: ContextEngine | null = null;
    const { model, requests } = recordingModel(modelConfig(), [
      toolTurn(),
      { text: "Read both, here is the summary." },
    ]);
    // Steering from the approval callback lands deterministically: the tool_call has streamed,
    // the tool has not run yet, so the steer is queued before the next request is assembled.
    const approve: ApproveFn = async () => {
      expect(engine!.steer([userText("also check the tests directory")])).toBe(true);
      return "allow";
    };
    engine = new ContextEngine({ llm: model, environment: fakeEnvironment });

    await collect(engine.run([userText("read the entry point")], { approve }));

    expect(requests).toHaveLength(2);
    const reasons = diagnoseSeries(requests);
    expect(reasons, formatDiagnostics(requests, reasons)).toEqual([{ type: "none" }]);
    // One appended user turn holding the tool result and the steering text, not two.
    const appended = wireMessage(requests[1]!, -1);
    expect(appended.role).toBe("user");
    expect(blockTypes(appended)).toEqual(["tool_result", "text"]);
    expect(appended.content[1]!.text).toContain("[user_steering]");
  });

  it("moving the thinking level invalidates the prompt cache once and then holds", async () => {
    const first = recordingModel(modelConfig(), [
      { text: "First answer.", promptTokens: 20 },
      // Over the compaction threshold at the task's wrap-up round.
      { text: "Second answer.", promptTokens: 150 },
      { text: "[summary]the distilled summary[/summary]", promptTokens: 160 },
    ]);
    const second = recordingModel(modelConfig(), [{ text: "Third answer.", promptTokens: 20 }]);
    const engine = new ContextEngine({
      llm: first.model,
      environment: fakeEnvironment,
      compaction: compactionSettings(),
      openNextContext: () => ({ llm: second.model }),
    });

    await collect(engine.run([userText("task one")], { approve: allowAll }));
    engine.setThinkingLevel("high");
    await collect(engine.run([userText("task two")], { approve: allowAll }));
    await collect(engine.run([userText("task three")], { approve: allowAll }));

    expect(first.requests).toHaveLength(3);
    expect(second.requests).toHaveLength(1);
    const reasons = diagnoseSeries(first.requests);
    const report = formatDiagnostics(first.requests, reasons);
    // Exactly one invalidation, at the first request after the move, and nothing after it.
    expect(
      reasons.map((reason) => reason.type),
      report,
    ).toEqual(["parameters_changed", "none"]);
    const moved = reasons[0] as Extract<CacheMissReason, { type: "parameters_changed" }>;
    const offLevel = moved.keys.filter((key) => key !== "thinking" && key !== "output_config");
    expect(offLevel, report).toEqual([]);
    // The compaction request runs on the moved level too, not the level the context opened at.
    expect(configFingerprint(first.requests[2]!)).toBe(configFingerprint(first.requests[1]!));
    // The pin is a per-request parameter, so the context compaction opens carries it as well.
    const efforts = [...first.requests, ...second.requests].map(effortOf);
    expect(efforts, report).toEqual([undefined, "high", "high", "high"]);
  });

  // A dropped attempt is never committed to history, and the reconnect ladder re-sends the
  // turn with a `[turn_retried]` user text carrying what the attempt already produced, so the
  // model continues from it instead of re-running tools. Seen from the provider, every message
  // before that turn's input is byte-identical — tools, system prompt and the whole history
  // still hit — and only the retried turn's own input is read afresh, which is the same tail a
  // normal turn re-reads anyway (a cache entry is written at each request's end; the next
  // request's new blocks are never cached yet). The invariant is therefore not "identical
  // resend" but "the divergence never moves earlier than the retried turn's input".
  it("a reconnect changes nothing before the retried turn's input, and that input only grows", async () => {
    const { model, requests } = recordingModel(modelConfig(), [
      { text: "Starting on it", outcome: "retryable-after-text" },
      { text: "Recovered and finished." },
    ]);
    const engine = new ContextEngine({
      llm: model,
      environment: fakeEnvironment,
      reconnectBackoffMs: 1,
    });

    await collect(engine.run([userText("answer the question")], { approve: allowAll }));

    expect(requests).toHaveLength(2);
    const [first, retry] = requests as [RecordedRequest, RecordedRequest];
    const reason = diagnoseCacheMiss(first, retry);
    const report = formatDiagnostics(requests, [reason]);
    expect(reason.type, report).toBe("messages_changed");
    if (reason.type !== "messages_changed") return;
    // The divergence is the retried turn's input itself — the last message of the first
    // request — never anything before it.
    expect(reason.index, report).toBe(first.wire.length - 1);
    expect(retry.wire.slice(0, reason.index)).toEqual(first.wire.slice(0, reason.index));
    // And that input only grows: the original user text still leads it, the retry note follows.
    const before = first.wire[reason.index] as { content: unknown[] };
    const after = retry.wire[reason.index] as { content: unknown[] };
    expect(after.content.length).toBeGreaterThan(before.content.length);
    expect(after.content.slice(0, before.content.length)).toEqual(before.content);
  });

  it("a resumed session replays the live history byte for byte", async () => {
    const script: ScriptedReply[] = [
      toolTurn({
        thinking: { text: "Read the README first.", signature: "sig-resume-1" },
        toolCalls: [{ id: "call_1", name: "read_file", args: { path: "README.md" } }],
      }),
      { text: "The README explains the layout." },
    ];
    const live = recordingModel(modelConfig(), script);
    const trace = new Writer({ tracesDir: traces, sessionId: SESSION_ID });
    const engine = new ContextEngine({
      llm: live.model,
      environment: fakeEnvironment,
      trace,
      sessionMeta: metaMessage,
    });
    await collect(engine.run([userText("read the README")], { approve: allowAll }));

    const resumed = resumeTrace(await readTrace(trace.currentPath()));
    const next = recordingModel(modelConfig(), [{ text: "Here are the packages." }]);
    next.model.setHistory(resumed.history);
    const resumedEngine = new ContextEngine({ llm: next.model, environment: fakeEnvironment });
    await collect(resumedEngine.run([userText("now list the packages")], { approve: allowAll }));

    const liveHistory = await wireHistoryOf(live.model);
    expect(liveHistory).toHaveLength(4);
    const first = next.requests[0]!;
    expect(first.wire).toHaveLength(liveHistory.length + 1);
    expect(first.wire.slice(0, liveHistory.length)).toEqual(liveHistory);
    // Stated as the diagnosis: the replayed history is a cache-clean prefix of the first
    // request the resumed session sends, under the same tools, system prompt and parameters.
    const replayed: RecordedRequest = {
      index: -1,
      messages: [],
      config: live.requests[1]!.config,
      wire: liveHistory,
      wireConfig: live.requests[1]!.wireConfig,
    };
    expect(diagnoseCacheMiss(replayed, first)).toEqual({ type: "none" });
    // The blocks a replay is most likely to lose: the thinking signature and the tool pairing.
    const assistant = wireMessage(first, 1);
    expect(blockTypes(assistant)).toEqual(["thinking", "tool_use"]);
    expect(assistant.content[0]!.signature).toBe("sig-resume-1");
    expect(blockTypes(wireMessage(first, 2))).toEqual(["tool_result"]);
  });

  it("the compaction request extends the turn it follows", async () => {
    const first = recordingModel(modelConfig(), [
      // Mid-task: the tool round's usage is already over the threshold.
      toolTurn({
        toolCalls: [{ id: "call_1", name: "exec_command", args: { cmd: "pnpm -r build" } }],
        promptTokens: 150,
      }),
      { text: "[summary]the distilled summary[/summary]", promptTokens: 160 },
    ]);
    const second = recordingModel(modelConfig(), [{ text: "Carried on from the summary." }]);
    const engine = new ContextEngine({
      llm: first.model,
      environment: fakeEnvironment,
      compaction: compactionSettings(),
      openNextContext: () => ({ llm: second.model }),
    });

    await collect(engine.run([userText("build everything")], { approve: allowAll }));

    expect(first.requests).toHaveLength(2);
    const reasons = diagnoseSeries(first.requests);
    expect(reasons, formatDiagnostics(first.requests, reasons)).toEqual([{ type: "none" }]);
    // One appended user turn: the pending tool outputs, then the compaction prompt.
    const appended = wireMessage(first.requests[1]!, -1);
    expect(appended.role).toBe("user");
    expect(blockTypes(appended)).toEqual(["tool_result", "text"]);
    expect(appended.content[1]!.text).toBe(COMPACTION_PROMPT);
    expect(configFingerprint(first.requests[1]!)).toBe(configFingerprint(first.requests[0]!));
  });

  it("a model switch's compaction request extends the turn it follows on the old model; the new model's first request is a new line carrying its id", async () => {
    const target = { provider: "anthropic", model_id: "claude-opus-4-7" };
    const first = recordingModel(modelConfig(), [
      { text: "First answer.", promptTokens: 20 },
      { text: "[summary]the distilled summary[/summary]", promptTokens: 30 },
    ]);
    const second = recordingModel(modelConfig({ modelId: target.model_id }), [
      { text: "Carried on from the summary." },
    ]);
    const engine = new ContextEngine({
      llm: first.model,
      environment: fakeEnvironment,
      compaction: compactionSettings(),
      openNextContext: ({ modelRef }) => {
        expect(modelRef).toEqual(target);
        return { llm: second.model };
      },
    });

    await collect(engine.run([userText("task one")], { approve: allowAll }));
    await collect(engine.switchModel({ ref: target }));
    await collect(engine.run([userText("task two")], { approve: allowAll }));

    // The switch's compaction request is an ordinary compaction request to the OLD model: same
    // model id, tools, system prompt and parameters, one appended user turn (the prompt alone —
    // a Task-boundary switch has nothing pending to fold in).
    expect(first.requests).toHaveLength(2);
    const reasons = diagnoseSeries(first.requests);
    expect(reasons, formatDiagnostics(first.requests, reasons)).toEqual([{ type: "none" }]);
    expect(configFingerprint(first.requests[1]!)).toBe(configFingerprint(first.requests[0]!));
    expect(first.requests[1]!.wireConfig.model).toBe("claude-sonnet-4-6");
    const appended = wireMessage(first.requests[1]!, -1);
    expect(appended.role).toBe("user");
    expect(blockTypes(appended)).toEqual(["text"]);
    expect(appended.content[0]!.text).toBe(COMPACTION_PROMPT);
    // The new model's first request is a new cache line by definition — a prompt cache is
    // scoped to one model — and it opens with the summary the old model wrote.
    expect(second.requests).toHaveLength(1);
    expect(second.requests[0]!.wireConfig.model).toBe(target.model_id);
    const opening = wireMessage(second.requests[0]!, 0);
    expect(opening.role).toBe("user");
    expect(blockTypes(opening)).toEqual(["text", "text"]);
    expect(opening.content[0]!.text).toContain("[context_summary]");
    expect(opening.content[1]!.text).toBe("task two");
  });
});
