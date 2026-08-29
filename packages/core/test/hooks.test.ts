import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  Session,
  assistantText,
  buildSkillsMessage,
  condenseTrace,
  createSkillSummaryHook,
  hookEvent,
  invokedSkills,
  runStopHooks,
  summaryWindow,
  tokenUsage,
  toolCall,
  toolCallOutput,
  userSteeringText,
  userText,
  withOrigin,
} from "../src/index.js";
import type {
  EnvironmentInterface,
  HookPayload,
  LLMInterface,
  LLMOutcome,
  OmniMessage,
  SessionMetaPayload,
  StopHook,
  StopHookInput,
  SubagentHandle,
  SubagentRunner,
  TokenCounts,
  TraceSink,
} from "../src/index.js";

function usage(total: number, cacheRead = 0): TokenCounts {
  return { cache_read: cacheRead, cache_write: 0, output: 0, total };
}

function stopInput(over: Partial<StopHookInput> = {}): StopHookInput {
  return { sessionId: "s1", stopReason: "completed", tasks: 1, tokensUsed: 0, turns: 1, ...over };
}

describe("runStopHooks", () => {
  it("records every answer, honors the first continue, and keeps a throwing hook from taking the run down", async () => {
    const hooks: StopHook[] = [
      { name: "quiet", run: async () => undefined },
      { name: "broken", run: async () => Promise.reject(new Error("boom")) },
      { name: "first", run: async () => ({ decision: "continue", input: "again", reason: "one" }) },
      {
        name: "second",
        run: async () => ({ decision: "continue", input: "later", output: { n: 2 } }),
      },
      { name: "note", run: async () => ({ reason: "just a record" }) },
    ];
    const { events, next } = await runStopHooks(hooks, stopInput());
    expect(next).toBe("again");
    // No event for a void answer; the injected input never rides an event.
    expect(events.map((e) => e.payload.name)).toEqual(["broken", "first", "second", "note"]);
    expect(events[0]!.payload).toMatchObject({ hook: "stop", reason: "hook failed: boom" });
    expect(events[0]!.payload.decision).toBeUndefined();
    expect(events[1]!.payload).toEqual({
      type: "hook",
      hook: "stop",
      name: "first",
      decision: "continue",
      reason: "one",
    });
    expect(events[2]!.payload.output).toEqual({ n: 2 });
    expect(JSON.stringify(events)).not.toContain("again");
  });
});

