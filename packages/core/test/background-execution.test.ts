/**
 * Behavior tests for background execution: `run_in_background` on exec_command /
 * run_subagent, detaching a call that is already executing (the Web App's per-card button),
 * the completion-report pipeline (Environment listener → Session notice queue → engine
 * boundary delivery), input_command's kill termination, and the `sender` marking on user
 * texts.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Environment } from "../src/environment/index.js";
import { armCommandDoneReport } from "../src/environment/tools/exec-command.js";
import {
  ManagedSession,
  DEFAULT_EMPTY_POLL_YIELD_MS,
} from "../src/environment/tools/command/index.js";
import { createSubagentTool } from "../src/environment/tools/run-subagent.js";
import { createInputSubagentTool } from "../src/environment/tools/input-subagent.js";
import { SubagentSessionManager } from "../src/environment/tools/subagent/index.js";
import { ContextEngine } from "../src/engine/context-engine.js";
import {
  requestEnd,
  assistantText,
  buildBackgroundTaskDoneMessage,
  emptyTokenCounts,
  isSteeredBackgroundNotice,
  parseBackgroundTaskDoneMessage,
  partialText,
  stripLeadingMarkerBlocks,
  toolCall,
  tokenUsage,
  userText,
} from "../src/omnimessage/index.js";
import { Session } from "../src/index.js";
import type {
  OmniMessage,
  SessionMetaPayload,
  TextPayload,
  ToolCallPayload,
} from "../src/omnimessage/index.js";
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
  ToolDetachResult,
} from "../src/interfaces/index.js";
import { DETACHED_TOOL_NOTE_PREFIX } from "../src/interfaces/index.js";
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

/**
 * Runs a tool and detaches the call from outside the moment `when` holds against the output
 * seen so far — the Web App's button, fired while the call is still executing.
 */
