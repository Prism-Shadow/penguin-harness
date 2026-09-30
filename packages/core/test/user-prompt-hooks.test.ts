/**
 * The user_prompt hook point: consulted every time the user submits a Prompt.
 *
 * - What the hooks answer follows the Prompt as harness-stamped user texts — on the stream,
 *   in the Trace and in the Task's first request — and a hook that fails leaves a `hook`
 *   event in the same place instead.
 * - Only a Prompt carrying text of the user's own is put to them: an input the server, the
 *   harness or a parent agent wrote is not one, and neither is a stop hook's continuation.
 * - A hook marked `trigger: "host"` stays out of that consult and is reached by name.
 * - The hooks are those of the context that is running: a context a compaction opens brings
 *   its own set, and the Session consults that one from then on.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rmEventually } from "./rm-eventually.js";
import {
  Session,
  assistantText,
  isHookContinue,
  isHookInput,
  runUserPromptHooks,
  tokenUsage,
  userText,
} from "../src/index.js";
import type {
  CompactionSettings,
  EnvironmentInterface,
  HookPayload,
  LLMInterface,
  LLMOutcome,
  OmniMessage,
  SessionHooks,
  SessionMetaPayload,
  SessionOpenedContext,
  StopHook,
  TextPayload,
  TraceSink,
  UserPromptHook,
  UserPromptHookInput,
} from "../src/index.js";

const fakeEnvironment: EnvironmentInterface = {
  listTools: async () => [],
  // eslint-disable-next-line require-yield
  executeTool: async function* () {
    throw new Error("not used");
  },
  toolPermission: () => undefined,
};

/** Builds a token_usage: request.total is the context-usage figure, session.total the cumulative one. */
const usage = (requestTotal: number, sessionTotal: number): OmniMessage =>
  tokenUsage(
    { cache_read: 0, cache_write: 0, output: 0, total: sessionTotal },
    { cache_read: 0, cache_write: 0, output: 0, total: requestTotal },
  );

/** Answers each request from a script, recording the input it was sent. */
class ScriptedLLM implements LLMInterface {
  calls: OmniMessage[][] = [];
  constructor(private readonly responses: OmniMessage[][]) {}

  async *streamGenerate({
    newMessages,
  }: {
    newMessages: OmniMessage[];
  }): AsyncGenerator<OmniMessage, LLMOutcome> {
    this.calls.push(newMessages);
    const next = this.responses.shift();
    if (!next) return { status: "retryable", errorMessage: "no scripted response" };
    for (const msg of next) yield msg;
    return { status: "completed" };
  }
}

/** One short final reply per request, as many as asked for. */
const replies = (n: number): OmniMessage[][] =>
  Array.from({ length: n }, (_, i) => [assistantText(`answer ${i + 1}`), usage(20, 20 * (i + 1))]);

async function collect(gen: AsyncGenerator<OmniMessage, unknown>): Promise<OmniMessage[]> {
  const all: OmniMessage[] = [];
  for (;;) {
    const res = await gen.next();
    if (res.done) return all;
    all.push(res.value);
  }
}

/** A record as the assertions read it: a text's `sender:text`, anything else its payload type. */
function shape(msg: OmniMessage): string {
  const p = msg.payload as { type?: string; role?: string; sender?: string; text?: string };
  if (msg.type === "session_meta") return "session_meta";
  if (p.type === "text")
    return `${p.role === "user" ? (p.sender ?? "user") : "assistant"}:${p.text}`;
  if (p.type === "hook") {
    const h = msg.payload as HookPayload;
    return `hook:${h.hook}:${h.name}`;
  }
  return p.type ?? msg.type;
}

const textsOf = (msgs: OmniMessage[]): string[] => msgs.map((m) => (m.payload as TextPayload).text);

/** A hook answering `context`, counting its runs and keeping what it was told. */
function answering(
  name: string,
  context: string,
  over: Partial<UserPromptHook> = {},
): UserPromptHook & { seen: UserPromptHookInput[] } {
  const seen: UserPromptHookInput[] = [];
  return {
    name,
    seen,
    run: async (input) => {
      seen.push(input);
      return { context };
    },
    ...over,
  };
}