describe("Session stop hooks", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-hooks-"));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const fakeEnvironment: EnvironmentInterface = {
    listTools: async () => [],
    // eslint-disable-next-line require-yield
    executeTool: async function* () {
      throw new Error("not used");
    },
    toolPermission: () => undefined,
  };

  /** Echoes each Task's input as one final text, with usage. */
  function echoLLM(): LLMInterface & { inputs: string[] } {
    const inputs: string[] = [];
    return {
      inputs,
      async *streamGenerate({ newMessages }) {
        const last = newMessages[newMessages.length - 1]?.payload as { text?: string } | undefined;
        inputs.push(last?.text ?? "");
        yield assistantText(`echo: ${last?.text ?? ""}`);
        yield tokenUsage(usage(100), usage(100, 30));
        return { status: "completed" } satisfies LLMOutcome;
      },
    };
  }

  function makeSession(hooks: StopHook[], llm: LLMInterface, trace?: TraceSink): Session {
    const meta: SessionMetaPayload = {
      session_id: "session-1",
      provider: "custom",
      model_id: "m1",
      model_context_window: 1000,
      system_prompt: "sp",
      agent_state: dir,
      workspace: dir,
    };
    return new Session({
      meta,
      bootstrap: async () => ({ tools: [], llm, mcp: [] }),
      mcpServers: [],
      environment: fakeEnvironment,
      imagesDir: path.join(dir, "scratchpad", "session-1"),
      modelHasVision: true,
      hooks: { stop: hooks },
      ...(trace ? { trace } : {}),
    });
  }

  it("a continue drives a second Task in the same run, with its input yielded and the events recorded in the Trace", async () => {
    const seen: StopHookInput[] = [];
    const hook: StopHook = {
      name: "once",
      run: async (input) => {
        seen.push(input);
        return input.tasks === 1
          ? { decision: "continue", input: "again", output: { k: true } }
          : { decision: "stop" };
      },
    };
    const writes: OmniMessage[] = [];
    const trace: TraceSink = {
      write: async (m) => {
        writes.push(m);
      },
      currentPath: () => "/traces/session-1_001.jsonl",
    };
    const llm = echoLLM();
    const session = makeSession([hook], llm, trace);
    const stream: OmniMessage[] = [];
    for await (const msg of session.run([userText("hello")])) stream.push(msg);
    // Two Tasks ran: the second on the hook's input.
    expect(llm.inputs).toEqual(["hello", "again"]);
    // The hook saw the run's counters: uncached tokens (70 per request), one Task then two,
    // the Session's turn count, and the Trace path.
    expect(seen.map((i) => [i.tasks, i.tokensUsed, i.turns, i.stopReason, i.tracePath])).toEqual([
      [1, 70, 1, "completed", "/traces/session-1_001.jsonl"],
      [2, 140, 2, "completed", "/traces/session-1_001.jsonl"],
    ]);
    // The stream: the hook event, then the injected user input, then the second Task.
    const kinds = stream.map((m) =>
      m.type === "event_msg" && m.payload.type === "hook"
        ? `hook:${(m.payload as HookPayload).decision}`
        : m.type === "model_msg" && (m.payload as { role?: string }).role === "user"
          ? `user:${(m.payload as { text: string }).text}`
          : null,
    );
    expect(kinds.filter(Boolean)).toEqual(["hook:continue", "user:again", "hook:stop"]);
    // Both hook events reached the Trace.
    const hookWrites = writes.filter((m) => m.type === "event_msg" && m.payload.type === "hook");
    expect(hookWrites.map((m) => (m.payload as HookPayload).decision)).toEqual([
      "continue",
      "stop",
    ]);
  });

  it("never continues after the signal is aborted, even when a hook asks to", async () => {
    const controller = new AbortController();
    const hook: StopHook = {
      name: "eager",
      run: async () => {
        controller.abort();
        return { decision: "continue", input: "again" };
      },
    };
    const llm = echoLLM();
    const session = makeSession([hook], llm);
    const stream: OmniMessage[] = [];
    for await (const msg of session.run([userText("hello")], { signal: controller.signal })) {
      stream.push(msg);
    }
    expect(llm.inputs).toEqual(["hello"]);
    // The answer is still on record.
    expect(stream.some((m) => m.type === "event_msg" && m.payload.type === "hook")).toBe(true);
  });
});

