/**
 * In-session model switch (`Session.switchModel` over `ContextEngine.switchModel`).
 *
 * A switch is a compaction whose new context opens on the model the user picked: the running
 * context is summarized on the model it is on — always summarize, whatever the configured mode —
 * and the next context opens on the target. The compaction is an ordinary `manual` one: no
 * OmniMessage field or reason names the switch. The model lives only in the new context's
 * `session_meta`, and the switch opens that context's Trace file at once — its head is the
 * durable record — and streams the meta last, so a Session rebuilt from the latest file alone
 * runs on the new model, carrying the summary.
 *
 * Covered here with fake collaborators: the three engine shapes (completed turns / a context a
 * compaction just closed / an open context without a completed turn), switching twice before
 * typing, the never-run Session, the same-model and refused-target no-ops, the failure paths
 * that keep the old model, the summary-too-large guard, and — for every switch path — the file
 * the switch opened and what `resumeTrace` recovers from it. The real Agent's composition
 * (Project config, credentials, spawn inheritance) is in agent.test.ts; `agent.resumeSession`
 * on a switched Session's Trace is in resume.test.ts.
 */
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assistantText,
  imageUrlMessage,
  sessionMeta,
  tokenUsage,
  toolListReady,
  userText,
} from "../src/omnimessage/index.js";
import type {
  CompactionBeginPayload,
  CompactionEndPayload,
  OmniMessage,
  SessionMetaPayload,
  TextPayload,
} from "../src/omnimessage/index.js";
import type {
  ApproveFn,
  EnvironmentInterface,
  GenerativeModelParameters,
  LLMInterface,
  LLMOutcome,
} from "../src/interfaces/index.js";
import type { CompactionSettings, OpenContextOptions } from "../src/engine/context-engine.js";
import { ModelSwitchRefusedError } from "../src/engine/context-engine.js";
import { Session } from "../src/session.js";
import type { ModelSwitchSupport, SessionConfig } from "../src/session.js";
import type { ModelRef } from "../src/state/project-config.js";
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
      return { status: "retryable", errorMessage: `${this.label}: no scripted response` };
    }
    for (const msg of next.messages) yield msg;
    return next.outcome ?? { status: "completed" };
  }
}

/** Fake Environment that never runs real commands. */
const fakeEnvironment: EnvironmentInterface = {
  async listTools() {
    return [];
  },
  async *executeTool() {
    throw new Error("no tool runs in these scenarios");
  },
  toolPermission() {
    return "rw";
  },
};

const allowAll: ApproveFn = async () => "allow";

const usage = (requestTotal: number, sessionTotal: number): OmniMessage =>
  tokenUsage(
    { cache_read: 0, cache_write: 0, output: 0, total: sessionTotal },
    { cache_read: 0, cache_write: 0, output: 0, total: requestTotal },
  );

const settings = (over: Partial<CompactionSettings> = {}): CompactionSettings => ({
  // High enough that no scenario compacts on its own unless it says so.
  maxContextLength: 1000,
  maxSessionTurns: -1,
  mode: "summarize",
  prompt: "COMPACT NOW",
  ...over,
});

const MODEL_A: ModelRef = { provider: "custom", model_id: "model-a" };
const MODEL_B: ModelRef = { provider: "custom", model_id: "model-b" };
const MODEL_C: ModelRef = { provider: "custom", model_id: "model-c" };
const SESSION_ID = "sess_switch";

const metaFor = (model: ModelRef): SessionMetaPayload => ({
  session_id: SESSION_ID,
  provider: model.provider,
  model_id: model.model_id,
  model_context_window: 200000,
  system_prompt: "sp",
  agent_state: "/tmp/state",
  workspace: "/tmp/ws",
});

const SUMMARY_REPLY = "[summary]the distilled summary[/summary]";
const SUMMARY_TEXT = "[context_summary]\nthe distilled summary\n[/context_summary]";

async function collect<R>(gen: AsyncGenerator<OmniMessage, R>): Promise<OmniMessage[]> {
  const all: OmniMessage[] = [];
  for (;;) {
    const res = await gen.next();
    if (res.done) return all;
    all.push(res.value);
  }
}

/** Like collect, but also captures the generator's return value. */
async function collectWithReturn<R>(
  gen: AsyncGenerator<OmniMessage, R>,
): Promise<{ all: OmniMessage[]; result: R }> {
  const all: OmniMessage[] = [];
  for (;;) {
    const res = await gen.next();
    if (res.done) return { all, result: res.value };
    all.push(res.value);
  }
}

type CompactionEventPayload = CompactionBeginPayload | CompactionEndPayload;

const compactionEvents = (msgs: OmniMessage[]): CompactionEventPayload[] =>
  msgs
    .filter((m) => {
      const t = (m.payload as { type?: string }).type ?? "";
      return t === "compaction_begin" || t === "compaction_end";
    })
    .map((m) => m.payload as CompactionEventPayload);

/** Each record's kind: the payload type, or `session_meta` for the file head (whose payload carries no type). */
const payloadTypes = (msgs: OmniMessage[]): (string | undefined)[] =>
  msgs.map((m) =>
    m.type === "session_meta" ? "session_meta" : (m.payload as { type?: string }).type,
  );

const textOf = (m: OmniMessage): string => (m.payload as TextPayload).text;

/** The user-side texts of `msgs`, in order — what a replayed history sends as the user's side. */
const userTexts = (msgs: OmniMessage[]): string[] =>
  msgs
    .filter((m) => {
      const p = m.payload as { type?: string; role?: string };
      return p.type === "text" && p.role === "user";
    })
    .map(textOf);

/** Each message's payload type (`image_url` is what a text-only model must never receive). */
const payloadTypeList = (msgs: OmniMessage[]): string[] =>
  msgs.map((m) => (m.payload as { type: string }).type);

/** The model a `session_meta` record names, as a reference. */
const modelOf = (m: OmniMessage): ModelRef => {
  const p = m.payload as SessionMetaPayload;
  return { provider: p.provider, model_id: p.model_id };
};

/** The switch stream's last record is the new context's session_meta, naming `model`. */
const expectEndsWithMetaOn = (all: OmniMessage[], model: ModelRef): void => {
  const last = all.at(-1)!;
  expect(last.type).toBe("session_meta");
  expect(modelOf(last)).toEqual(model);
};

const hasMeta = (msgs: OmniMessage[]): boolean => msgs.some((m) => m.type === "session_meta");

