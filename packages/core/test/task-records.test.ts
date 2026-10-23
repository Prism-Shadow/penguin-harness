/**
 * Task records: the `task_begin` / `task_end` pair a Session writes around each Task, to the
 * Trace and to its output stream.
 *
 * - Given a Session's first message, the Trace holds session_meta, task_begin, the input, the
 *   Task's records and then task_end; the stream carries the same records in the same order,
 *   minus the session_meta (written, not streamed, for a first context) and the input (which a
 *   host echoes).
 * - Given a stop hook that continues once, the run writes two pairs: the hook's record inside the
 *   first, and the continued input right after the second task_begin, on the stream and on disk.
 * - Given a Task whose final request triggers a completed compaction, its task_end and the next
 *   Task's task_begin land in the old file behind compaction_end, and the next Task's input opens
 *   the new file.
 * - Given a process that dies right after that next task_begin, resuming the old file still
 *   yields the pending `[context_summary]` (a Task record must not hide the closure).
 * - Given a manual compaction, or a model switch, no Task record is streamed or written.
 * - Given a Task the user stops mid-request, or while the MCP servers connect, the Task still ends
 *   with task_end.
 * - Given a Task whose bootstrap throws, the error reaches the caller and the task_begin stays
 *   unclosed.
 * - Given a Trace sink that fails every write, the Task records still reach the stream.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assistantText,
  mcpConnectBegin,
  sessionMeta,
  tokenUsage,
  toolListReady,
  userText,
} from "../src/omnimessage/index.js";
import type { OmniMessage, SessionMetaPayload } from "../src/omnimessage/index.js";
import type {
  ApproveFn,
  EnvironmentInterface,
  GenerativeModelParameters,
  LLMInterface,
  LLMOutcome,
} from "../src/interfaces/index.js";
import type { CompactionSettings, TraceSink } from "../src/engine/context-engine.js";
import { Session } from "../src/session.js";
import type { SessionConfig } from "../src/session.js";
import type { StopHook } from "../src/hooks/stop-hook.js";
import { Writer, readTrace, resumeTrace } from "../src/trace/index.js";

interface ScriptedResponse {
  messages: OmniMessage[];
  outcome?: LLMOutcome;
}

/** The one fake at the LLM boundary: answers each request from a script. */
class ScriptedLLM implements LLMInterface {
  constructor(private readonly responses: ScriptedResponse[]) {}

  async *streamGenerate(_: GenerativeModelParameters): AsyncGenerator<OmniMessage, LLMOutcome> {
    const next = this.responses.shift();
    if (!next) return { status: "retryable", errorMessage: "no scripted response" };
    for (const msg of next.messages) yield msg;
    return next.outcome ?? { status: "completed" };
  }
}

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

const SUMMARY_REPLY = "[summary]the distilled summary[/summary]";
const SUMMARY_TEXT = "[context_summary]\nthe distilled summary\n[/context_summary]";

const metaFor = (modelId: string): SessionMetaPayload => ({
  session_id: "sess_tasks",
  provider: "custom",
  model_id: modelId,
  model_context_window: 200000,
  system_prompt: "sp",
  agent_state: "/tmp/state",
  workspace: "/tmp/ws",
  source: "user",
});

/** Compacts once a request's context reaches 100 tokens. */
const compactAt100: CompactionSettings = {
  maxContextLength: 100,
  maxSessionTurns: -1,
  mode: "summarize",
  prompt: "COMPACT NOW",
};

/** Each record's kind: its payload type, or `session_meta`. */
const kinds = (msgs: OmniMessage[]): (string | undefined)[] =>
  msgs.map((m) =>
    m.type === "session_meta" ? "session_meta" : (m.payload as { type?: string }).type,
  );

const isTaskKind = (k: string | undefined): boolean => k === "task_begin" || k === "task_end";

/** The landmarks of a run: Task records, hook decisions and user texts, in order. */
const landmarks = (msgs: OmniMessage[]): string[] =>
  msgs.flatMap((m) => {
    const p = m.payload as { type?: string; role?: string; text?: string; decision?: string };
    if (isTaskKind(p.type)) return [p.type!];
    if (p.type === "hook") return [`hook:${p.decision}`];
    if (m.type === "model_msg" && p.type === "text" && p.role === "user") return [`user:${p.text}`];
    return [];
  });

async function collect<R>(gen: AsyncGenerator<OmniMessage, R>): Promise<OmniMessage[]> {
  const all: OmniMessage[] = [];
  for (;;) {
    const res = await gen.next();
    if (res.done) return all;
    all.push(res.value);
  }
}