describe("skill-summary hook", () => {
  const user = (text: string) => userText(text);
  const tu = () => tokenUsage(usage(100), usage(100));

  it("condenses main-session records into clipped lines, stripping marker blocks and dropping the oldest past the cap", () => {
    const records: OmniMessage[] = [
      user(buildSkillsMessage(["web-design"], "make the page pretty")),
      assistantText("I will look."),
      toolCall({
        name: "exec_command",
        arguments: JSON.stringify({ cmd: "ls" }),
        toolCallId: "c1",
      }),
      toolCallOutput({ output: "a.txt\nb.txt", toolCallId: "c1", stopReason: "completed" }),
      toolCallOutput({ output: "boom", toolCallId: "c2", stopReason: "fatal" }),
      user(userSteeringText("skip the tests")),
      withOrigin(assistantText("child talk"), "child"),
      assistantText("x".repeat(2000)),
    ];
    const text = condenseTrace(records);
    const lines = text.split("\n");
    expect(lines[0]).toBe("[user] make the page pretty");
    expect(lines[1]).toBe("[assistant] I will look.");
    expect(lines[2]).toBe('[tool_call exec_command] {"cmd":"ls"}');
    expect(lines[3]).toBe("[tool_output exec_command] a.txt b.txt");
    expect(lines[4]).toBe("[tool_output c2 · fatal] boom");
    expect(lines[5]).toBe("[user] skip the tests");
    expect(text).not.toContain("child talk");
    expect(lines[6]!.length).toBe("[assistant] ".length + 1200 + 1);
    // The cap keeps the newest lines.
    const capped = condenseTrace(records, 200);
    expect(capped.startsWith("[… ")).toBe(true);
    expect(capped).toContain("[assistant] xxx");
  });

  it("windows from the last summary event and lists the skills invoked in it", () => {
    const records: OmniMessage[] = [
      user(buildSkillsMessage(["old-skill"], "before")),
      hookEvent({ hook: "stop", name: "skill_summary", output: { turns: 20 } }),
      user(buildSkillsMessage(["web-design", "penguin-cli"], "after")),
      user(
        "[goal]\nround: 2\nx\n[/goal]\n\n[use_skills]\nskills: web-design\n[/use_skills]\n\nobjective",
      ),
      hookEvent({ hook: "stop", name: "goal", decision: "continue" }),
    ];
    const window = summaryWindow(records);
    expect(window).toHaveLength(3);
    expect(invokedSkills(window)).toEqual(["web-design", "penguin-cli"]);
    expect(summaryWindow(records.slice(2))).toHaveLength(3);
  });

  it("fires once a window holds min_turns completed turns, delegating the excerpt to a detached child", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-summary-"));
    const tracePath = path.join(dir, "s1_001.jsonl");
    const write = (records: OmniMessage[]) =>
      fs.appendFile(tracePath, records.map((r) => `${JSON.stringify(r)}\n`).join(""), "utf8");
    const prompts: string[] = [];
    let disposed = 0;
    const runner: SubagentRunner = {
      async spawn() {
        const handle: SubagentHandle = {
          sessionId: "child-1",
          // eslint-disable-next-line require-yield
          async *run(input) {
            prompts.push((input.messages[0]!.payload as { text: string }).text);
            return null;
          },
          dispose: () => {
            disposed += 1;
          },
        };
        return handle;
      },
    };
    const hook = createSkillSummaryHook({
      root: dir,
      projectId: "p",
      agentId: "a",
      sessionId: "s1",
      minTurns: 3,
      runner,
      listSkills: async () => ["web-design", "penguin-cli"],
    });
    const turn = (i: number) => [user(`ask ${i}`), assistantText(`answer ${i}`), tu()];
    await write([...turn(1), ...turn(2)]);
    // Below the session-turn gate: not even a read.
    expect(await hook.run(stopInput({ turns: 2, tracePath }))).toBeUndefined();
    await write(turn(3));
    const res = await hook.run(stopInput({ turns: 3, tracePath }));
    expect(res).toMatchObject({ output: { session_id: "child-1", turns: 3 } });
    expect(res!.decision).toBeUndefined();
    // Let the detached run settle.
    await new Promise((r) => setTimeout(r, 0));
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("Installed skills: web-design, penguin-cli");
    expect(prompts[0]).toContain("Skills invoked in this window: none");
    expect(prompts[0]).toContain("[user] ask 3");
    expect(prompts[0]).toContain(path.join("agent_state", "skills"));
    expect(disposed).toBe(1);
    // The Session records the event in the Trace; from there on the window restarts.
    await write([
      hookEvent({
        hook: "stop",
        name: "skill_summary",
        output: { session_id: "child-1", turns: 3 },
      }),
    ]);
    await write([...turn(4), ...turn(5)]);
    expect(await hook.run(stopInput({ turns: 5, tracePath }))).toBeUndefined();
    await write(turn(6));
    expect(await hook.run(stopInput({ turns: 6, tracePath }))).toMatchObject({
      output: { turns: 3 },
    });
    // An Agent without skills has nowhere to record a finding.
    const bare = createSkillSummaryHook({
      root: dir,
      projectId: "p",
      agentId: "a",
      sessionId: "s1",
      minTurns: 1,
      runner,
      listSkills: async () => [],
    });
    expect(await bare.run(stopInput({ turns: 6, tracePath }))).toBeUndefined();
    await fs.rm(dir, { recursive: true, force: true });
  });
});