/**
 * The composition layer's half, as fakes that record what they were asked: which model each
 * opened context was asked for, which targets were validated, and which ref a never-run
 * Session's first context was re-assembled on. `llms` maps a model id to the LLM the next
 * context on that model gets (a plain compaction keeps the model, so it takes the current one's
 * next object); `vision` maps a model id to its vision answer (default: views images). Like the
 * real opener, each opened context publishes its toolset record.
 */
interface Harness {
  opens: (ModelRef | undefined)[];
  validated: ModelRef[];
  reassembled: ModelRef[];
  written: OmniMessage[];
  trace: Writer;
  session: Session;
  /** The Session's Trace files, in index order. */
  files: () => Promise<string[]>;
}

function harness(
  traces: string,
  args: {
    llmA: LLMInterface;
    /** LLM objects for contexts opened on each model id, taken in order. */
    llms: Record<string, LLMInterface[]>;
    compaction?: CompactionSettings;
    vision?: Record<string, boolean>;
    windows?: Record<string, number | undefined>;
    modelHasVision?: boolean;
    extras?: Partial<SessionConfig>;
  },
): Harness {
  const opens: (ModelRef | undefined)[] = [];
  const validated: ModelRef[] = [];
  const reassembled: ModelRef[] = [];
  const written: OmniMessage[] = [];
  let current = MODEL_A;
  const trace = new Writer({ tracesDir: traces, sessionId: SESSION_ID });
  const sink = {
    write: async (msg: OmniMessage) => {
      written.push(msg);
      await trace.write(msg);
    },
    rotate: () => trace.rotate(),
    currentPath: () => trace.currentPath(),
  };
  const modelSwitch: ModelSwitchSupport = {
    async validate(ref) {
      validated.push(ref);
      if (ref.model_id === "unknown") {
        throw new Error(`Model is not in the Project config: ${ref.model_id}`);
      }
      const windows = args.windows ?? {};
      return { contextWindow: ref.model_id in windows ? windows[ref.model_id] : 200000 };
    },
    async reassembleInitialContext(ref) {
      reassembled.push(ref);
      current = ref;
      return {
        sessionMeta: sessionMeta(metaFor(ref)),
        ...(args.vision?.[ref.model_id] !== undefined
          ? { modelHasVision: args.vision[ref.model_id]! }
          : {}),
      };
    },
  };
  const session = new Session({
    meta: metaFor(MODEL_A),
    bootstrap: async () => ({ llm: args.llmA }),
    environment: fakeEnvironment,
    trace: sink,
    compaction: args.compaction ?? settings(),
    openNextContext: ({ modelRef, emit }: OpenContextOptions) => {
      opens.push(modelRef);
      const model = modelRef ?? current;
      current = model;
      const llm = args.llms[model.model_id]?.shift();
      if (!llm) throw new Error(`no LLM prepared for a context on ${model.model_id}`);
      emit(toolListReady([]));
      return {
        llm,
        sessionMeta: sessionMeta(metaFor(model)),
        ...(args.vision?.[model.model_id] !== undefined
          ? { modelHasVision: args.vision[model.model_id]! }
          : {}),
      };
    },
    modelSwitch,
    imagesDir: join(traces, "scratch"),
    modelHasVision: args.modelHasVision ?? true,
    ...args.extras,
  });
  const files = async (): Promise<string[]> =>
    (await readdir(dirname(trace.currentPath()))).filter((f) => f.endsWith(".jsonl")).sort();
  return { opens, validated, reassembled, written, trace, session, files };
}

