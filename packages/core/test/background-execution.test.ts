/**
 * Behavior tests for background execution: `run_in_background` on exec_command /
 * run_subagent, the completion-report pipeline (Environment listener → Session notice
 * queue → engine boundary delivery), the kill_command / kill_subagent tools, and the
 * `sender` marking on user texts.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Environment } from "../src/environment/index.js";
import { createSubagentTool } from "../src/environment/tools/run-subagent.js";
import { createInputSubagentTool } from "../src/environment/tools/input-subagent.js";
import { createKillSubagentTool } from "../src/environment/tools/kill-subagent.js";
import { SubagentSessionManager } from "../src/environment/tools/subagent/index.js";
import { DEFAULT_EMPTY_POLL_YIELD_MS } from "../src/environment/tools/command/index.js";
import { ContextEngine } from "../src/engine/context-engine.js";
import {
  assistantText,
  buildBackgroundTaskDoneMessage,
  emptyTokenCounts,
  parseBackgroundTaskDoneMessage,
  partialText,
  stripLeadingMarkerBlocks,
  toolCall,
  tokenUsage,
  userText,
} from "../src/omnimessage/index.js";
import { Session } from "../src/index.js";
import type { OmniMessage, SessionMetaPayload, TextPayload } from "../src/omnimessage/index.js";
import type {
  ApproveFn,
  BackgroundTaskDoneEvent,
  EnvironmentInterface,
  GenerativeModelParameters,
  LLMInterface,
  LLMOutcome,
  SubagentHandle,
  SubagentRunner,
  ToolConfig,
  ToolDefinitionConfig,
} from "../src/interfaces.js";
import type { ToolExecutionContext } from "../src/environment/tools/types.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function toolDef(name: string, extra: Partial<ToolDefinitionConfig> = {}): ToolDefinitionConfig {
  return {
    name,
    description: `${name} test`,
    permission: "rw",
    maxOutputLength: 16000,
    ...extra,
  };
}

function commandToolConfig(): ToolConfig {
  return {
    customTools: [toolDef("exec_command"), toolDef("input_command"), toolDef("kill_command")],
    mcpServers: [],
  };
}

interface FinalOutput {
  output: string;
  stopReason?: string;
}

async function runTool(
  env: Environment,
  name: string,
  args: Record<string, unknown>,
): Promise<FinalOutput> {
  let last: OmniMessage | null = null;
  for await (const msg of env.executeTool({
    toolCall: toolCall({ name, arguments: JSON.stringify(args), toolCallId: `call_${name}` }),
  })) {
    if ((msg.payload as { type?: string }).type === "tool_call_output") last = msg;
  }
  const p = (last?.payload ?? {}) as { output?: string; stop_reason?: string };
  return { output: p.output ?? "", stopReason: p.stop_reason };
}

function extractProcessId(output: string): string {
  const m = output.match(/process_id (proc-[0-9a-f]+)/);
  expect(m, `expected a process_id in: ${JSON.stringify(output)}`).toBeTruthy();
  return m![1]!;
}

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function makeEnv(): Promise<{ env: Environment; dir: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), "penguin-bg-"));
  const env = new Environment({ workspaceDir: dir, toolConfig: commandToolConfig() });
  cleanups.push(async () => {
    env.dispose();
    await rm(dir, { recursive: true, force: true });
  });
  return { env, dir };
}

/** Waits until the predicate holds (events arrive from real process exits). */
async function waitFor(pred: () => boolean, timeoutMs = 5000): Promise<void> {
  await vi.waitFor(
    () => {
      if (!pred()) throw new Error("condition not met yet");
    },
    { timeout: timeoutMs, interval: 20 },
  );
}

// ---------------------------------------------------------------------------
// Marker block and sender field
// ---------------------------------------------------------------------------

