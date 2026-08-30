import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  Session,
  assistantText,
  isEventMessage,
  parseStopHookResult,
  runHookScript,
  runStopHooks,
  scriptStopHook,
  tokenUsage,
  userText,
} from "../src/index.js";
import type {
  EnvironmentInterface,
  HookPayload,
  HookSubagentRequest,
  LLMInterface,
  LLMOutcome,
  OmniMessage,
  SessionMetaPayload,
  StopHook,
  StopHookInput,
  TokenCounts,
  TraceSink,
} from "../src/index.js";

function usage(total: number, cacheRead = 0): TokenCounts {
  return { cache_read: cacheRead, cache_write: 0, output: 0, total };
}

function stopInput(over: Partial<StopHookInput> = {}): StopHookInput {
  return { sessionId: "s1", ...over };
}

/** A script that reads the hook input from stdin and answers with `body` (a JS expression over `input`). */
const answering = (body: string): string =>
  'const raw = await new Promise((r) => { let s = ""; process.stdin.setEncoding("utf8").on("data", (c) => (s += c)).on("end", () => r(s)); });\n' +
  "const input = JSON.parse(raw);\n" +
  `process.stdout.write(JSON.stringify(${body}));\n`;

describe("runStopHooks", () => {
  it("records every answer, honors the first continue, and keeps a throwing hook from taking the run down", async () => {
    const hooks: StopHook[] = [
      { name: "quiet", run: async () => undefined },
      { name: "broken", run: async () => Promise.reject(new Error("boom")) },
      {
        name: "first",
        run: async () => ({ decision: "continue", input: "again", reason: "one" }),
      },
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

  it("hands a subagent request to the spawner and records the child's session id; a missing or failing spawner is recorded", async () => {
    const asks: HookSubagentRequest[] = [];
    const hook: StopHook = {
      name: "review",
      run: async () => ({
        reason: "delegated",
        output: { turns: 20 },
        subagent: { prompt: "review this", agentId: "b" },
      }),
    };
    const spawned = await runStopHooks([hook], stopInput(), async (req) => {
      asks.push(req);
      return "child-1";
    });
    expect(asks).toEqual([{ prompt: "review this", agentId: "b" }]);
    expect(spawned.events[0]!.payload).toMatchObject({
      reason: "delegated",
      output: { turns: 20, session_id: "child-1" },
    });
    const unspawned = await runStopHooks([hook], stopInput());
    expect(unspawned.events[0]!.payload.reason).toBe(
      "delegated · subagent not spawned: no spawner",
    );
    const failed = await runStopHooks([hook], stopInput(), async () => {
      throw new Error("depth limit");
    });
    expect(failed.events[0]!.payload.reason).toBe("delegated · subagent not spawned: depth limit");
    expect(failed.events[0]!.payload.output).toEqual({ turns: 20 });
  });
});

describe("script hooks", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-script-hook-"));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const write = async (name: string, body: string): Promise<string> => {
    const file = path.join(dir, name);
    await fs.writeFile(file, body, "utf8");
    return file;
  };

  it("runHookScript feeds the input on stdin and returns the parsed stdout; empty stdout is no opinion", async () => {
    const echo = await write("echo.mjs", answering("{ got: input, cwd: process.cwd() }"));
    const out = (await runHookScript(echo, { hook: "stop", session_id: "s1" })) as Record<
      string,
      unknown
    >;
    expect(out.got).toEqual({ hook: "stop", session_id: "s1" });
    expect(out.cwd).toBe(dir);
    const quiet = await write("quiet.mjs", "process.exit(0);\n");
    expect(await runHookScript(quiet, {})).toBeUndefined();
  });

  it("a non-zero exit, non-JSON stdout, and a timeout each fail with a reason", async () => {
    const crash = await write("crash.mjs", 'process.stderr.write("kaboom\\n"); process.exit(3);\n');
    await expect(runHookScript(crash, {})).rejects.toThrow(/exit 3: kaboom/);
    const garbage = await write("garbage.mjs", 'process.stdout.write("not json");\n');
    await expect(runHookScript(garbage, {})).rejects.toThrow(/stdout is not JSON/);
    const hang = await write("hang.mjs", "setInterval(() => {}, 1000);\n");
    await expect(runHookScript(hang, {}, { timeoutS: 0.2 })).rejects.toThrow(/timed out/);
  });

  it("parseStopHookResult keeps the contract's fields only, and scalars only in output", () => {
    expect(
      parseStopHookResult({
        decision: "continue",
        input: "next",
        reason: "r",
        output: { a: 1, b: "x", c: true, d: { nested: 1 }, e: null },
        subagent: { prompt: "p", agent_id: "b", extra: 1 },
        unknown: "dropped",
      }),
    ).toEqual({
      decision: "continue",
      input: "next",
      reason: "r",
      output: { a: 1, b: "x", c: true },
      subagent: { prompt: "p", agentId: "b" },
    });
    expect(parseStopHookResult({ decision: "maybe", input: 5, subagent: { prompt: " " } })).toEqual(
      {},
    );
    expect(parseStopHookResult("nope")).toBeUndefined();
    expect(parseStopHookResult(null)).toBeUndefined();
  });

  it("scriptStopHook adapts one installed command: the hook input on stdin, the answer parsed", async () => {
    await write(
      "stop.mjs",
      answering(
        '{ decision: "stop", reason: `${input.hook} ${input.session_id} ${input.trace_path}` }',
      ),
    );
    const hook = scriptStopHook("demo", dir, "stop.mjs", 5);
    expect(hook.name).toBe("demo");
    expect(await hook.run({ sessionId: "s1", tracePath: "/t/s1_001.jsonl" })).toEqual({
      decision: "stop",
      reason: "stop s1 /t/s1_001.jsonl",
    });
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

  function makeSession(
    hooks: StopHook[],
    llm: LLMInterface,
    extra: {
      trace?: TraceSink;
      spawnSubagent?: (request: HookSubagentRequest, approve?: unknown) => Promise<string>;
    } = {},
  ): Session {
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
      hooks: {
        stop: hooks,
        ...(extra.spawnSubagent ? { spawnSubagent: extra.spawnSubagent } : {}),
      },
      ...(extra.trace ? { trace: extra.trace } : {}),
    });
  }

  it("a continue drives a second Task in the same run, with its input yielded and the events recorded in the Trace", async () => {
    const seen: StopHookInput[] = [];
    const hook: StopHook = {
      name: "once",
      run: async (input) => {
        seen.push(input);
        return seen.length === 1
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
    const session = makeSession([hook], llm, { trace });
    const stream: OmniMessage[] = [];
    for await (const msg of session.run([userText("hello")])) stream.push(msg);
    // Two Tasks ran: the second on the hook's input.
    expect(llm.inputs).toEqual(["hello", "again"]);
    // The hook is told where to look, nothing more.
    expect(seen).toEqual([
      { sessionId: "session-1", tracePath: "/traces/session-1_001.jsonl" },
      { sessionId: "session-1", tracePath: "/traces/session-1_001.jsonl" },
    ]);
    // The stream: the hook event, then the injected user input, then the second Task.
    const kinds = stream.map((m) =>
      isEventMessage(m) && m.payload.type === "hook"
        ? `hook:${(m.payload as HookPayload).decision}`
        : m.type === "model_msg" && (m.payload as { role?: string }).role === "user"
          ? `user:${(m.payload as { text: string }).text}`
          : null,
    );
    expect(kinds.filter(Boolean)).toEqual(["hook:continue", "user:again", "hook:stop"]);
    // Both hook events reached the Trace.
    const hookWrites = writes.filter((m) => isEventMessage(m) && m.payload.type === "hook");
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
    expect(stream.some((m) => isEventMessage(m) && m.payload.type === "hook")).toBe(true);
  });

  it("honors a subagent answer through the Session's spawner, passing the run's approval callback", async () => {
    const asks: Array<{ prompt: string; approved: boolean }> = [];
    const hook: StopHook = {
      name: "review",
      run: async () => ({ reason: "delegated", subagent: { prompt: "look" } }),
    };
    const llm = echoLLM();
    const session = makeSession([hook], llm, {
      spawnSubagent: async (request, approve) => {
        asks.push({ prompt: request.prompt, approved: approve !== undefined });
        return "child-9";
      },
    });
    const stream: OmniMessage[] = [];
    for await (const msg of session.run([userText("hello")], { approve: async () => "allow" })) {
      stream.push(msg);
    }
    expect(asks).toEqual([{ prompt: "look", approved: true }]);
    const event = stream.find((m) => isEventMessage(m) && m.payload.type === "hook")!
      .payload as HookPayload;
    expect(event.output).toEqual({ session_id: "child-9" });
    expect(llm.inputs).toEqual(["hello"]);
  });
});