describe("Task records", () => {
  let traces: string;
  const sessions: Session[] = [];

  beforeEach(async () => {
    traces = await mkdtemp(join(tmpdir(), "penguin-task-records-"));
  });

  afterEach(async () => {
    for (const s of sessions.splice(0)) s.dispose();
    await rm(traces, { recursive: true, force: true });
  });

  /**
   * A Session on a real Trace writer. `llms[0]` answers the first context; each context a
   * compaction or a switch opens takes the next one. Every write the Session hands its sink is
   * recorded in `written`, in order, whichever file it went to.
   */
  function makeSession(args: {
    llms?: LLMInterface[];
    stopHooks?: StopHook[];
    compaction?: CompactionSettings;
    bootstrap?: SessionConfig["bootstrap"];
    sink?: TraceSink;
  }): { session: Session; trace: Writer; written: OmniMessage[] } {
    const llms = [...(args.llms ?? [])];
    const trace = new Writer({ tracesDir: traces, sessionId: "sess_tasks" });
    const written: OmniMessage[] = [];
    const sink: TraceSink = args.sink ?? {
      write: async (msg) => {
        written.push(msg);
        await trace.write(msg);
      },
      rotate: () => trace.rotate(),
      currentPath: () => trace.currentPath(),
    };
    const session = new Session({
      meta: metaFor("model-a"),
      bootstrap:
        args.bootstrap ??
        (async ({ emit }) => {
          emit(toolListReady([]));
          return { llm: llms.shift()! };
        }),
      environment: fakeEnvironment,
      trace: sink,
      ...(args.compaction ? { compaction: args.compaction } : {}),
      openNextContext: ({ modelRef }) => ({
        llm: llms.shift()!,
        sessionMeta: sessionMeta(metaFor(modelRef?.model_id ?? "model-a")),
      }),
      modelSwitch: {
        async validate() {},
        async reassembleInitialContext(ref) {
          return { sessionMeta: sessionMeta(metaFor(ref.model_id)) };
        },
      },
      ...(args.stopHooks ? { hooks: { stop: args.stopHooks } } : {}),
      imagesDir: join(traces, "scratch"),
      modelHasVision: true,
    });
    sessions.push(session);
    return { session, trace, written };
  }

  it("a Session's first message: task_begin follows session_meta and precedes the input, task_end closes it, and the stream carries the same records in the same order", async () => {
    const llm = new ScriptedLLM([{ messages: [assistantText("hi"), usage(10, 10)] }]);
    const { session, trace } = makeSession({ llms: [llm] });

    const stream = await collect(session.run([userText("hello")], { approve: allowAll }));

    const disk = await readTrace(trace.currentPath());
    expect(kinds(disk).slice(0, 2)).toEqual(["session_meta", "task_begin"]);
    expect(landmarks(disk)).toEqual(["task_begin", "user:hello", "task_end"]);
    expect(kinds(disk).at(-1)).toBe("task_end");
    // The stream is the Trace minus the file head and the input (the host echoes the input).
    const expected = disk.filter((m) => m.type !== "session_meta" && m !== disk[2]);
    expect(kinds(stream)).toEqual(kinds(expected));
  });

  it("a stop hook's continue gets a pair of its own: the hook record closes the first Task, the continued input opens the second", async () => {
    const llm = new ScriptedLLM([
      { messages: [assistantText("first"), usage(10, 10)] },
      { messages: [assistantText("second"), usage(10, 20)] },
    ]);
    let asked = 0;
    const hook: StopHook = {
      name: "goal",
      run: async () =>
        ++asked === 1 ? { decision: "continue", input: "again" } : { decision: "stop" },
    };
    const { session, trace } = makeSession({ llms: [llm], stopHooks: [hook] });

    const stream = await collect(session.run([userText("hello")], { approve: allowAll }));

    expect(landmarks(stream)).toEqual([
      "task_begin",
      "hook:continue",
      "task_end",
      "task_begin",
      "user:again",
      "hook:stop",
      "task_end",
    ]);
    expect(landmarks(await readTrace(trace.currentPath()))).toEqual([
      "task_begin",
      "user:hello",
      "hook:continue",
      "task_end",
      "task_begin",
      "user:again",
      "hook:stop",
      "task_end",
    ]);
  });

  it("a Task ending on a completed compaction leaves its task_end and the next task_begin behind compaction_end in the old file; the next input opens the new one", async () => {
    const llm1 = new ScriptedLLM([
      // The final reply reaches the threshold: the compaction runs at the Task's end.
      { messages: [assistantText("answer one"), usage(150, 150)] },
      { messages: [assistantText(SUMMARY_REPLY), usage(160, 310)] },
    ]);
    const llm2 = new ScriptedLLM([{ messages: [assistantText("answer two"), usage(20, 330)] }]);
    const { session, trace } = makeSession({ llms: [llm1, llm2], compaction: compactAt100 });

    await collect(session.run([userText("task one")], { approve: allowAll }));
    const oldPath = trace.currentPath();
    await collect(session.run([userText("task two")], { approve: allowAll }));

    expect(trace.currentPath()).not.toBe(oldPath);
    const oldFile = await readTrace(oldPath);
    expect(kinds(oldFile).slice(-3)).toEqual(["compaction_end", "task_end", "task_begin"]);
    const newFile = await readTrace(trace.currentPath());
    expect(newFile[0]!.type).toBe("session_meta");
    expect(landmarks(newFile)).toEqual([`user:${SUMMARY_TEXT}`, "user:task two", "task_end"]);
  });

  it("a restart right after the next task_begin still resumes the closed context with its summary pending", async () => {
    const llm1 = new ScriptedLLM([
      { messages: [assistantText("answer one"), usage(150, 150)] },
      { messages: [assistantText(SUMMARY_REPLY), usage(160, 310)] },
    ]);
    const { session, trace } = makeSession({ llms: [llm1], compaction: compactAt100 });
    await collect(session.run([userText("task one")], { approve: allowAll }));
    const oldPath = trace.currentPath();

    // The process dies once the next Task's task_begin is on disk, before its input.
    const next = session.run([userText("task two")], { approve: allowAll });
    expect(kinds([(await next.next()).value as OmniMessage])).toEqual(["task_begin"]);
    await next.return(null);

    const resumed = resumeTrace(await readTrace(oldPath));
    expect(resumed.contextClosed).toBe(true);
    expect((resumed.pendingSummary?.payload as { text?: string }).text).toBe(SUMMARY_TEXT);
    expect(resumed.history).toEqual([]);
  });

  it("a manual compaction writes and streams no Task record", async () => {
    const llm1 = new ScriptedLLM([
      { messages: [assistantText("answer one"), usage(50, 50)] },
      { messages: [assistantText(SUMMARY_REPLY), usage(60, 110)] },
    ]);
    const { session, written } = makeSession({
      llms: [llm1, new ScriptedLLM([])],
      compaction: { ...compactAt100, maxContextLength: 1000 },
    });
    await collect(session.run([userText("task one")], { approve: allowAll }));
    const before = written.length;

    const stream = await collect(session.compact());

    expect(kinds(stream)).toContain("compaction_end");
    expect(kinds(stream).some(isTaskKind)).toBe(false);
    expect(kinds(written.slice(before)).some(isTaskKind)).toBe(false);
  });

  it("a model switch writes and streams no Task record", async () => {
    const llm1 = new ScriptedLLM([
      { messages: [assistantText("answer one"), usage(50, 50)] },
      { messages: [assistantText(SUMMARY_REPLY), usage(60, 110)] },
    ]);
    const { session, written } = makeSession({
      llms: [llm1, new ScriptedLLM([])],
      compaction: { ...compactAt100, maxContextLength: 1000 },
    });
    await collect(session.run([userText("task one")], { approve: allowAll }));
    const before = written.length;

    const stream = await collect(session.switchModel({ provider: "custom", modelId: "model-b" }));

    expect(stream.at(-1)?.type).toBe("session_meta");
    expect(kinds(stream).some(isTaskKind)).toBe(false);
    expect(kinds(written.slice(before)).some(isTaskKind)).toBe(false);
  });

  it("a Task the user stops mid-request still ends with task_end, after the abort", async () => {
    const llm = new ScriptedLLM([
      { messages: [assistantText("half an answer")], outcome: { status: "aborted" } },
    ]);
    const { session, trace } = makeSession({ llms: [llm] });

    const stream = await collect(session.run([userText("hello")], { approve: allowAll }));

    expect(kinds(stream).slice(-2)).toEqual(["abort", "task_end"]);
    expect(kinds(await readTrace(trace.currentPath())).slice(-2)).toEqual(["abort", "task_end"]);
  });

  it("a Task stopped while the MCP servers connect still ends with task_end, after its input and the aborted connect", async () => {
    const ac = new AbortController();
    const { session, trace } = makeSession({
      bootstrap: async ({ emit }) => {
        emit(mcpConnectBegin(["slow"]));
        return new Promise(() => {});
      },
    });

    const stream: OmniMessage[] = [];
    for await (const msg of session.run([userText("hello")], { signal: ac.signal })) {
      stream.push(msg);
      if ((msg.payload as { type?: string }).type === "mcp_connect_begin") ac.abort();
    }

    expect(kinds(stream)).toEqual([
      "task_begin",
      "mcp_connect_begin",
      "mcp_connect_end",
      "abort",
      "task_end",
    ]);
    expect(kinds(await readTrace(trace.currentPath()))).toEqual([
      "session_meta",
      "task_begin",
      "text",
      "mcp_connect_begin",
      "mcp_connect_end",
      "abort",
      "task_end",
    ]);
  });

  it("a Task whose bootstrap throws reaches the caller with its task_begin left unclosed", async () => {
    const { session, written } = makeSession({
      bootstrap: async () => {
        throw new Error("the credential is gone");
      },
    });

    await expect(collect(session.run([userText("hello")]))).rejects.toThrow(
      "the credential is gone",
    );

    expect(kinds(written)).toEqual(["session_meta", "task_begin"]);
  });

  it("a Trace sink that fails every write still lets the Task records reach the stream", async () => {
    const llm = new ScriptedLLM([{ messages: [assistantText("hi"), usage(10, 10)] }]);
    const { session } = makeSession({
      llms: [llm],
      sink: {
        write: async () => {
          throw new Error("disk full");
        },
      },
    });

    const stream = await collect(session.run([userText("hello")], { approve: allowAll }));

    expect(kinds(stream)[0]).toBe("task_begin");
    expect(kinds(stream).at(-1)).toBe("task_end");
    expect(stream.some((m) => (m.payload as { type?: string }).type === "text")).toBe(true);
  });
});