async function runToolDetachedOn(
  env: Environment,
  name: string,
  args: Record<string, unknown>,
  when: (seen: string) => boolean,
): Promise<FinalOutput & { detach: ToolDetachResult | null; completeOutputs: number }> {
  const toolCallId = `call_${name}_detach`;
  let detach: ToolDetachResult | null = null;
  let seen = "";
  let completeOutputs = 0;
  let last: OmniMessage | null = null;
  for await (const msg of env.executeTool({
    toolCall: toolCall({ name, arguments: JSON.stringify(args), toolCallId }),
  })) {
    const p = msg.payload as { type?: string; output?: string };
    if (p.type === "tool_call_output") {
      completeOutputs += 1;
      last = msg;
    } else {
      seen += p.output ?? "";
    }
    if (detach === null && when(seen)) detach = env.detachToolCall(toolCallId);
  }
  const p = (last?.payload ?? {}) as { output?: string; stop_reason?: string };
  return { output: p.output ?? "", stopReason: p.stop_reason, detach, completeOutputs };
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
    // Retries: background commands keep this dir as their cwd, and on Windows a just-killed
    // process releases that lock asynchronously — an immediate recursive rm hits EBUSY.
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
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

  it("stamps and parses the steering delivery field; unstamped blocks read as task input", () => {
    const steered = buildBackgroundTaskDoneMessage(
      { kind: "command", id: "proc-1", status: "completed", detail: "", delivery: "steering" },
      "body",
    );
    expect(parseBackgroundTaskDoneMessage(steered)!.done.delivery).toBe("steering");
    expect(isSteeredBackgroundNotice(steered)).toBe(true);
    // The unstamped form (idle delivery, and every pre-stamp Trace) has no delivery field.
    const plain = buildBackgroundTaskDoneMessage(
      { kind: "command", id: "proc-1", status: "completed", detail: "" },
      "body",
    );
    expect(plain).not.toContain("delivery:");
    expect(parseBackgroundTaskDoneMessage(plain)!.done.delivery).toBeUndefined();
    expect(isSteeredBackgroundNotice(plain)).toBe(false);
    expect(isSteeredBackgroundNotice("plain user text")).toBe(false);
  });

  it("only parses as a leading block, and the title stripper removes it", () => {
    const block = buildBackgroundTaskDoneMessage(
      { kind: "command", id: "proc-1", status: "completed", detail: "" },
      "body",
    );
    expect(parseBackgroundTaskDoneMessage(`hello\n${block}`)).toBeNull();
    expect(stripLeadingMarkerBlocks(block)).toBe("body");
  });

  it("a stopped status reads as a deliberate stop, with the do-not-restart instruction", () => {
    const stopped = buildBackgroundTaskDoneMessage(
      { kind: "command", id: "proc-12ab34cd", status: "stopped", detail: "stopped by SIGTERM" },
      "`pnpm dev` — stopped by SIGTERM",
    );
    expect(parseBackgroundTaskDoneMessage(stopped)!.done).toMatchObject({
      status: "stopped",
      detail: "stopped by SIGTERM",
    });
    expect(stopped).toContain("Do not restart it unless you are asked to.");
    // Everything else keeps the plain "has finished" lead — a real failure still asks to be
    // reacted to.
    const failed = buildBackgroundTaskDoneMessage(
      { kind: "command", id: "proc-12ab34cd", status: "failed", detail: "exit code 2" },
      "",
    );
    expect(failed).toContain("has finished.");
    expect(failed).not.toContain("Do not restart");
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

  it("input_command kill terminates a running background command without a completion report", async () => {
    const { env } = await makeEnv();
    const events: BackgroundTaskDoneEvent[] = [];
    env.setBackgroundTaskListener((e) => events.push(e));
    const res = await runTool(env, "exec_command", {
      cmd: "printf 'pre http://localhost:5199/\\n'; sleep 30",
      run_in_background: true,
    });
    const id = extractProcessId(res.output);
    // Wait for the pre-kill output to reach the session buffer kill_command drains. A fixed
    // sleep raced the pipe on loaded Windows runners, and that buffer is not readable without
    // draining it — so wait on the URL scanner instead: ManagedSession pushes each chunk to
    // the scanner immediately before appending it to that buffer, so a detected serviceUrl
    // proves the line is already buffered.
    await waitFor(() => env.listBackgroundCommands().some((p) => p.serviceUrl !== undefined));
    const killed = await runTool(env, "input_command", { process_id: id, kill: true });
    expect(killed.stopReason).toBe("completed");
    expect(killed.output).toContain("pre");
    expect(killed.output).toContain(`process ${id} killed`);
    // The kill-caused exit must not masquerade as a task completion.
    await new Promise((r) => setTimeout(r, 400));
    expect(events).toHaveLength(0);
    // And the session is gone from the registry.
    const again = await runTool(env, "input_command", { process_id: id, kill: true });
    expect(again.stopReason).toBe("fatal");
  });

  it("input_command kill fails on an unknown process_id; the legacy kill_command name is an unknown tool", async () => {
    const { env } = await makeEnv();
    const res = await runTool(env, "input_command", { process_id: "proc-deadbeef", kill: true });
    expect(res.stopReason).toBe("fatal");
    expect(res.output).toContain("unknown process_id");
    // A stale stored config may still carry the removed tool; the registry no longer
    // assembles it, so a model call collapses to the standard unknown-tool failure.
    const legacy = await runTool(env, "kill_command", { process_id: "proc-deadbeef" });
    expect(legacy.stopReason).toBe("fatal");
    expect(legacy.output).toContain("Unknown tool: kill_command");
  });

  it.skipIf(process.platform === "win32")(
    "a stop signal from outside reports stopped, not a signal failure",
    async () => {
      const { env } = await makeEnv();
      const events: BackgroundTaskDoneEvent[] = [];
      env.setBackgroundTaskListener((e) => events.push(e));
      await runTool(env, "exec_command", { cmd: "sleep 30", run_in_background: true });
      const pid = env.listBackgroundCommands()[0]!.pid!;
      // Nobody told the harness: a Ctrl-C in a terminal sharing the group, a pkill, a
      // supervisor stopping a dev server. Only the signal itself says it was deliberate —
      // and read as a crash, the model's next move is to start the thing back up.
      process.kill(pid, "SIGTERM");
      await waitFor(() => events.length === 1);
      expect(events[0]).toMatchObject({ status: "stopped", detail: "stopped by SIGTERM" });
    },
  );

  it("the host's stop button still reports — as stopped, not as a signal failure", async () => {
    const { env } = await makeEnv();
    const events: BackgroundTaskDoneEvent[] = [];
    env.setBackgroundTaskListener((e) => events.push(e));
    const res = await runTool(env, "exec_command", { cmd: "sleep 30", run_in_background: true });
    const id = extractProcessId(res.output);
    // The user's stop from the Web App's process list: the conversation still hears about it
    // — the dev server it started is down — it just must not hear "failed".
    expect(env.killBackgroundCommand(id)).toBe(true);
    await waitFor(() => events.length === 1);
    expect(events[0]).toMatchObject({ id, status: "stopped" });
    expect(env.killBackgroundCommand(id)).toBe(false);
  });

  it("a harness-forced stop (capacity eviction, idle reap) reports stopped", async () => {
    // Those two paths kill through the registry rather than CommandSessionManager.kill, so
    // their report stays armed — and must not blame the process for a stop the harness
    // itself asked for, whatever the platform turns that kill into.
    const { dir } = await makeEnv();
    const events: BackgroundTaskDoneEvent[] = [];
    const session = new ManagedSession({ cmd: "sleep 30", cwd: dir, env: process.env });
    cleanups.push(() => session.killHard());
    armCommandDoneReport(session, "proc-evicted", { backgroundDone: (e) => events.push(e) });
    session.kill();
    await waitFor(() => events.length === 1);
    expect(events[0]).toMatchObject({ id: "proc-evicted", status: "stopped" });
  });

  it("dispose suppresses pending completion reports", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "penguin-bg-"));
    cleanups.push(() => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
    const env = new Environment({ workspaceDir: dir, toolConfig: commandToolConfig() });
    const events: BackgroundTaskDoneEvent[] = [];
    env.setBackgroundTaskListener((e) => events.push(e));
    await runTool(env, "exec_command", { cmd: "sleep 30", run_in_background: true });
    env.dispose(); // kills the process; its exit must not report
    await new Promise((r) => setTimeout(r, 400));
    expect(events).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Detaching an executing call (the Web App's per-card button)
// ---------------------------------------------------------------------------

describe("detaching an executing tool call", () => {
  it("ends the call as completed with a process_id, kills nothing, and closes out exactly once", async () => {
    const { env } = await makeEnv();
    const res = await runToolDetachedOn(
      env,
      "exec_command",
      // A yield window far longer than the test: the promotion below can only be the detach.
      { cmd: "printf 'before\\n'; sleep 0.3; printf 'after\\n'; sleep 30", yield_time_ms: 60000 },
      (seen) => seen.includes("before"),
    );
    expect(res.detach).toBe("detached");
    // A detach is not an interruption: no aborted stop reason, no interruption marker.
    expect(res.stopReason).toBe("completed");
    expect(res.output).not.toContain("[interrupted");
    expect(res.output).toContain(DETACHED_TOOL_NOTE_PREFIX);
    // Exactly one complete tool_call_output, so the engine's loop closes normally.
    expect(res.completeOutputs).toBe(1);
    // Whatever had been collected stays in this call's output.
    expect(res.output).toContain("before");

    // The process was NOT killed: it is registered, running, and still producing output that
    // a later input_command poll picks up.
    const id = extractProcessId(res.output);
    expect(env.listBackgroundCommands().find((p) => p.processId === id)?.running).toBe(true);
    const polled = await runTool(env, "input_command", { process_id: id, yield_time_ms: 1500 });
    expect(polled.output).toContain("after");
  });

  it("reports the detached command's completion as a background task", async () => {
    const { env } = await makeEnv();
    const events: BackgroundTaskDoneEvent[] = [];
    env.setBackgroundTaskListener((e) => events.push(e));
    const res = await runToolDetachedOn(
      env,
      "exec_command",
      { cmd: "printf 'before\\n'; sleep 0.4; printf 'done\\n'; exit 0", yield_time_ms: 60000 },
      (seen) => seen.includes("before"),
    );
    const id = extractProcessId(res.output);
    await waitFor(() => events.length === 1);
    expect(events[0]).toMatchObject({ kind: "command", id, status: "completed" });
    expect(events[0]!.output).toContain("done");
  });

  it("answers not_running for an unknown or finished call, and not_detachable for a tool with no background form", async () => {
    const { env } = await makeEnv();
    expect(env.detachToolCall("call_nobody")).toBe("not_running");

    const launched = await runTool(env, "exec_command", {
      cmd: "printf 'poll me\\n'; sleep 30",
      run_in_background: true,
    });
    const id = extractProcessId(launched.output);
    // input_command only polls a process the registry already holds — there is nothing to
    // hand back, so the call is refused rather than silently ending early.
    const polled = await runToolDetachedOn(
      env,
      "input_command",
      { process_id: id, yield_time_ms: 1500 },
      (seen) => seen.includes("poll me"),
    );
    expect(polled.detach).toBe("not_detachable");
    expect(polled.stopReason).toBe("completed");
    // The call is over: its detach channel is gone with it.
    expect(env.detachToolCall("call_input_command_detach")).toBe("not_running");
  });
});

describe("background-state listener", () => {
  it("pings on a background launch, again when the process exits, and on a kill", async () => {
    const { env } = await makeEnv();
    let pings = 0;
    env.setBackgroundStateListener(() => {
      pings += 1;
    });
    const res = await runTool(env, "exec_command", {
      cmd: "printf done; exit 0",
      run_in_background: true,
    });
    extractProcessId(res.output);
    // Registration pinged synchronously, inside the launching call.
    expect(pings).toBeGreaterThanOrEqual(1);
    // The exit pings on its own: the row stays listed (exited) but leaves the running set.
    await waitFor(() => env.listBackgroundCommands().every((p) => !p.running));
    await waitFor(() => pings >= 2);

    const settled = pings;
    const long = await runTool(env, "exec_command", { cmd: "sleep 30", run_in_background: true });
    const id = extractProcessId(long.output);
    expect(pings).toBe(settled + 1);
    // A deliberate kill disarms the completion report but not this: the registry removal
    // pings synchronously, and the group's later exit adds nothing the host has to act on.
    const killed = await runTool(env, "input_command", { process_id: id, kill: true });
    expect(killed.stopReason).toBe("completed");
    expect(pings).toBeGreaterThan(settled + 1);
    expect(env.listBackgroundCommands().find((p) => p.processId === id)).toBeUndefined();
  });

  it("pings when a subagent is promoted to the background and when its round settles", async () => {
    const gates = new Map<string, () => void>();
    const runner = runnerOf(async function* ({ prompt }) {
      await new Promise<void>((r) => gates.set(prompt, r));
      yield withHop(assistantText(`answer to: ${prompt}`));
    });
    const dir = await mkdtemp(path.join(tmpdir(), "penguin-bg-"));
    const env = new Environment({
      workspaceDir: dir,
      toolConfig: { customTools: [SUB_DEF], mcpServers: [] },
      services: { subagentRunner: runner },
    });
    cleanups.push(async () => {
      env.dispose();
      await rm(dir, { recursive: true, force: true });
    });
    let pings = 0;
    env.setBackgroundStateListener(() => {
      pings += 1;
    });
    const res = await runTool(env, "run_subagent", { prompt: "bg task", run_in_background: true });
    expect(res.stopReason).toBe("completed");
    expect(pings).toBeGreaterThanOrEqual(1);
    // Promoted (it holds a subagent_id) and mid-round: what a host counts as a background subagent.
    expect(env.listBackgroundSubagents()).toMatchObject([{ running: true }]);
    expect(env.listBackgroundSubagents()[0]!.subagentId).not.toBeNull();

    const launched = pings;
    await waitFor(() => gates.has("bg task"));
    gates.get("bg task")!();
    await waitFor(() => !env.hasRunningBackgroundSubagents());
    // The round settling rides the same listener as the registry changes: one subscription
    // hears everything that moves the count.
    expect(pings).toBeGreaterThan(launched);
    expect(env.listBackgroundSubagents()).toMatchObject([{ running: false }]);

    // Disposal is silent: the Session has ended, and its registries emptying is not news.
    const beforeDispose = pings;
    env.dispose();
    expect(pings).toBe(beforeDispose);
  });
});

describe("input_command defaults", () => {
  it("the default empty-poll wait is 110000ms", () => {
    expect(DEFAULT_EMPTY_POLL_YIELD_MS).toBe(110_000);
  });
});

// ---------------------------------------------------------------------------
// run_subagent run_in_background + kill_subagent (fake runner)
// ---------------------------------------------------------------------------

const SUB_DEF = toolDef("run_subagent");
const SUB_INPUT_DEF = toolDef("input_subagent");
const CTX: ToolExecutionContext = { workspaceDir: "/tmp/ws", toolCallId: "call_1" };
const HOP = "session-child-12ab34cd";

type RunInput = { prompt: string; signal?: AbortSignal; approve?: ApproveFn };

/**
 * Test fakes still talk in prompt strings; the contract now takes the OmniMessage list a
 * Session's `run` takes, so the adapters below unwrap it once (see SubagentHandle.run).
 */
const promptOf = (messages: OmniMessage[]): string =>
  messages.map((m) => (m.payload as { text?: string }).text ?? "").join("");

function runnerOf(run: (input: RunInput) => AsyncGenerator<OmniMessage>): SubagentRunner {
  return {
    async spawn() {
      // Mirrors the composition layer's one-shot meta seam (SubagentHandle.takeMeta).
      let metaSent = false;
      const handle: SubagentHandle = {
        sessionId: HOP,
        takeMeta() {
          if (metaSent) return null;
          metaSent = true;
          return withHop({
            timestamp: new Date().toISOString(),
            type: "session_meta",
            payload: { session_id: HOP },
          } as unknown as OmniMessage);
        },
        run: ({ messages, ...rest }) => run({ prompt: promptOf(messages), ...rest }),
        dispose() {},
      };
      return handle;
    },
  };
}

async function drive(
  tool: ReturnType<typeof createSubagentTool>,
  args: Record<string, unknown>,
  ctx: ToolExecutionContext = CTX,
): Promise<{ output: string; stopReason?: string; note: string; yielded: OmniMessage[] }> {
  const gen = tool.execute(args, ctx);
  let output = "";
  const yielded: OmniMessage[] = [];
  for (;;) {
    const res = await gen.next();
    if (res.done) {
      const r = res.value ?? undefined;
      return { output, stopReason: r?.stopReason, note: r?.note ?? "", yielded };
    }
    yielded.push(res.value);
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
      yield withHop(assistantText(`answer to: ${prompt}`));
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
    // The child's session_meta is forwarded at launch (origin-tagged), so the frontend's
    // subagents panel and the server's registry learn of it before any poll.
    const metas = res.yielded.filter((m) => m.type === "session_meta");
    expect(metas).toHaveLength(1);
    expect(metas[0]!.origin).toEqual([HOP]);
    expect(events).toHaveLength(0); // still running behind the gate
    // A mid-round child pins its Session's runtime entry against idle eviction: evicting it
    // would strand the completion report and the live message stream.
    expect(manager.hasRunning()).toBe(true);
    await waitFor(() => gates.has("long analysis task"));
    gates.get("long analysis task")!();
    await waitFor(() => events.length === 1);
    expect(manager.hasRunning()).toBe(false);
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

  it("a HOST-started round stays silent: no completion report for the user's own message", async () => {
    const manager = new SubagentSessionManager();
    cleanups.push(() => manager.dispose());
    const gates = new Map<string, () => void>();
    const runner = runnerOf(async function* ({ prompt }) {
      await new Promise<void>((r) => gates.set(prompt, r));
      yield withHop(partialText("delta", `answer to: ${prompt}`));
      yield withHop(assistantText(`answer to: ${prompt}`));
    });
    const events: BackgroundTaskDoneEvent[] = [];
    const services = {
      subagentRunner: runner,
      subagentSessions: manager,
      backgroundDone: (e: BackgroundTaskDoneEvent) => events.push(e),
    };
    const tool = createSubagentTool(SUB_DEF, services);
    const res = await drive(tool, { prompt: "dispatched work", run_in_background: true });
    const id = extractSubagentId(res.note);
    await waitFor(() => gates.has("dispatched work"));
    gates.get("dispatched work")!();
    await waitFor(() => events.length === 1);

    // The user messages the idle child from the panel: their conversation, not dispatched
    // work — the parent must not be notified when it settles.
    const session = manager.get(id)!;
    session.startRun([userText("user says hi")], { suppressDoneReport: true });
    await waitFor(() => gates.has("user says hi"));
    gates.get("user says hi")!();
    await waitFor(() => !session.running);
    await new Promise((r) => setTimeout(r, 50));
    expect(events).toHaveLength(1);

    // The next MODEL-initiated round reports again (the watcher stayed armed).
    const input = createInputSubagentTool(SUB_INPUT_DEF, services);
    const follow = await drive(input, {
      subagent_id: id,
      prompt: "model round",
      yield_time_ms: 250,
    });
    expect(follow.stopReason).toBe("completed");
    await waitFor(() => gates.has("model round"));
    gates.get("model round")!();
    await waitFor(() => events.length === 2);
    expect(events[1]!.output).toContain("answer to: model round");
  });

  it("input_subagent abort ends a running background round without a completion report", async () => {
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
    const res = await drive(tool, { prompt: "will be aborted", run_in_background: true });
    const id = extractSubagentId(res.note);
    const input = createInputSubagentTool(SUB_INPUT_DEF, services);
    const stopped = await drive(input, { subagent_id: id, abort: true, yield_time_ms: 3000 });
    expect(stopped.output).toContain(`aborting subagent ${id}'s current run`);
    expect(stopped.note).toContain(`subagent idle with subagent_id ${id}`);
    // The session survives — a subagent has no kill notion, only its rounds end.
    expect(manager.get(id)).toBeDefined();
    // The abort-caused settle must not masquerade as a task completion.
    await new Promise((r) => setTimeout(r, 100));
    expect(events).toHaveLength(0);
  });

  it("a failing background subagent still reports (status failed) and taps its messages live", async () => {
    const manager = new SubagentSessionManager();
    cleanups.push(() => manager.dispose());
    const runner = runnerOf(async function* () {
      // A child-session failure surfaces as its origin-tagged terminal record plus the
      // run's return value (Session.run's contract), never a throw.
      yield withHop(requestEnd("retryable", { attempt: 6, errorMessage: "socket hang up" }));
      return {
        kind: "llm_failure" as const,
        errorCode: "network" as const,
        errorMessage: "socket hang up",
      };
    });
    const events: BackgroundTaskDoneEvent[] = [];
    const tapped: OmniMessage[] = [];
    const services = {
      subagentRunner: runner,
      subagentSessions: manager,
      backgroundDone: (e: BackgroundTaskDoneEvent) => events.push(e),
      backgroundForward: (m: OmniMessage) => tapped.push(m),
    };
    const tool = createSubagentTool(SUB_DEF, services);
    const res = await drive(tool, { prompt: "will fail", run_in_background: true });
    extractSubagentId(res.note);
    await waitFor(() => events.length === 1);
    expect(events[0]).toMatchObject({ kind: "subagent", status: "failed" });
    expect(events[0]!.detail).toContain("socket hang up");
    // The failure record reached the live tap too (origin-tagged), not a poll buffer.
    expect(tapped.some((m) => (m.payload as { type?: string }).type === "request_end")).toBe(true);
  });

  it("a background child's approvals resolve through the launching call's standing sink", async () => {
    const manager = new SubagentSessionManager();
    cleanups.push(() => manager.dispose());
    const decisions: string[] = [];
    const runner = runnerOf(async function* ({ approve }) {
      const tc = withHop(toolCall({ name: "exec_command", arguments: "{}", toolCallId: "c1" }));
      const d = await approve!(tc as OmniMessage<ToolCallPayload>);
      decisions.push(d);
      yield withHop(partialText("delta", `approved:${d}`));
    });
    const events: BackgroundTaskDoneEvent[] = [];
    const services = {
      subagentRunner: runner,
      subagentSessions: manager,
      backgroundDone: (e: BackgroundTaskDoneEvent) => events.push(e),
    };
    const tool = createSubagentTool(SUB_DEF, services);
    const approveSpy: ApproveFn = async () => "allow";
    const res = await drive(
      tool,
      { prompt: "needs approval", run_in_background: true },
      { ...CTX, approve: approveSpy },
    );
    extractSubagentId(res.note);
    // Without the standing sink this parks forever: the child's first approval request has
    // no collect window to consult through.
    await waitFor(() => decisions.length === 1);
    expect(decisions[0]).toBe("allow");
    await waitFor(() => events.length === 1);
    expect(events[0]!.status).toBe("completed");
  });

  it("a detached child keeps running, inherits the call's approval sink and message tap, and reports on settle", async () => {
    const manager = new SubagentSessionManager();
    cleanups.push(() => manager.dispose());
    const decisions: string[] = [];
    const gates = new Map<string, () => void>();
    const runner = runnerOf(async function* ({ prompt, approve }) {
      // Parked until the test releases it, so the detach lands mid-round.
      await new Promise<void>((r) => gates.set(prompt, r));
      const tc = withHop(toolCall({ name: "exec_command", arguments: "{}", toolCallId: "c1" }));
      decisions.push(await approve!(tc as OmniMessage<ToolCallPayload>));
      yield withHop(partialText("delta", "child answer"));
      yield withHop(assistantText("child answer"));
    });
    const events: BackgroundTaskDoneEvent[] = [];
    const tapped: OmniMessage[] = [];
    const services = {
      subagentRunner: runner,
      subagentSessions: manager,
      backgroundDone: (e: BackgroundTaskDoneEvent) => events.push(e),
      backgroundForward: (m: OmniMessage) => tapped.push(m),
    };
    const tool = createSubagentTool(SUB_DEF, services);
    const approveSpy: ApproveFn = async () => "allow";
    const detach = new AbortController();
    const timer = setTimeout(() => detach.abort(), 50);
    const res = await drive(
      tool,
      // A yield window far longer than the test: the promotion can only be the detach.
      { prompt: "long job", yield_time_ms: 60000 },
      { ...CTX, approve: approveSpy, detachSignal: detach.signal },
    );
    clearTimeout(timer);
    // Not an interruption: the call completes with a handle, and the child is still alive.
    expect(res.stopReason).toBe("completed");
    expect(res.note).toContain(DETACHED_TOOL_NOTE_PREFIX);
    const id = extractSubagentId(res.note);
    expect(manager.hasRunning()).toBe(true);

    await waitFor(() => gates.has("long job"));
    gates.get("long job")!();
    // Without the standing sink handed over at detach time, this parks forever: no collect
    // window will ever attach another one.
    await waitFor(() => decisions.length === 1);
    expect(decisions[0]).toBe("allow");
    await waitFor(() => events.length === 1);
    expect(events[0]).toMatchObject({ kind: "subagent", id, status: "completed" });
    // And its messages keep streaming to the host past the launching turn's end.
    expect(tapped.some((m) => (m.payload as { type?: string }).type === "text")).toBe(true);
  });

  it("a detached child with a queued approval is not reported as something to poll for", async () => {
    const manager = new SubagentSessionManager();
    cleanups.push(() => manager.dispose());
    const decisions: string[] = [];
    const runner = runnerOf(async function* ({ approve }) {
      const tc = withHop(toolCall({ name: "exec_command", arguments: "{}", toolCallId: "c1" }));
      decisions.push(await approve!(tc as OmniMessage<ToolCallPayload>));
      yield withHop(assistantText("child answer"));
    });
    const tool = createSubagentTool(SUB_DEF, {
      subagentRunner: runner,
      subagentSessions: manager,
    });
    // The user has not answered yet, so the request is still queued when the detach lands:
    // pendingApprovals is 1 at the moment the note is written.
    let asked = false;
    let held = true;
    const approveSpy: ApproveFn = async () => {
      asked = true;
      await waitFor(() => !held);
      return "allow";
    };
    const detach = new AbortController();
    void waitFor(() => asked).then(() => detach.abort());
    const res = await drive(
      tool,
      { prompt: "long job", yield_time_ms: 60000 },
      { ...CTX, approve: approveSpy, detachSignal: detach.signal },
    );
    expect(res.note).toContain(DETACHED_TOOL_NOTE_PREFIX);
    // The standing sink attached at detach time carries that request to the user itself, so
    // the note must not send the model off to poll for it (a run_in_background launch says
    // nothing either; only the deadline promotion, which gets no standing sink, does).
    expect(res.note).not.toContain("poll to review");
    held = false;
    await waitFor(() => decisions.length === 1);
    expect(decisions[0]).toBe("allow");
  });

  it("input_subagent fails on an id this conversation never allocated (nothing to resume)", async () => {
    const manager = new SubagentSessionManager();
    cleanups.push(() => manager.dispose());
    const input = createInputSubagentTool(SUB_INPUT_DEF, { subagentSessions: manager });
    const res = await drive(input, { subagent_id: "subagent-deadbeef" });
    expect(res.stopReason).toBe("fatal");
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
      bootstrap: async () => ({ llm: new ReplyLLM() }),
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
    // The host take is the idle path: the notice is the new task's own starting input, so it
    // carries no delivery stamp and keeps its independent turn in every render layer.
    expect(parsed!.done.delivery).toBeUndefined();
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

  it("a stopped command's notice says stopped, not failed", async () => {
    const { environment, fire } = listenerEnvironment();
    const session = new Session({
      meta: META,
      ...IMAGES,
      bootstrap: async () => ({ llm: new ReplyLLM() }),
      environment,
    });
    fire({ ...DONE_EVENT, status: "stopped", detail: "stopped by SIGTERM" });
    const text = (session.takeBackgroundNotices()[0]!.payload as TextPayload).text;
    // The line the model reads first — "Background command failed … terminated by signal
    // SIGTERM" was the whole problem.
    expect(text).toContain("Background command stopped: `sleep 1` (process_id proc-11aa22bb)");
    expect(text).toContain("stopped by SIGTERM");
    expect(text).not.toContain("failed");
  });

  it("delivers a queued notice on the next run without a host signal for running tasks", async () => {
    const { environment, fire } = listenerEnvironment();
    const llm = new ReplyLLM();
    const session = new Session({
      meta: META,
      ...IMAGES,
      bootstrap: async () => ({ llm }),
      environment,
    });
    fire(DONE_EVENT); // no listener registered: stays queued
    const streamed: OmniMessage[] = [];
    for await (const msg of session.run([userText("hi")])) streamed.push(msg);
    expect(llm.calls).toBe(1);
    const texts = llm.inputs[0]!.map((m) => (m.payload as { text?: string }).text ?? "");
    expect(texts[0]).toBe("hi");
    expect(texts[1]).toContain("[background_task_done]");
    // Engine drains are the steering delivery path — the notice joined a Task the user's
    // prompt started, so it must carry the steering stamp and never open a turn of its own.
    expect(isSteeredBackgroundNotice(texts[1]!)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Sibling background subagents survive a completion notice (issue #581)
// ---------------------------------------------------------------------------

/**
 * A runner whose every spawn is a distinct child (its own session id, so the registry and
 * the live index tell three children apart) that answers once its gate is released.
 */
function gatedRunner(gates: Map<string, () => void>): SubagentRunner {
  let spawned = 0;
  return {
    async spawn() {
      spawned += 1;
      const hop = `session-child-${String(spawned).padStart(8, "0")}`;
      const tag = <M extends OmniMessage>(msg: M): M => ({ ...msg, origin: [hop] });
      let metaSent = false;
      const handle: SubagentHandle = {
        sessionId: hop,
        takeMeta() {
          if (metaSent) return null;
          metaSent = true;
          return tag({
            timestamp: new Date().toISOString(),
            type: "session_meta",
            payload: { session_id: hop },
          } as unknown as OmniMessage);
        },
        // Typed like the contract: a round's return value is its cutoff, and these rounds
        // always run to completion.
        async *run({ messages }): AsyncGenerator<OmniMessage, null> {
          const prompt = promptOf(messages);
          await new Promise<void>((resolve) => gates.set(prompt, resolve));
          yield tag(assistantText(`answer to: ${prompt}`));
          return null;
        },
        dispose() {},
      };
      return handle;
    },
  };
}

describe("sibling background subagents survive a completion notice (issue #581)", () => {
  it("settling one child ends no sibling, on the idle path or on the steering path", async () => {
    const gates = new Map<string, () => void>();
    const dir = await mkdtemp(path.join(tmpdir(), "penguin-bg-"));
    const env = new Environment({
      workspaceDir: dir,
      toolConfig: { customTools: [SUB_DEF], mcpServers: [] },
      services: { subagentRunner: gatedRunner(gates) },
    });
    cleanups.push(async () => {
      env.dispose();
      await rm(dir, { recursive: true, force: true });
    });
    const llm = new ReplyLLM();
    const session = new Session({
      meta: META,
      ...IMAGES,
      bootstrap: async () => ({ llm }),
      environment: env,
    });
    let signaled = 0;
    session.onBackgroundNotice(() => {
      signaled += 1;
    });
    const running = () =>
      env.listBackgroundSubagents().filter((s) => s.running && s.subagentId !== null);
    const statusOf = (msg: OmniMessage): string =>
      parseBackgroundTaskDoneMessage((msg.payload as TextPayload).text)!.done.status;

    for (const prompt of ["alpha", "beta", "gamma"]) {
      const res = await runTool(env, "run_subagent", { prompt, run_in_background: true });
      expect(res.stopReason).toBe("completed");
    }
    await waitFor(() => gates.size === 3);
    expect(running()).toHaveLength(3);

    // Idle path: alpha settles while no Task runs — the host takes the notice and submits it
    // as a Task of its own, the way the server's idle-arrival signal does.
    gates.get("alpha")!();
    await waitFor(() => signaled === 1);
    const notices = session.takeBackgroundNotices();
    expect(notices).toHaveLength(1);
    expect(statusOf(notices[0]!)).toBe("completed");
    for await (const msg of session.run(notices)) void msg;
    expect(llm.calls).toBe(1);
    expect(running()).toHaveLength(2);
    expect(env.hasRunningBackgroundSubagents()).toBe(true);

    // Steering path: beta settles while a Task runs — the engine drains the notice into that
    // Task at its next boundary, and the host is never signaled.
    let released = false;
    for await (const msg of session.run([userText("how are they doing?")])) {
      void msg;
      if (!released) {
        released = true;
        gates.get("beta")!();
        await waitFor(() => session.hasPendingBackgroundNotices());
      }
    }
    expect(llm.calls).toBe(3);
    const steered = llm.inputs[2]!.map((m) => (m.payload as { text?: string }).text ?? "");
    expect(steered).toHaveLength(1);
    expect(isSteeredBackgroundNotice(steered[0]!)).toBe(true);
    expect(parseBackgroundTaskDoneMessage(steered[0]!)!.done.status).toBe("completed");
    expect(signaled).toBe(1);
    expect(running()).toHaveLength(1);
    expect(env.hasRunningBackgroundSubagents()).toBe(true);

    // The last child still ends on its own terms: completed, neither stopped nor failed.
    gates.get("gamma")!();
    await waitFor(() => signaled === 2);
    const last = session.takeBackgroundNotices();
    expect(last).toHaveLength(1);
    expect(statusOf(last[0]!)).toBe("completed");
    expect(running()).toHaveLength(0);
  });
});