describe("[background_task_done] marker and the sender field", () => {
  it("build/parse round-trips the completion facts and the body", () => {
    const text = buildBackgroundTaskDoneMessage(
      { kind: "command", id: "proc-12ab34cd", status: "failed", detail: "exit code 2" },
      "`pnpm test` — exit code 2\n\ntail output",
    );
    const parsed = parseBackgroundTaskDoneMessage(text);
    expect(parsed).not.toBeNull();
    expect(parsed!.done).toEqual({
      kind: "command",
      id: "proc-12ab34cd",
      status: "failed",
      detail: "exit code 2",
    });
    expect(parsed!.rest).toBe("`pnpm test` — exit code 2\n\ntail output");
    // Detail omitted -> parsed back as empty.
    const bare = buildBackgroundTaskDoneMessage(
      { kind: "subagent", id: "subagent-1", status: "completed", detail: "" },
      "",
    );
    expect(parseBackgroundTaskDoneMessage(bare)!.done.detail).toBe("");
  });

  it("only parses as a leading block, and the title stripper removes it", () => {
    const block = buildBackgroundTaskDoneMessage(
      { kind: "command", id: "proc-1", status: "completed", detail: "" },
      "body",
    );
    expect(parseBackgroundTaskDoneMessage(`hello\n${block}`)).toBeNull();
    expect(stripLeadingMarkerBlocks(block)).toBe("body");
  });

  it("userText marks non-human senders and leaves human input unmarked", () => {
    expect((userText("hi").payload as TextPayload).sender).toBeUndefined();
    expect((userText("hi", "user").payload as TextPayload).sender).toBeUndefined();
    expect((userText("hi", "parent_agent").payload as TextPayload).sender).toBe("parent_agent");
    expect((userText("hi", "harness").payload as TextPayload).sender).toBe("harness");
    expect((userText("hi", "server").payload as TextPayload).sender).toBe("server");
  });
});

// ---------------------------------------------------------------------------
// exec_command run_in_background + kill_command
// ---------------------------------------------------------------------------

describe("exec_command run_in_background", () => {
  it("returns a process_id immediately and reports completion with the output tail", async () => {
    const { env } = await makeEnv();
    const events: BackgroundTaskDoneEvent[] = [];
    env.setBackgroundTaskListener((e) => events.push(e));
    const res = await runTool(env, "exec_command", {
      cmd: "printf 'bg output'; exit 0",
      run_in_background: true,
    });
    expect(res.stopReason).toBe("completed");
    const id = extractProcessId(res.output);
    expect(res.output).toContain("will arrive as a user message");
    await waitFor(() => events.length === 1);
    const e = events[0]!;
    expect(e).toMatchObject({ kind: "command", id, status: "completed", detail: "exit code 0" });
    expect(e.output).toContain("bg output");
    expect(e.label).toContain("printf 'bg output'");
  });

  it("reports a non-zero exit as failed with the exit code", async () => {
    const { env } = await makeEnv();
    const events: BackgroundTaskDoneEvent[] = [];
    env.setBackgroundTaskListener((e) => events.push(e));
    await runTool(env, "exec_command", { cmd: "exit 3", run_in_background: true });
    await waitFor(() => events.length === 1);
    expect(events[0]).toMatchObject({ status: "failed", detail: "exit code 3" });
  });

  it("buffers events fired before the listener attaches", async () => {
    const { env } = await makeEnv();
    const res = await runTool(env, "exec_command", {
      cmd: "printf early; exit 0",
      run_in_background: true,
    });
    extractProcessId(res.output);
    // Let the process exit with no listener attached, then attach.
    await new Promise((r) => setTimeout(r, 300));
    const events: BackgroundTaskDoneEvent[] = [];
    env.setBackgroundTaskListener((e) => events.push(e));
    await waitFor(() => events.length === 1);
    expect(events[0]!.output).toContain("early");
  });

  it("kill_command terminates a running background command without a completion report", async () => {
    const { env } = await makeEnv();
    const events: BackgroundTaskDoneEvent[] = [];
    env.setBackgroundTaskListener((e) => events.push(e));
    const res = await runTool(env, "exec_command", {
      cmd: "printf pre; sleep 30",
      run_in_background: true,
    });
    const id = extractProcessId(res.output);
    // Give the pipe a moment to deliver the pre-kill output into the session buffer.
    await new Promise((r) => setTimeout(r, 500));
    const killed = await runTool(env, "kill_command", { process_id: id });
    expect(killed.stopReason).toBe("completed");
    expect(killed.output).toContain("pre");
    expect(killed.output).toContain(`process ${id} killed`);
    // The kill-caused exit must not masquerade as a task completion.
    await new Promise((r) => setTimeout(r, 400));
    expect(events).toHaveLength(0);
    // And the session is gone from the registry.
    const again = await runTool(env, "kill_command", { process_id: id });
    expect(again.stopReason).toBe("failed");
  });

  it("kill_command fails on an unknown process_id", async () => {
    const { env } = await makeEnv();
    const res = await runTool(env, "kill_command", { process_id: "proc-deadbeef" });
    expect(res.stopReason).toBe("failed");
    expect(res.output).toContain("unknown process_id");
  });

  it("dispose suppresses pending completion reports", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "penguin-bg-"));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const env = new Environment({ workspaceDir: dir, toolConfig: commandToolConfig() });
    const events: BackgroundTaskDoneEvent[] = [];
    env.setBackgroundTaskListener((e) => events.push(e));
    await runTool(env, "exec_command", { cmd: "sleep 30", run_in_background: true });
    env.dispose(); // kills the process; its exit must not report
    await new Promise((r) => setTimeout(r, 400));
    expect(events).toHaveLength(0);
  });
});