const switchTo = (session: Session, model: ModelRef, signal?: AbortSignal) =>
  session.switchModel({
    provider: model.provider,
    modelId: model.model_id,
    ...(signal ? { signal } : {}),
  });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("in-session model switch", () => {
  let traces: string;
  const sessions: Session[] = [];

  beforeEach(async () => {
    traces = await mkdtemp(join(tmpdir(), "penguin-model-switch-"));
  });

  afterEach(async () => {
    for (const s of sessions.splice(0)) s.dispose();
    await rm(traces, { recursive: true, force: true });
  });

  it("after completed turns: a plain manual summarize on the old model whatever the configured mode, then the target's file opens at once, headed by the session_meta the stream carries last", async () => {
    const llmA = new ScriptedLLM(
      [
        { messages: [assistantText("answer one"), usage(50, 50)] },
        { messages: [assistantText(SUMMARY_REPLY), usage(60, 110)] },
      ],
      "A",
    );
    const llmB = new ScriptedLLM(
      [{ messages: [assistantText("answer two"), usage(20, 130)] }],
      "B",
    );
    const h = harness(traces, {
      llmA,
      llms: { [MODEL_B.model_id]: [llmB] },
      // The user's rule: a switch summarizes even when the Agent compacts by discarding.
      compaction: settings({ mode: "discard" }),
    });
    sessions.push(h.session);
    const oldPath = h.trace.currentPath();

    await collect(h.session.run([userText("task one")], { approve: allowAll }));
    expect(h.session.compactability()).toBe("ok");

    const { all, result } = await collectWithReturn(switchTo(h.session, MODEL_B));

    expect(result).toEqual({ status: "completed", previous: MODEL_A, next: MODEL_B });
    // The target was validated before anything else happened.
    expect(h.validated).toEqual([MODEL_B]);
    // An ordinary manual summarize pair: nothing on it names a model.
    expect(compactionEvents(all)).toEqual([
      { type: "compaction_begin", reason: "manual", mode: "summarize", context: 50, turns: 1 },
      {
        type: "compaction_end",
        reason: "manual",
        mode: "summarize",
        status: "completed",
        attempt: 1,
      },
    ]);
    // The compaction request went to the OLD model; the opener was told the target.
    expect(llmA.calls).toHaveLength(2);
    expect(llmA.calls[1]!.map(textOf)).toEqual(["COMPACT NOW"]);
    expect(h.opens).toEqual([MODEL_B]);
    // The stream: the pair, the opener's toolset record, and last the new context's meta.
    expect(payloadTypes(all).slice(-3)).toEqual([
      "compaction_end",
      "tool_list_ready",
      "session_meta",
    ]);
    expectEndsWithMetaOn(all, MODEL_B);
    // The Session answers with the new model from here.
    expect(h.session.provider).toBe(MODEL_B.provider);
    expect(h.session.modelId).toBe(MODEL_B.model_id);
    expect(modelOf(h.session.metaMessage)).toEqual(MODEL_B);
    expect(h.session.compactability()).toBe("just_compacted");

    // Durability: the closed file ends with the plain pair, and the new file already exists —
    // the target's meta, its toolset, the summary as the context's first input.
    expect(await h.files()).toEqual([`${SESSION_ID}_001.jsonl`, `${SESSION_ID}_002.jsonl`]);
    expect((await readTrace(oldPath)).at(-1)!.payload).toMatchObject({
      type: "compaction_end",
      reason: "manual",
      status: "completed",
    });
    const opened = await readTrace(h.trace.currentPath());
    expect(payloadTypes(opened)).toEqual(["session_meta", "tool_list_ready", "text"]);
    expect(modelOf(opened[0]!)).toEqual(MODEL_B);
    expect(textOf(opened[2]!)).toBe(SUMMARY_TEXT);
    // A Session rebuilt from that file alone: no history, the summary pending, on B.
    const resumed = resumeTrace(opened);
    expect(resumed.contextClosed).toBe(false);
    expect(resumed.history).toEqual([]);
    expect(resumed.sessionTurns).toBe(0);
    expect(resumed.carryOver.map(textOf)).toEqual([SUMMARY_TEXT]);
    expect(modelOf(resumed.meta!)).toEqual(MODEL_B);

    // The summary leads the new model's first input, and is not written a second time.
    await collect(h.session.run([userText("task two")], { approve: allowAll }));
    expect(llmB.calls).toHaveLength(1);
    expect(llmB.calls[0]!.map(textOf)).toEqual([SUMMARY_TEXT, "task two"]);
    const fresh = await readTrace(h.trace.currentPath());
    expect(payloadTypes(fresh).slice(0, 4)).toEqual([
      "session_meta",
      "tool_list_ready",
      "text",
      "text",
    ]);
    expect(textOf(fresh[3]!)).toBe("task two");
    expect(fresh.filter((m) => m.type === "model_msg" && textOf(m) === SUMMARY_TEXT)).toHaveLength(
      1,
    );
  });

  it("right after a compaction: no request and no pair; the rotation is performed on the target and the held summary heads the new file", async () => {
    const llmA = new ScriptedLLM(
      [
        // Over the threshold at the task's wrap-up round: the Agent's own compaction fires.
        { messages: [assistantText("answer one"), usage(150, 150)] },
        { messages: [assistantText(SUMMARY_REPLY), usage(160, 310)] },
      ],
      "A",
    );
    // The context the compaction opens stays on A; the switch then moves off it unused.
    const llmA2 = new ScriptedLLM([], "A2");
    const llmB = new ScriptedLLM(
      [{ messages: [assistantText("answer two"), usage(20, 330)] }],
      "B",
    );
    const h = harness(traces, {
      llmA,
      llms: { [MODEL_A.model_id]: [llmA2], [MODEL_B.model_id]: [llmB] },
      compaction: settings({ maxContextLength: 100 }),
    });
    sessions.push(h.session);
    const oldPath = h.trace.currentPath();

    await collect(h.session.run([userText("task one")], { approve: allowAll }));
    expect(h.opens).toEqual([undefined]);
    expect(h.session.compactability()).toBe("just_compacted");
    const closedBefore = await readTrace(oldPath);

    const { all, result } = await collectWithReturn(switchTo(h.session, MODEL_B));

    expect(result.status).toBe("completed");
    // No model was asked anything, and nothing was compacted: the summary is already held and
    // the closing pair is already on the closed file.
    expect(llmA.calls).toHaveLength(2);
    expect(llmA2.calls).toHaveLength(0);
    expect(compactionEvents(all)).toEqual([]);
    expect(payloadTypes(all)).toEqual(["tool_list_ready", "session_meta"]);
    expectEndsWithMetaOn(all, MODEL_B);
    expect(h.opens).toEqual([undefined, MODEL_B]);
    expect(h.session.modelId).toBe(MODEL_B.model_id);
    expect(h.session.compactability()).toBe("just_compacted");

    // Durability: the closed file is untouched; the context the compaction had opened on A was
    // never written and never exists on disk; the new file is B's, headed by its meta, with the
    // summary as its first input.
    expect(await readTrace(oldPath)).toEqual(closedBefore);
    expect(await h.files()).toEqual([`${SESSION_ID}_001.jsonl`, `${SESSION_ID}_002.jsonl`]);
    const opened = await readTrace(h.trace.currentPath());
    expect(payloadTypes(opened)).toEqual(["session_meta", "tool_list_ready", "text"]);
    expect(modelOf(opened[0]!)).toEqual(MODEL_B);
    expect(textOf(opened[2]!)).toBe(SUMMARY_TEXT);
    const resumed = resumeTrace(opened);
    expect(resumed.contextClosed).toBe(false);
    expect(resumed.carryOver.map(textOf)).toEqual([SUMMARY_TEXT]);

    await collect(h.session.run([userText("task two")], { approve: allowAll }));
    expect(llmB.calls[0]!.map(textOf)).toEqual([SUMMARY_TEXT, "task two"]);
    const fresh = await readTrace(h.trace.currentPath());
    expect(fresh.filter((m) => m.type === "model_msg" && textOf(m) === SUMMARY_TEXT)).toHaveLength(
      1,
    );
  });

  it("right after a discard compaction: no pair; the new file holds meta and tools only", async () => {
    const llmA = new ScriptedLLM(
      [{ messages: [assistantText("answer one"), usage(150, 150)] }],
      "A",
    );
    const llmA2 = new ScriptedLLM([], "A2");
    const llmB = new ScriptedLLM(
      [{ messages: [assistantText("answer two"), usage(20, 170)] }],
      "B",
    );
    const h = harness(traces, {
      llmA,
      llms: { [MODEL_A.model_id]: [llmA2], [MODEL_B.model_id]: [llmB] },
      compaction: settings({ maxContextLength: 100, mode: "discard" }),
    });
    sessions.push(h.session);

    await collect(h.session.run([userText("task one")], { approve: allowAll }));
    expect(h.session.compactability()).toBe("just_compacted");
    const { all, result } = await collectWithReturn(switchTo(h.session, MODEL_B));

    expect(result.status).toBe("completed");
    expect(compactionEvents(all)).toEqual([]);
    expectEndsWithMetaOn(all, MODEL_B);
    expect(await h.files()).toEqual([`${SESSION_ID}_001.jsonl`, `${SESSION_ID}_002.jsonl`]);
    const opened = await readTrace(h.trace.currentPath());
    expect(payloadTypes(opened)).toEqual(["session_meta", "tool_list_ready"]);
    expect(modelOf(opened[0]!)).toEqual(MODEL_B);
    const resumed = resumeTrace(opened);
    expect(resumed.contextClosed).toBe(false);
    expect(resumed.carryOver).toEqual([]);

    await collect(h.session.run([userText("task two")], { approve: allowAll }));
    expect(llmB.calls[0]!.map(textOf)).toEqual(["task two"]);
  });

  it("an open context whose first request never completed is closed by a manual discard pair: its text carry-over follows to the new model in memory, and the new file holds meta and tools only", async () => {
    const llmA = new ScriptedLLM([], "A");
    const llmB = new ScriptedLLM([{ messages: [assistantText("answer"), usage(20, 20)] }], "B");
    const h = harness(traces, { llmA, llms: { [MODEL_B.model_id]: [llmB] } });
    sessions.push(h.session);
    const oldPath = h.trace.currentPath();

    // Aborted before the request went out: the input is written and held as carry-over.
    const controller = new AbortController();
    controller.abort();
    await collect(h.session.run([userText("task one")], { signal: controller.signal }));
    expect(llmA.calls).toHaveLength(0);
    expect(h.session.compactability()).toBe("empty");

    const { all, result } = await collectWithReturn(switchTo(h.session, MODEL_B));

    expect(result.status).toBe("completed");
    expect(compactionEvents(all)).toEqual([
      { type: "compaction_begin", reason: "manual", mode: "discard", context: 0, turns: 0 },
      { type: "compaction_end", reason: "manual", mode: "discard", status: "completed" },
    ]);
    expectEndsWithMetaOn(all, MODEL_B);
    expect(llmA.calls).toHaveLength(0);
    expect(h.session.modelId).toBe(MODEL_B.model_id);

    // Durability: the old file closes on the discard pair; the new file opens at once on B. The
    // carry-over is not written to it — carry-over may hold synthetic messages, which are never
    // persisted — so a resume of that file has nothing pending (the documented gap: the user
    // re-sends the message).
    expect(payloadTypes(await readTrace(oldPath))).toEqual([
      "session_meta",
      "text",
      "abort",
      "compaction_begin",
      "compaction_end",
    ]);
    const opened = await readTrace(h.trace.currentPath());
    expect(payloadTypes(opened)).toEqual(["session_meta", "tool_list_ready"]);
    expect(modelOf(opened[0]!)).toEqual(MODEL_B);
    expect(resumeTrace(opened).carryOver).toEqual([]);

    // In-process the carry-over rides.
    await collect(h.session.run([userText("task two")], { approve: allowAll }));
    expect(llmB.calls[0]!.map(textOf)).toEqual(["task one", "task two"]);
  });

  it("a just-compacted context the user already wrote on is discarded the same way: the summary written there rides in memory and heads the new file, the aborted prompt rides in memory only", async () => {
    const llmA = new ScriptedLLM(
      [
        { messages: [assistantText("answer one"), usage(150, 150)] },
        { messages: [assistantText(SUMMARY_REPLY), usage(160, 310)] },
      ],
      "A",
    );
    const llmA2 = new ScriptedLLM([], "A2");
    const llmB = new ScriptedLLM([{ messages: [assistantText("answer"), usage(20, 330)] }], "B");
    const h = harness(traces, {
      llmA,
      llms: { [MODEL_A.model_id]: [llmA2], [MODEL_B.model_id]: [llmB] },
      compaction: settings({ maxContextLength: 100 }),
    });
    sessions.push(h.session);

    await collect(h.session.run([userText("task one")], { approve: allowAll }));
    // The next run rotates the Trace (summary + prompt land in the new file) and then never
    // issues its request: the context on A2 is open, with the summary as carry-over.
    const controller = new AbortController();
    controller.abort();
    await collect(h.session.run([userText("task two")], { signal: controller.signal }));
    const openPath = h.trace.currentPath();
    expect(payloadTypes(await readTrace(openPath))).toEqual([
      "session_meta",
      "tool_list_ready",
      "text",
      "text",
      "abort",
    ]);
    expect(h.session.compactability()).toBe("just_compacted");

    const { all, result } = await collectWithReturn(switchTo(h.session, MODEL_B));

    expect(result.status).toBe("completed");
    expect(compactionEvents(all).map((e) => [e.reason, e.mode])).toEqual([
      ["manual", "discard"],
      ["manual", "discard"],
    ]);
    expectEndsWithMetaOn(all, MODEL_B);
    expect(llmA2.calls).toHaveLength(0);

    // The closed file keeps the summary for a reader. The new file holds meta, tools — and the
    // summary again: it is the one record of the conversation before the compaction, and a
    // resume of this file must not replay a history without it. The aborted prompt is not
    // written (carry-over may hold synthetic messages; the user re-sends it).
    const closed = await readTrace(openPath);
    expect(payloadTypes(closed).slice(-2)).toEqual(["compaction_begin", "compaction_end"]);
    expect(textOf(closed[2]!)).toBe(SUMMARY_TEXT);
    const opened = await readTrace(h.trace.currentPath());
    expect(h.trace.currentPath()).not.toBe(openPath);
    expect(payloadTypes(opened)).toEqual(["session_meta", "tool_list_ready", "text"]);
    expect(textOf(opened[2]!)).toBe(SUMMARY_TEXT);
    expect(resumeTrace(opened).carryOver.map(textOf)).toEqual([SUMMARY_TEXT]);

    await collect(h.session.run([userText("task three")], { approve: allowAll }));
    // In-process the aborted input is carried as-is (it never reached a request), the summary
    // once — the file's copy is not re-sent.
    expect(llmB.calls[0]!.map(textOf)).toEqual([SUMMARY_TEXT, "task two", "task three"]);
    expect(userTexts(resumeTrace(await readTrace(h.trace.currentPath())).history)).toEqual([
      SUMMARY_TEXT,
      "task three",
    ]);
  });

  it("switching twice before typing: the second switch takes the discard path on the eagerly opened file, and the summary rides in memory and heads the third file", async () => {
    const llmA = new ScriptedLLM(
      [
        { messages: [assistantText("answer one"), usage(50, 50)] },
        { messages: [assistantText(SUMMARY_REPLY), usage(60, 110)] },
      ],
      "A",
    );
    const llmB = new ScriptedLLM([], "B");
    const llmC = new ScriptedLLM(
      [{ messages: [assistantText("answer two"), usage(20, 130)] }],
      "C",
    );
    const h = harness(traces, {
      llmA,
      llms: { [MODEL_B.model_id]: [llmB], [MODEL_C.model_id]: [llmC] },
    });
    sessions.push(h.session);

    await collect(h.session.run([userText("task one")], { approve: allowAll }));
    await collect(switchTo(h.session, MODEL_B));
    const bPath = h.trace.currentPath();

    const { all, result } = await collectWithReturn(switchTo(h.session, MODEL_C));

    expect(result).toEqual({ status: "completed", previous: MODEL_B, next: MODEL_C });
    // B's context holds the summary as an input but no completed turn: a discard pair closes it.
    expect(compactionEvents(all)).toEqual([
      { type: "compaction_begin", reason: "manual", mode: "discard", context: 0, turns: 0 },
      { type: "compaction_end", reason: "manual", mode: "discard", status: "completed" },
    ]);
    expectEndsWithMetaOn(all, MODEL_C);
    expect(llmB.calls).toHaveLength(0);
    expect(h.opens).toEqual([MODEL_B, MODEL_C]);
    expect(h.session.modelId).toBe(MODEL_C.model_id);

    expect(await h.files()).toEqual([
      `${SESSION_ID}_001.jsonl`,
      `${SESSION_ID}_002.jsonl`,
      `${SESSION_ID}_003.jsonl`,
    ]);
    expect(payloadTypes(await readTrace(bPath))).toEqual([
      "session_meta",
      "tool_list_ready",
      "text",
      "compaction_begin",
      "compaction_end",
    ]);
    // C's file opens with the summary B's context had opened with — the only record of the
    // conversation on A — so a resume of it lands on C with the summary pending, as a resume
    // of B's file would have.
    const opened = await readTrace(h.trace.currentPath());
    expect(payloadTypes(opened)).toEqual(["session_meta", "tool_list_ready", "text"]);
    expect(modelOf(opened[0]!)).toEqual(MODEL_C);
    expect(textOf(opened[2]!)).toBe(SUMMARY_TEXT);
    expect(resumeTrace(opened).carryOver.map(textOf)).toEqual([SUMMARY_TEXT]);

    await collect(h.session.run([userText("task two")], { approve: allowAll }));
    // Live, the summary is sent once; on disk it is written once — the run does not re-write it.
    expect(llmC.calls[0]!.map(textOf)).toEqual([SUMMARY_TEXT, "task two"]);
    const latest = await readTrace(h.trace.currentPath());
    expect(payloadTypes(latest).slice(0, 4)).toEqual([
      "session_meta",
      "tool_list_ready",
      "text",
      "text",
    ]);
    // Any later restart replays C's history from this file, the summary at its head.
    expect(userTexts(resumeTrace(latest).history)).toEqual([SUMMARY_TEXT, "task two"]);
  });

  it("a failed first request on the new model, then another switch: the summary the failed context opened with heads the next file, while the model gets the [turn_aborted] flatten", async () => {
    const llmA = new ScriptedLLM(
      [
        { messages: [assistantText("answer one"), usage(50, 50)] },
        { messages: [assistantText(SUMMARY_REPLY), usage(60, 110)] },
      ],
      "A",
    );
    const llmB = new ScriptedLLM(
      [{ messages: [], outcome: { status: "fatal", errorMessage: "B rejected the request" } }],
      "B",
    );
    const llmC = new ScriptedLLM(
      [{ messages: [assistantText("answer three"), usage(20, 130)] }],
      "C",
    );
    const h = harness(traces, {
      llmA,
      llms: { [MODEL_B.model_id]: [llmB], [MODEL_C.model_id]: [llmC] },
    });
    sessions.push(h.session);

    await collect(h.session.run([userText("task one")], { approve: allowAll }));
    await collect(switchTo(h.session, MODEL_B));
    // B's first request fails outright: no completed turn, the summary and the prompt become a
    // `[turn_aborted]` flatten in the carry-over, where nothing marks the summary any more.
    await collect(h.session.run([userText("task two")], { approve: allowAll }));
    expect(llmB.calls[0]!.map(textOf)).toEqual([SUMMARY_TEXT, "task two"]);
    expect(h.session.compactability()).toBe("just_compacted");

    const { all, result } = await collectWithReturn(switchTo(h.session, MODEL_C));
    expect(result.status).toBe("completed");
    expect(compactionEvents(all).map((e) => [e.reason, e.mode])).toEqual([
      ["manual", "discard"],
      ["manual", "discard"],
    ]);
    expectEndsWithMetaOn(all, MODEL_C);

    const opened = await readTrace(h.trace.currentPath());
    expect(payloadTypes(opened)).toEqual(["session_meta", "tool_list_ready", "text"]);
    expect(modelOf(opened[0]!)).toEqual(MODEL_C);
    expect(textOf(opened[2]!)).toBe(SUMMARY_TEXT);

    await collect(h.session.run([userText("task three")], { approve: allowAll }));
    // The live request carries the flatten (the summary inside it) — request assembly after a
    // failed request is unchanged — and the file carries the summary as a plain record.
    const live = llmC.calls[0]!.map(textOf);
    expect(live).toHaveLength(2);
    expect(live[0]).toMatch(/^\[turn_aborted\]/);
    expect(live[0]).toContain(SUMMARY_TEXT);
    expect(live[1]).toBe("task three");
    expect(userTexts(resumeTrace(await readTrace(h.trace.currentPath())).history)).toEqual([
      SUMMARY_TEXT,
      "task three",
    ]);
  });

  it("compact, a failed request on the new context, then a switch: the summary heads the target's file the same way", async () => {
    const llmA = new ScriptedLLM(
      [
        { messages: [assistantText("answer one"), usage(50, 50)] },
        { messages: [assistantText(SUMMARY_REPLY), usage(60, 110)] },
      ],
      "A",
    );
    // The context the compaction opened, still on A: its first request fails.
    const llmA2 = new ScriptedLLM(
      [{ messages: [], outcome: { status: "fatal", errorMessage: "A rejected the request" } }],
      "A2",
    );
    const llmB = new ScriptedLLM([{ messages: [assistantText("answer"), usage(20, 130)] }], "B");
    const h = harness(traces, {
      llmA,
      llms: { [MODEL_A.model_id]: [llmA2], [MODEL_B.model_id]: [llmB] },
    });
    sessions.push(h.session);

    await collect(h.session.run([userText("task one")], { approve: allowAll }));
    await collect(h.session.compact());
    await collect(h.session.run([userText("task two")], { approve: allowAll }));
    expect(llmA2.calls[0]!.map(textOf)).toEqual([SUMMARY_TEXT, "task two"]);
    const failedPath = h.trace.currentPath();

    const { all, result } = await collectWithReturn(switchTo(h.session, MODEL_B));
    expect(result.status).toBe("completed");
    expect(compactionEvents(all).map((e) => [e.reason, e.mode])).toEqual([
      ["manual", "discard"],
      ["manual", "discard"],
    ]);
    expectEndsWithMetaOn(all, MODEL_B);
    expect(payloadTypes(await readTrace(failedPath)).slice(-2)).toEqual([
      "compaction_begin",
      "compaction_end",
    ]);

    const opened = await readTrace(h.trace.currentPath());
    expect(payloadTypes(opened)).toEqual(["session_meta", "tool_list_ready", "text"]);
    expect(modelOf(opened[0]!)).toEqual(MODEL_B);
    expect(textOf(opened[2]!)).toBe(SUMMARY_TEXT);
    expect(resumeTrace(opened).carryOver.map(textOf)).toEqual([SUMMARY_TEXT]);

    await collect(h.session.run([userText("task three")], { approve: allowAll }));
    expect(userTexts(resumeTrace(await readTrace(h.trace.currentPath())).history)).toEqual([
      SUMMARY_TEXT,
      "task three",
    ]);
  });

  it("a held summary the target's window cannot take refuses a just-compacted switch before any event, and a roomier target then takes it", async () => {
    const longSummary = `[summary]${"x".repeat(12000)}[/summary]`;
    const llmA = new ScriptedLLM(
      [
        { messages: [assistantText("answer one"), usage(50, 50)] },
        { messages: [assistantText(longSummary), usage(3100, 3150)] },
      ],
      "A",
    );
    // The compaction opens a fresh context on A (never asked anything: the switch away from it
    // sends no request); the refused target B gets no context; C takes the summary.
    const llmA2 = new ScriptedLLM([], "A2");
    const llmB = new ScriptedLLM([], "B");
    const llmC = new ScriptedLLM([{ messages: [assistantText("answer"), usage(20, 3170)] }], "C");
    const h = harness(traces, {
      llmA,
      llms: {
        [MODEL_A.model_id]: [llmA2],
        [MODEL_B.model_id]: [llmB],
        [MODEL_C.model_id]: [llmC],
      },
      // B: 4096 − prefix − 2048 headroom leaves ~2k for a ~3k summary. C: room to spare.
      windows: { [MODEL_B.model_id]: 4096, [MODEL_C.model_id]: 200000 },
    });
    sessions.push(h.session);
    await collect(h.session.run([userText("task one")], { approve: allowAll }));
    await collect(h.session.compact());
    expect(h.session.compactability()).toBe("just_compacted");
    const writtenBefore = h.written.length;

    // No pair can end `fatal` here — nothing is compacted — so the switch is refused the way
    // target validation refuses: typed, before any event, the Session untouched.
    const refusal = await collect(switchTo(h.session, MODEL_B)).catch((e: unknown) => e);
    expect(refusal).toBeInstanceOf(ModelSwitchRefusedError);
    expect((refusal as ModelSwitchRefusedError).reason).toBe("summary_too_large");
    expect((refusal as Error).message).toMatch(/about 30\d\d tokens/);
    expect((refusal as Error).message).toMatch(/4096 tokens/);
    expect((refusal as Error).message).toMatch(/stays on its current model/);
    expect(h.written).toHaveLength(writtenBefore);
    // The compaction's own open (on A, no target) is the only one; B was never opened.
    expect(h.opens).toEqual([undefined]);
    expect(h.session.modelId).toBe(MODEL_A.model_id);
    expect(await h.files()).toEqual([`${SESSION_ID}_001.jsonl`]);
    expect(h.session.compactability()).toBe("just_compacted");

    // The summary is still held: a target with room takes it at the head of its file.
    const { all, result } = await collectWithReturn(switchTo(h.session, MODEL_C));
    expect(result.status).toBe("completed");
    expect(compactionEvents(all)).toEqual([]);
    expectEndsWithMetaOn(all, MODEL_C);
    const opened = await readTrace(h.trace.currentPath());
    expect(payloadTypes(opened)).toEqual(["session_meta", "tool_list_ready", "text"]);
    expect(textOf(opened[2]!)).toContain("x".repeat(12000));
    expect(h.session.modelId).toBe(MODEL_C.model_id);
  });

  it("a Prompt with an image, stopped before its bootstrap on a vision model, reaches a text-only model folded into a path line", async () => {
    const llmA = new ScriptedLLM([], "A");
    const llmB = new ScriptedLLM([{ messages: [assistantText("answer"), usage(20, 20)] }], "B");
    const h = harness(traces, {
      llmA,
      llms: { [MODEL_B.model_id]: [llmB] },
      vision: { [MODEL_B.model_id]: false },
    });
    sessions.push(h.session);

    // Stopped during the first connect: the Session itself holds the input, as sent, for a
    // model that viewed images.
    const controller = new AbortController();
    controller.abort();
    await collect(
      h.session.run([userText("look"), imageUrlMessage("https://images.invalid/pic.png")], {
        signal: controller.signal,
      }),
    );
    await collect(switchTo(h.session, MODEL_B));
    expect(h.session.modelId).toBe(MODEL_B.model_id);

    await collect(h.session.run([userText("task two")], { approve: allowAll }));
    const first = llmB.calls[0]!;
    expect(payloadTypeList(first)).toEqual(["text", "text"]);
    expect(textOf(first[0]!)).toContain("look");
    expect(textOf(first[0]!)).toContain("[attached image: https://images.invalid/pic.png]");
    expect(textOf(first[1]!)).toBe("task two");
  });

  it("a Prompt with an image the engine held as-is (stopped before its request) reaches a text-only model folded as well", async () => {
    // A's first request fails, so the context is open with no completed turn and the engine
    // exists; the next run is stopped before its request goes out and its input — image
    // included — is held unchanged as the engine's carry-over.
    const llmA = new ScriptedLLM(
      [{ messages: [], outcome: { status: "fatal", errorMessage: "A is down" } }],
      "A",
    );
    const llmB = new ScriptedLLM([{ messages: [assistantText("answer"), usage(20, 20)] }], "B");
    const h = harness(traces, {
      llmA,
      llms: { [MODEL_B.model_id]: [llmB] },
      vision: { [MODEL_B.model_id]: false },
    });
    sessions.push(h.session);

    await collect(h.session.run([userText("task one")], { approve: allowAll }));
    expect(llmA.calls).toHaveLength(1);
    const controller = new AbortController();
    controller.abort();
    await collect(
      h.session.run([userText("look"), imageUrlMessage("https://images.invalid/pic.png")], {
        signal: controller.signal,
      }),
    );
    expect(llmA.calls).toHaveLength(1);

    const { all } = await collectWithReturn(switchTo(h.session, MODEL_B));
    expect(compactionEvents(all).map((e) => e.mode)).toEqual(["discard", "discard"]);

    await collect(h.session.run([userText("task two")], { approve: allowAll }));
    const first = llmB.calls[0]!;
    expect(payloadTypeList(first)).not.toContain("image_url");
    const texts = first.map(textOf);
    expect(texts.some((t) => t.includes("[attached image: https://images.invalid/pic.png]"))).toBe(
      true,
    );
    expect(texts.at(-1)).toBe("task two");
  });

  it("a Session that never ran is re-assembled on the target: no events, nothing written, and its first run opens on it", async () => {
    const llmB = new ScriptedLLM([{ messages: [assistantText("answer"), usage(20, 20)] }], "B");
    const h = harness(traces, { llmA: llmB, llms: {}, vision: { [MODEL_B.model_id]: false } });
    sessions.push(h.session);

    const { all, result } = await collectWithReturn(switchTo(h.session, MODEL_B));

    expect(result).toEqual({ status: "completed", previous: MODEL_A, next: MODEL_B });
    expect(all).toEqual([]);
    expect(h.written).toEqual([]);
    expect(h.validated).toEqual([MODEL_B]);
    expect(h.reassembled).toEqual([MODEL_B]);
    expect(h.opens).toEqual([]);
    expect(h.session.provider).toBe(MODEL_B.provider);
    expect(h.session.modelId).toBe(MODEL_B.model_id);
    expect(h.session.compactability()).toBe("empty");

    // The first run writes the re-assembled context's meta at the file's head, and the
    // re-assembled model's vision answer governs the Prompt fold from the start.
    await collect(
      h.session.run([userText("look"), imageUrlMessage("https://images.invalid/pic.png")], {
        approve: allowAll,
      }),
    );
    const file = await readTrace(h.trace.currentPath());
    expect(file[0]!.type).toBe("session_meta");
    expect(modelOf(file[0]!)).toEqual(MODEL_B);
    expect(llmB.calls[0]!.map((m) => (m.payload as { type: string }).type)).toEqual(["text"]);
    expect(textOf(llmB.calls[0]![0]!)).toContain(
      "[attached image: https://images.invalid/pic.png]",
    );
  });

  it("the same model completes with no events", async () => {
    const llmA = new ScriptedLLM([{ messages: [assistantText("answer one"), usage(50, 50)] }], "A");
    const h = harness(traces, { llmA, llms: {} });
    sessions.push(h.session);
    await collect(h.session.run([userText("task one")], { approve: allowAll }));

    const { all, result } = await collectWithReturn(switchTo(h.session, MODEL_A));

    expect(result).toEqual({ status: "completed", previous: MODEL_A, next: MODEL_A });
    expect(all).toEqual([]);
    expect(llmA.calls).toHaveLength(1);
    expect(h.session.compactability()).toBe("ok");
  });

  it("a target that fails validation is refused before anything is produced", async () => {
    const llmA = new ScriptedLLM([{ messages: [assistantText("answer one"), usage(50, 50)] }], "A");
    const h = harness(traces, { llmA, llms: {} });
    sessions.push(h.session);
    await collect(h.session.run([userText("task one")], { approve: allowAll }));
    const writtenBefore = h.written.length;

    await expect(
      collect(switchTo(h.session, { provider: "custom", model_id: "unknown" })),
    ).rejects.toThrow(/is not in the Project config/);

    expect(llmA.calls).toHaveLength(1);
    expect(h.written).toHaveLength(writtenBefore);
    expect(h.session.modelId).toBe(MODEL_A.model_id);
  });

  it("a compaction that fails keeps the old model: the end is a plain manual end, no session_meta follows, nothing rotates, and the next run stays put", async () => {
    const llmA = new ScriptedLLM(
      [
        { messages: [assistantText("answer one"), usage(50, 50)] },
        { messages: [], outcome: { status: "fatal", errorCode: "auth", errorMessage: "nope" } },
        { messages: [assistantText("answer two"), usage(60, 110)] },
      ],
      "A",
    );
    const llmB = new ScriptedLLM([], "B");
    const h = harness(traces, { llmA, llms: { [MODEL_B.model_id]: [llmB] } });
    sessions.push(h.session);
    const oldPath = h.trace.currentPath();
    await collect(h.session.run([userText("task one")], { approve: allowAll }));

    const { all, result } = await collectWithReturn(switchTo(h.session, MODEL_B));

    expect(result).toEqual({ status: "fatal", previous: MODEL_A, next: MODEL_B });
    expect(compactionEvents(all)[1]).toEqual({
      type: "compaction_end",
      reason: "manual",
      mode: "summarize",
      status: "fatal",
      attempt: 1,
      error_code: "auth",
      error_message: "nope",
    });
    expect(hasMeta(all)).toBe(false);
    expect(h.opens).toEqual([]);
    expect(h.session.modelId).toBe(MODEL_A.model_id);
    expect(h.session.compactability()).toBe("ok");
    // A resume of the file reads an open context on A: the failed end closes nothing.
    expect(await h.files()).toEqual([`${SESSION_ID}_001.jsonl`]);
    const resumed = resumeTrace(await readTrace(oldPath));
    expect(resumed.contextClosed).toBe(false);
    expect(modelOf(resumed.meta!)).toEqual(MODEL_A);

    await collect(h.session.run([userText("task two")], { approve: allowAll }));
    expect(llmA.calls).toHaveLength(3);
    expect(llmB.calls).toHaveLength(0);
    expect(h.trace.currentPath()).toBe(oldPath);
  });

  it("an aborted compaction request keeps the old model too", async () => {
    const llmA = new ScriptedLLM(
      [
        { messages: [assistantText("answer one"), usage(50, 50)] },
        { messages: [], outcome: { status: "aborted" } },
      ],
      "A",
    );
    const h = harness(traces, { llmA, llms: { [MODEL_B.model_id]: [new ScriptedLLM([], "B")] } });
    sessions.push(h.session);
    await collect(h.session.run([userText("task one")], { approve: allowAll }));

    const { all, result } = await collectWithReturn(switchTo(h.session, MODEL_B));

    expect(result.status).toBe("aborted");
    expect(compactionEvents(all)[1]).toMatchObject({ reason: "manual", status: "aborted" });
    expect(hasMeta(all)).toBe(false);
    expect(h.session.modelId).toBe(MODEL_A.model_id);
    expect(h.opens).toEqual([]);
    expect(await h.files()).toEqual([`${SESSION_ID}_001.jsonl`]);
  });

  it("a summary the target's window cannot hold ends the switch fatal, naming both numbers, and the Session stays on its model", async () => {
    const longSummary = `[summary]${"x".repeat(12000)}[/summary]`;
    const llmA = new ScriptedLLM(
      [
        { messages: [assistantText("answer one"), usage(50, 50)] },
        { messages: [assistantText(longSummary), usage(3100, 3150)] },
      ],
      "A",
    );
    const llmB = new ScriptedLLM([], "B");
    const h = harness(traces, {
      llmA,
      llms: { [MODEL_B.model_id]: [llmB] },
      // The smallest window taken at face value: 4096 − prefix − 2048 headroom leaves ~2k.
      windows: { [MODEL_B.model_id]: 4096 },
    });
    sessions.push(h.session);
    await collect(h.session.run([userText("task one")], { approve: allowAll }));

    const { all, result } = await collectWithReturn(switchTo(h.session, MODEL_B));

    expect(result.status).toBe("fatal");
    const end = compactionEvents(all)[1] as CompactionEndPayload;
    expect(end).toMatchObject({ reason: "manual", status: "fatal", error_code: "unsupported" });
    expect(end.error_message).toMatch(/about 3000 tokens/);
    expect(end.error_message).toMatch(/4096 tokens/);
    expect(end.error_message).toMatch(/stays on its current model/);
    expect(hasMeta(all)).toBe(false);
    expect(h.opens).toEqual([]);
    expect(h.session.modelId).toBe(MODEL_A.model_id);
    expect(await h.files()).toEqual([`${SESSION_ID}_001.jsonl`]);
    // The compaction exchange is committed on the old object, like any failed-after-commit
    // compaction; the context is still compactable (and switchable to a roomier model).
    expect(h.session.compactability()).toBe("ok");
  });

  it("a target without a usable window is not guarded", async () => {
    const longSummary = `[summary]${"x".repeat(12000)}[/summary]`;
    const llmA = new ScriptedLLM(
      [
        { messages: [assistantText("answer one"), usage(50, 50)] },
        { messages: [assistantText(longSummary), usage(3100, 3150)] },
      ],
      "A",
    );
    const h = harness(traces, {
      llmA,
      llms: { [MODEL_B.model_id]: [new ScriptedLLM([], "B")] },
      windows: { [MODEL_B.model_id]: undefined },
    });
    sessions.push(h.session);
    await collect(h.session.run([userText("task one")], { approve: allowAll }));

    const { all, result } = await collectWithReturn(switchTo(h.session, MODEL_B));
    expect(result.status).toBe("completed");
    expectEndsWithMetaOn(all, MODEL_B);
    expect(h.session.modelId).toBe(MODEL_B.model_id);
  });

  it("the vision answer follows the model: a switch to a model without vision folds the next Prompt's images", async () => {
    const llmA = new ScriptedLLM(
      [
        { messages: [assistantText("answer one"), usage(50, 50)] },
        { messages: [assistantText(SUMMARY_REPLY), usage(60, 110)] },
      ],
      "A",
    );
    const llmB = new ScriptedLLM(
      [{ messages: [assistantText("answer two"), usage(20, 130)] }],
      "B",
    );
    const h = harness(traces, {
      llmA,
      llms: { [MODEL_B.model_id]: [llmB] },
      vision: { [MODEL_B.model_id]: false },
    });
    sessions.push(h.session);
    await collect(h.session.run([userText("task one")], { approve: allowAll }));
    await collect(switchTo(h.session, MODEL_B));

    await collect(
      h.session.run([userText("look"), imageUrlMessage("https://images.invalid/pic.png")], {
        approve: allowAll,
      }),
    );

    const types = llmB.calls[0]!.map((m) => (m.payload as { type: string }).type);
    expect(types).toEqual(["text", "text"]);
    expect(textOf(llmB.calls[0]![1]!)).toContain(
      "[attached image: https://images.invalid/pic.png]",
    );
  });

  it("a Session resumed after a restart builds its engine first, so the switch compacts the real conversation", async () => {
    // What agent.resumeSession derives from a Trace: real history, no engine yet.
    const resumedLLM = new ScriptedLLM(
      [{ messages: [assistantText(SUMMARY_REPLY), usage(90, 90)] }],
      "A",
    );
    const llmB = new ScriptedLLM([], "B");
    const h = harness(traces, {
      llmA: resumedLLM,
      llms: { [MODEL_B.model_id]: [llmB] },
      extras: {
        metaAlreadyWritten: true,
        initialEngineState: { sessionTurns: 3, lastRequestTotal: 80 },
      },
    });
    sessions.push(h.session);
    expect(h.session.compactability()).toBe("ok");

    const { all, result } = await collectWithReturn(switchTo(h.session, MODEL_B));

    expect(result.status).toBe("completed");
    expect(resumedLLM.calls).toHaveLength(1);
    expect(compactionEvents(all)[0]).toMatchObject({ reason: "manual", turns: 3 });
    expectEndsWithMetaOn(all, MODEL_B);
    expect(h.session.modelId).toBe(MODEL_B.model_id);
  });

  it("switching is refused when compaction is not configured and there is a context to close", async () => {
    const llmA = new ScriptedLLM([{ messages: [assistantText("answer one"), usage(50, 50)] }], "A");
    const written: OmniMessage[] = [];
    const session = new Session({
      meta: metaFor(MODEL_A),
      bootstrap: async () => ({ llm: llmA }),
      environment: fakeEnvironment,
      trace: { write: async (m) => void written.push(m) },
      modelSwitch: {
        validate: async () => ({ contextWindow: undefined }),
        reassembleInitialContext: async () => ({}),
      },
      imagesDir: join(traces, "scratch"),
      modelHasVision: true,
    });
    sessions.push(session);
    await collect(session.run([userText("task one")], { approve: allowAll }));

    const refusal = await collect(switchTo(session, MODEL_B)).catch((e: unknown) => e);
    expect(refusal).toBeInstanceOf(ModelSwitchRefusedError);
    expect(refusal).toMatchObject({
      reason: "compaction_not_configured",
      message: expect.stringMatching(/Context compaction is not configured/) as unknown,
    });
    expect(session.modelId).toBe(MODEL_A.model_id);
  });

  it("switching is unavailable without the composition layer's support", async () => {
    const session = new Session({
      meta: metaFor(MODEL_A),
      bootstrap: async () => ({ llm: new ScriptedLLM([], "A") }),
      environment: fakeEnvironment,
      imagesDir: join(traces, "scratch"),
      modelHasVision: true,
    });
    sessions.push(session);
    const refusal = await collect(switchTo(session, MODEL_B)).catch((e: unknown) => e);
    expect(refusal).toBeInstanceOf(ModelSwitchRefusedError);
    expect(refusal).toMatchObject({
      reason: "model_unavailable",
      message: expect.stringMatching(/Switching the model is not available/) as unknown,
    });
  });
});