describe("runUserPromptHooks", () => {
  const input: UserPromptHookInput = { sessionId: "s1", scratchpadDir: "/scratch", prompt: "hi" };

  it("turns each context into a harness-stamped user text, in hook order, and drops the empty ones", async () => {
    const { records } = await runUserPromptHooks(
      [
        answering("first", "one"),
        { name: "void", run: async () => undefined },
        answering("blank", "  \n"),
        { name: "empty", run: async () => ({}) },
        answering("last", "two"),
      ],
      input,
    );
    expect(records.map(shape)).toEqual(["harness:one", "harness:two"]);
    expect(records.every(isHookInput)).toBe(true);
  });

  it("records a hook that throws as a hook event and carries on with the rest", async () => {
    const { records } = await runUserPromptHooks(
      [
        { name: "broken", run: async () => Promise.reject(new Error("boom")) },
        answering("after", "still here"),
      ],
      input,
    );
    expect(records.map(shape)).toEqual(["hook:user_prompt:broken", "harness:still here"]);
    expect(records[0]!.payload).toEqual({
      type: "hook",
      hook: "user_prompt",
      name: "broken",
      reason: "hook failed: boom",
    });
  });

  it("ends the pass once the signal is aborted, without blaming the hook that was cut off", async () => {
    const ac = new AbortController();
    const later = answering("later", "never");
    const { records } = await runUserPromptHooks(
      [
        {
          name: "cut-off",
          run: async () => {
            ac.abort();
            throw new Error("aborted");
          },
        },
        later,
      ],
      { ...input, signal: ac.signal },
    );
    expect(records).toEqual([]);
    expect(later.seen).toHaveLength(0);
  });
});