describe("input_command defaults", () => {
  it("the default empty-poll wait is 120000ms", () => {
    expect(DEFAULT_EMPTY_POLL_YIELD_MS).toBe(120_000);
  });
});

// ---------------------------------------------------------------------------
// run_subagent run_in_background + kill_subagent (fake runner)
// ---------------------------------------------------------------------------

const SUB_DEF = toolDef("run_subagent");
const SUB_INPUT_DEF = toolDef("input_subagent");
const SUB_KILL_DEF = toolDef("kill_subagent");
const CTX: ToolExecutionContext = { workspaceDir: "/tmp/ws", toolCallId: "call_1" };
const HOP = "session-child-12ab34cd";

type RunInput = { prompt: string; signal?: AbortSignal; approve?: ApproveFn };

function runnerOf(run: (input: RunInput) => AsyncGenerator<OmniMessage>): SubagentRunner {
  return {
    async spawn() {
      const handle: SubagentHandle = { sessionId: HOP, run, dispose() {} };
      return handle;
    },
  };
}

async function drive(
  tool: ReturnType<typeof createSubagentTool>,
  args: Record<string, unknown>,
): Promise<{ output: string; stopReason?: string; note: string }> {
  const gen = tool.execute(args, CTX);
  let output = "";
  for (;;) {
    const res = await gen.next();
    if (res.done) {
      const r = res.value ?? undefined;
      return { output, stopReason: r?.stopReason, note: r?.note ?? "" };
    }
    const p = res.value.payload as { type?: string; event_type?: string; output?: string };
    if (p.type === "partial_tool_call_output" && p.event_type === "delta" && p.output) {
      output += p.output;
    }
  }
}

function extractSubagentId(text: string): string {
  const m = text.match(/subagent_id (subagent-[0-9a-f]+)/);
  expect(m, `expected a subagent_id in: ${JSON.stringify(text)}`).toBeTruthy();
  return m![1]!;
}

describe("run_subagent run_in_background", () => {
  it("returns a subagent_id immediately and reports each round's completion", async () => {
    const manager = new SubagentSessionManager();
    cleanups.push(() => manager.dispose());
    // Each round blocks on its own gate, so the test controls when a round settles.
    const gates = new Map<string, () => void>();
    const runner = runnerOf(async function* ({ prompt }) {
      await new Promise<void>((r) => gates.set(prompt, r));
      yield withHop(partialText("delta", `answer to: ${prompt}`));
    });
    const events: BackgroundTaskDoneEvent[] = [];
    const services = {
      subagentRunner: runner,
      subagentSessions: manager,
      backgroundDone: (e: BackgroundTaskDoneEvent) => events.push(e),
    };
    const tool = createSubagentTool(SUB_DEF, services);
    const res = await drive(tool, {
      prompt: "long analysis task",
      run_in_background: true,
    });
    expect(res.stopReason).toBe("completed");
    const id = extractSubagentId(res.note);
    expect(res.note).toContain("will arrive as a user message");
    expect(events).toHaveLength(0); // still running behind the gate
    await waitFor(() => gates.has("long analysis task"));
    gates.get("long analysis task")!();
    await waitFor(() => events.length === 1);
    expect(events[0]).toMatchObject({ kind: "subagent", id, status: "completed" });
    expect(events[0]!.output).toContain("answer to: long analysis task");
    expect(events[0]!.label).toBe("long analysis task");

    // A follow-up round through input_subagent that outlives the poll window reports again
    // on settle, carrying the text the window never delivered.
    const input = createInputSubagentTool(SUB_INPUT_DEF, services);
    const follow = await drive(input, {
      subagent_id: id,
      prompt: "second round",
      yield_time_ms: 250,
    });
    expect(follow.stopReason).toBe("completed");
    expect(follow.note).toContain("still running");
    await waitFor(() => gates.has("second round"));
    gates.get("second round")!();
    await waitFor(() => events.length === 2);
    expect(events[1]!.output).toContain("answer to: second round");
  });

  it("kill_subagent aborts a running background subagent without a completion report", async () => {
    const manager = new SubagentSessionManager();
    cleanups.push(() => manager.dispose());
    const runner = runnerOf(async function* ({ signal }) {
      await new Promise<void>((resolve) => {
        if (signal?.aborted) return resolve();
        signal?.addEventListener("abort", () => resolve(), { once: true });
      });
      yield withHop(assistantText("late"));
    });
    const events: BackgroundTaskDoneEvent[] = [];
    const services = {
      subagentRunner: runner,
      subagentSessions: manager,
      backgroundDone: (e: BackgroundTaskDoneEvent) => events.push(e),
    };
    const tool = createSubagentTool(SUB_DEF, services);
    const res = await drive(tool, { prompt: "will be killed", run_in_background: true });
    const id = extractSubagentId(res.note);
    const kill = createKillSubagentTool(SUB_KILL_DEF, services);
    const killed = await drive(kill, { subagent_id: id });
    expect(killed.stopReason).toBe("completed");
    expect(killed.note).toContain("aborted and removed");
    expect(manager.get(id)).toBeUndefined();
    await new Promise((r) => setTimeout(r, 100));
    expect(events).toHaveLength(0);
  });

  it("kill_subagent fails on an unknown subagent_id", async () => {
    const manager = new SubagentSessionManager();
    cleanups.push(() => manager.dispose());
    const kill = createKillSubagentTool(SUB_KILL_DEF, { subagentSessions: manager });
    const res = await drive(kill, { subagent_id: "subagent-deadbeef" });
    expect(res.stopReason).toBe("failed");
    expect(res.output).toContain("unknown subagent_id");
  });
});

/** Tags a message with the child hop, as the SubagentHandle contract requires. */
function withHop<M extends OmniMessage>(msg: M): M {
  return { ...msg, origin: [HOP] };
}

// ---------------------------------------------------------------------------
// Engine boundary delivery of queued notices
// ---------------------------------------------------------------------------

/** A fake LLM that always answers with a plain final reply (no tool calls). */
class ReplyLLM implements LLMInterface {
  calls = 0;
  inputs: OmniMessage[][] = [];
  async *streamGenerate(
    params: GenerativeModelParameters,
  ): AsyncGenerator<OmniMessage, LLMOutcome> {
    this.calls += 1;
    this.inputs.push(params.newMessages);
    yield assistantText(`reply ${this.calls}`);
    yield tokenUsage(emptyTokenCounts(), { cache_read: 0, cache_write: 0, output: 1, total: 2 });
    return { status: "completed" };
  }
}

const idleEnvironment: EnvironmentInterface = {
  listTools: async () => [],
  executeTool: async function* () {
    throw new Error("not used");
  },
  toolPermission: () => undefined,
};

const allow: ApproveFn = async () => "allow";

describe("ContextEngine background-notice delivery", () => {
  it("delivers notices queued before the run with the first request input", async () => {
    const llm = new ReplyLLM();
    const queue: OmniMessage[] = [userText("[notice] task one done", "harness")];
    const engine = new ContextEngine({
      llm,
      environment: idleEnvironment,
      backgroundNotices: { drain: () => queue.splice(0), pending: () => queue.length },
    });
    const streamed: OmniMessage[] = [];
    for await (const msg of engine.run([userText("hello")], { approve: allow })) streamed.push(msg);
    expect(llm.calls).toBe(1);
    const texts = llm.inputs[0]!.map((m) => (m.payload as { text?: string }).text);
    expect(texts).toEqual(["hello", "[notice] task one done"]);
    // The notice is also yielded to the consumer (mid-run input the render layer never saw).
    expect(
      streamed.some((m) => (m.payload as { text?: string }).text === "[notice] task one done"),
    ).toBe(true);
  });

  it("a notice arriving mid-run extends the task by one turn to react to it", async () => {
    const llm = new ReplyLLM();
    const queue: OmniMessage[] = [];
    const engine = new ContextEngine({
      llm,
      environment: idleEnvironment,
      backgroundNotices: { drain: () => queue.splice(0), pending: () => queue.length },
    });
    const gen = engine.run([userText("hello")], { approve: allow });
    // Push the notice once the first request is in flight: after the first streamed message.
    let pushed = false;
    for await (const msg of gen) {
      void msg;
      if (!pushed) {
        pushed = true;
        queue.push(userText("[notice] finished late", "harness"));
      }
    }
    // Turn 1 answered, then the notice forced turn 2 whose input is exactly the notice.
    expect(llm.calls).toBe(2);
    const texts = llm.inputs[1]!.map((m) => (m.payload as { text?: string }).text);
    expect(texts).toEqual(["[notice] finished late"]);
  });
});