describe("Session user-prompt hooks", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-user-prompt-"));
  });
  afterEach(async () => {
    await rmEventually(dir);
  });

  const meta = (): SessionMetaPayload => ({
    session_id: "session-1",
    provider: "custom",
    model_id: "m1",
    model_context_window: 1000,
    system_prompt: "sp",
    agent_state: dir,
    workspace: dir,
  });

  /** A Trace sink that keeps what it is handed, in order. */
  function recordingTrace(): TraceSink & { written: OmniMessage[] } {
    const written: OmniMessage[] = [];
    return {
      written,
      write: async (msg) => {
        written.push(msg);
      },
      currentPath: () => path.join(dir, "trace_001.jsonl"),
    };
  }

  function makeSession(
    hooks: SessionHooks,
    llm: LLMInterface,
    extra: {
      trace?: TraceSink;
      compaction?: CompactionSettings;
      openNextContext?: () => Promise<SessionOpenedContext>;
    } = {},
  ): Session {
    return new Session({
      meta: meta(),
      bootstrap: async () => ({ llm }),
      environment: fakeEnvironment,
      imagesDir: path.join(dir, "scratchpad", "session-1"),
      modelHasVision: true,
      hooks,
      ...(extra.trace ? { trace: extra.trace } : {}),
      ...(extra.compaction ? { compaction: extra.compaction } : {}),
      ...(extra.openNextContext ? { openNextContext: extra.openNextContext } : {}),
    });
  }

  it("sends what the hooks answer right behind the Prompt: on the stream, in the Trace and in the request", async () => {
    const first = answering("a-first", "ctx A");
    const host = answering("d-host", "never", { trigger: "host" });
    const last = answering("e-last", "ctx E");
    const llm = new ScriptedLLM(replies(1));
    const trace = recordingTrace();
    const session = makeSession(
      {
        userPrompt: [
          first,
          { name: "b-broken", run: async () => Promise.reject(new Error("boom")) },
          answering("c-blank", " "),
          host,
          last,
        ],
      },
      llm,
      { trace },
    );
    const prompt = "[use_skills]\nskills: clock\n[/use_skills]\n\nwhat time is it";

    const out = await collect(session.run([userText(prompt)]));

    // The Prompt itself is never yielded; what the hooks made of it is, ahead of the reply.
    expect(out.map(shape).slice(0, 3)).toEqual([
      "harness:ctx A",
      "hook:user_prompt:b-broken",
      "harness:ctx E",
    ]);
    expect(trace.written.map(shape).slice(0, 5)).toEqual([
      "session_meta",
      `user:${prompt}`,
      "harness:ctx A",
      "hook:user_prompt:b-broken",
      "harness:ctx E",
    ]);
    // The model reads the contexts behind the Prompt, and never the failure.
    expect(textsOf(llm.calls[0]!)).toEqual([prompt, "ctx A", "ctx E"]);
    // A hook is told the user's own words, and where the Session keeps its record and state.
    expect(first.seen).toEqual([
      {
        sessionId: "session-1",
        tracePath: path.join(dir, "trace_001.jsonl"),
        scratchpadDir: path.join(dir, "scratchpad", "session-1"),
        prompt: "what time is it",
      },
    ]);
    expect(host.seen).toHaveLength(0);
  });

  it("reaches a host-triggered hook by name only, and no other hook that way", async () => {
    const host = answering("goal", "round one", { trigger: "host" });
    const session = makeSession(
      { userPrompt: [answering("clock", "tick"), host] },
      new ScriptedLLM([]),
    );
    expect(await session.runUserPromptHook("goal", "ship it", { budget: 500 })).toEqual({
      context: "round one",
    });
    expect(host.seen[0]).toMatchObject({ prompt: "ship it", extras: { budget: 500 } });
    expect(await session.runUserPromptHook("clock", "x")).toBeNull();
    expect(await session.runUserPromptHook("not-installed", "x")).toBeNull();
  });

  it("does not consult them for an input the user did not write", async () => {
    const hook = answering("clock", "tick");
    const llm = new ScriptedLLM(replies(3));
    const session = makeSession({ userPrompt: [hook] }, llm);

    await collect(
      session.run([userText("[scheduled_task]\nname: x\n[/scheduled_task]\ngo", "server")]),
    );
    await collect(session.run([userText("carry on", "harness")]));
    await collect(session.run([userText("do this", "parent_agent")]));

    expect(hook.seen).toHaveLength(0);
    expect(llm.calls.map(textsOf).map((texts) => texts.length)).toEqual([1, 1, 1]);
  });

  it("consults them for the Prompt a host flow expanded, behind the flow's own message", async () => {
    const hook = answering("clock", "tick");
    const llm = new ScriptedLLM(replies(1));
    const session = makeSession({ userPrompt: [hook] }, llm);

    const out = await collect(
      session.run([userText("raise coverage"), userText("goal protocol", "harness")]),
    );

    expect(hook.seen.map((i) => i.prompt)).toEqual(["raise coverage"]);
    expect(textsOf(llm.calls[0]!)).toEqual(["raise coverage", "goal protocol", "tick"]);
    // Nothing announced it, so a round counter does not take it for a round.
    expect(out.filter(isHookInput).map(shape)).toEqual(["harness:tick"]);
    expect(out.some(isHookContinue)).toBe(false);
  });

  it("consults them once per run: a Task a stop hook continues into starts from the hook's input", async () => {
    const hook = answering("clock", "tick");
    let asked = 0;
    const once: StopHook = {
      name: "once",
      run: async () => (asked++ === 0 ? { decision: "continue", input: "again" } : undefined),
    };
    const llm = new ScriptedLLM(replies(2));
    const session = makeSession({ userPrompt: [hook], stop: [once] }, llm);

    const out = await collect(session.run([userText("start")]));

    expect(hook.seen).toHaveLength(1);
    expect(llm.calls.map(textsOf)).toEqual([["start", "tick"], ["again"]]);
    // The continuation is the one input a `continue` event announces.
    const announced = out.findIndex(isHookContinue);
    expect(shape(out[announced + 1]!)).toBe("harness:again");
  });

  describe("across a rotation", () => {
    const settings: CompactionSettings = {
      maxContextLength: 100,
      maxSessionTurns: -1,
      mode: "summarize",
      prompt: "COMPACT NOW",
    };
    /** Task one fills the context, so its end compacts and opens the next one. */
    const filling = (): ScriptedLLM =>
      new ScriptedLLM([
        [assistantText("answer one"), usage(150, 150)],
        [assistantText("[summary]so far[/summary]"), usage(160, 310)],
      ]);

    it("takes the hooks of the context that opened, whole", async () => {
      const before = answering("before", "old context");
      const after = answering("after", "new context");
      const stops: string[] = [];
      const stop = (name: string): StopHook => ({
        name,
        run: async () => {
          stops.push(name);
        },
      });
      const next = new ScriptedLLM(replies(1));
      const session = makeSession({ userPrompt: [before], stop: [stop("old-stop")] }, filling(), {
        compaction: settings,
        openNextContext: async () => ({ llm: next, hooks: { userPrompt: [after] } }),
      });

      await collect(session.run([userText("task one")]));
      // Task one ran under the first context's hooks; by its end the next context is the one
      // that is running, and it lists no stop hook.
      expect(before.seen).toHaveLength(1);
      expect(stops).toEqual([]);

      await collect(session.run([userText("task two")]));
      expect(before.seen).toHaveLength(1);
      expect(after.seen.map((i) => i.prompt)).toEqual(["task two"]);
      expect(textsOf(next.calls[0]!).slice(-2)).toEqual(["task two", "new context"]);
    });

    it("keeps its hooks when the opened context brings none of its own", async () => {
      const kept = answering("kept", "still here");
      const next = new ScriptedLLM(replies(1));
      const session = makeSession({ userPrompt: [kept] }, filling(), {
        compaction: settings,
        openNextContext: async () => ({ llm: next }),
      });

      await collect(session.run([userText("task one")]));
      await collect(session.run([userText("task two")]));

      expect(kept.seen.map((i) => i.prompt)).toEqual(["task one", "task two"]);
    });
  });
});