// ---------------------------------------------------------------------------
// Session wiring: environment events → notice queue → host signal
// ---------------------------------------------------------------------------

const META: SessionMetaPayload = {
  session_id: "session-bg-1",
  provider: "custom",
  model_id: "m1",
  model_context_window: 1000,
  system_prompt: "sp",
  agent_state: "/tmp/state",
  workspace: "/tmp/w",
};
const IMAGES = { imagesDir: "/tmp/scratchpad/session-bg-1", modelHasVision: true } as const;

/** Fake environment that exposes the background listener attach so tests can fire events. */
function listenerEnvironment(): {
  environment: EnvironmentInterface;
  fire: (e: BackgroundTaskDoneEvent) => void;
} {
  let listener: ((e: BackgroundTaskDoneEvent) => void) | null = null;
  return {
    environment: {
      ...idleEnvironment,
      setBackgroundTaskListener: (cb) => (listener = cb),
    },
    fire: (e) => listener?.(e),
  };
}

const DONE_EVENT: BackgroundTaskDoneEvent = {
  kind: "command",
  id: "proc-11aa22bb",
  status: "completed",
  detail: "exit code 0",
  label: "sleep 1",
  output: "done!",
};

describe("Session background notices", () => {
  it("queues an idle-arrival as a harness user message and signals the host", async () => {
    const { environment, fire } = listenerEnvironment();
    const session = new Session({
      meta: META,
      ...IMAGES,
      bootstrap: async () => ({ tools: [], llm: new ReplyLLM(), mcp: [] }),
      mcpServers: [],
      environment,
    });
    let signaled = 0;
    session.onBackgroundNotice(() => (signaled += 1));
    fire(DONE_EVENT);
    expect(signaled).toBe(1);
    const taken = session.takeBackgroundNotices();
    expect(taken).toHaveLength(1);
    const p = taken[0]!.payload as TextPayload;
    expect(p.role).toBe("user");
    expect(p.sender).toBe("harness");
    const parsed = parseBackgroundTaskDoneMessage(p.text);
    expect(parsed!.done).toMatchObject({ kind: "command", id: "proc-11aa22bb" });
    expect(parsed!.rest).toContain("`sleep 1`");
    expect(parsed!.rest).toContain("done!");
    // Taking empties the queue, and the pending flag (the host's eviction pin) tracks it.
    expect(session.hasPendingBackgroundNotices()).toBe(false);
    fire(DONE_EVENT);
    expect(session.hasPendingBackgroundNotices()).toBe(true);
    session.takeBackgroundNotices();
    expect(session.takeBackgroundNotices()).toHaveLength(0);
    expect(session.hasPendingBackgroundNotices()).toBe(false);
  });

  it("delivers a queued notice on the next run without a host signal for running tasks", async () => {
    const { environment, fire } = listenerEnvironment();
    const llm = new ReplyLLM();
    const session = new Session({
      meta: META,
      ...IMAGES,
      bootstrap: async () => ({ tools: [], llm, mcp: [] }),
      mcpServers: [],
      environment,
    });
    fire(DONE_EVENT); // no listener registered: stays queued
    const streamed: OmniMessage[] = [];
    for await (const msg of session.run([userText("hi")])) streamed.push(msg);
    expect(llm.calls).toBe(1);
    const texts = llm.inputs[0]!.map((m) => (m.payload as { text?: string }).text ?? "");
    expect(texts[0]).toBe("hi");
    expect(texts[1]).toContain("[background_task_done]");
  });
});
