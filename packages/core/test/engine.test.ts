/**
 * context_engine integration tests (mock LLM, no API key needed).
 *
 * New protocol: a single `run(prompt, { signal, approve })` automatically drives the whole
 * ReAct loop — it consumes the LLM stream, calls `approve` immediately for each tool_call,
 * executes it via Environment when allowed, feeds the result back and continues to the next
 * turn, until some turn produces no tool_call (Task done) or is interrupted. Approval/execution
 * are within-turn interactions, and execution can overlap.
 */
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assistantText,
  emptyTokenCounts,
  imageUrlMessage,
  isCompleteModelMessage,
  partialText,
  partialToolCallOutput,
  sessionMeta,
  thinkingMessage,
  toolCall,
  toolCallOutput,
  tokenUsage,
  userText,
  withOrigin,
} from "../src/omnimessage/index.js";
import { BUILTIN_TOOL_FACTORIES } from "../src/environment/tools/registry.js";
import type { GenerativeModelParameters, LLMInterface, LLMOutcome } from "../src/interfaces.js";
import type { OmniMessage, TextPayload, ToolCallPayload } from "../src/omnimessage/index.js";
import { Environment } from "../src/environment/index.js";
import { Writer, readTrace } from "../src/trace/index.js";
import { ContextEngine, reconnectDelayMs } from "../src/engine/context-engine.js";
import { goalRoundMessage } from "../src/goal/goal-prompts.js";
import { parseUserSteeringText } from "../src/omnimessage/markers/index.js";
import { imagesToScratchpadPaths } from "../src/internal/session-support.js";
import type { ApproveFn, EnvironmentInterface, ToolPermission } from "../src/interfaces.js";

/** A real 1x1 PNG data URL: the non-vision fold actually decodes and writes it to disk. */
const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** Deterministic fake LLM: the first turn yields a tool_call, the second yields the final reply. */
class FakeLLM implements LLMInterface {
  calls = 0;
  receivedSecondInput: OmniMessage[] | null = null;

  async *streamGenerate(
    params: GenerativeModelParameters,
  ): AsyncGenerator<OmniMessage, LLMOutcome> {
    this.calls += 1;
    if (this.calls === 1) {
      yield partialText("start", "");
      yield partialText("delta", "I will create the file.");
      yield partialText("stop", "", "completed");
      yield assistantText("I will create the file.");
      yield toolCall({
        name: "exec_command",
        arguments: JSON.stringify({ cmd: "printf 'Hello, Penguin' > hello.txt" }),
        toolCallId: "call_1",
        stopReason: "completed",
      });
      yield tokenUsage(emptyTokenCounts(), {
        cache_read: 0,
        cache_write: 0,
        output: 5,
        total: 12,
      });
      return { status: "completed" };
    }
    this.receivedSecondInput = params.newMessages;
    yield assistantText("Done. Created hello.txt with the greeting.");
    yield tokenUsage(emptyTokenCounts(), {
      cache_read: 0,
      cache_write: 0,
      output: 8,
      total: 20,
    });
    return { status: "completed" };
  }
}

function execCommandToolConfig() {
  return {
    customTools: [
      {
        name: "exec_command",
        description: "Run a shell command.",
        parameters: {
          type: "object",
          properties: { cmd: { type: "string" }, workdir: { type: "string" } },
          required: ["cmd"],
        },
        permission: "rw" as const,
        maxOutputLength: 16000,
      },
    ],
    mcpServers: [],
  };
}

const isToolCall = (m: OmniMessage): boolean =>
  isCompleteModelMessage(m) && m.payload.type === "tool_call";

/** Count of text messages in the list starting with `[turn_aborted]` (flatten carry-over count). */
const turnAbortedCount = (msgs: OmniMessage[]): number =>
  msgs.filter((m) => ((m.payload as { text?: string }).text ?? "").startsWith("[turn_aborted]"))
    .length;

/** An approval callback that allows everything. */
const allowAll: ApproveFn = async () => "allow";
/** An approval callback that denies everything. */
const denyAll: ApproveFn = async () => "deny";

/** Collects all output from a run. */
async function collectRun(
  engine: ContextEngine,
  prompt: OmniMessage[],
  approve: ApproveFn,
  signal?: AbortSignal,
): Promise<OmniMessage[]> {
  const all: OmniMessage[] = [];
  for await (const msg of engine.run(prompt, {
    approve,
    ...(signal ? { signal } : {}),
  })) {
    all.push(msg);
  }
  return all;
}

/**
 * Reads a file the shell just wrote, retrying briefly until it holds `expected`.
 *
 * A tool completes when its shell process exits, which does not promise the write is visible to
 * this process yet — on Windows CI it intermittently is not, surfacing as ENOENT or stale
 * content. Retrying asserts the same exact content; it only stops the assertion racing the
 * filesystem, and a genuinely wrong write still fails one timeout later.
 */
async function readFileEventually(
  file: string,
  expected: string,
  timeoutMs = 2000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  for (;;) {
    last = await readFile(file, "utf8").catch(() => "");
    if (last === expected || Date.now() >= deadline) return last;
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** Extracts the plain archive path from the note (the path is always last before `]`). */
function recoveryPath(output: string): string | undefined {
  return output.match(/\[output archived[^:]*: ([^\]]+)\]/)?.[1];
}

describe("ContextEngine ReAct loop (mock LLM, approve callback)", () => {
  let workspace: string;
  let traces: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "penguin-ws-"));
    traces = await mkdtemp(join(tmpdir(), "penguin-tr-"));
  });

  afterEach(async () => {
    // Retries (here and in the other cleanups below): on Windows a just-killed process tree
    // releases its cwd locks asynchronously, so an immediate rm can hit EBUSY.
    await rm(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    await rm(traces, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  it("approves a tool call, writes the file, returns the final answer, traces it", async () => {
    const llm = new FakeLLM();
    const environment = new Environment({
      workspaceDir: workspace,
      toolConfig: execCommandToolConfig(),
    });
    const trace = new Writer({ tracesDir: traces, sessionId: "sess_test" });
    const engine = new ContextEngine({ llm, environment, trace });

    const collected = await collectRun(
      engine,
      [userText("Create hello.txt saying Hello, Penguin")],
      allowAll,
    );

    expect(llm.calls).toBe(2);
    expect(
      llm.receivedSecondInput!.some(
        (m) => (m.payload as { type?: string }).type === "tool_call_output",
      ),
    ).toBe(true);
    expect(await readFileEventually(join(workspace, "hello.txt"), "Hello, Penguin")).toBe(
      "Hello, Penguin",
    );

    const types = collected.map((m) => (m.payload as { type?: string }).type);
    expect(types).toContain("tool_call_output");
    // approve is a callback; context_engine emits the approval result as an approval_decision
    // event (for frontend rendering + Trace).
    expect(types).toContain("approval_decision");
    const finalTexts = collected
      .filter((m) => isCompleteModelMessage(m) && m.payload.type === "text")
      .map((m) => (m.payload as TextPayload).text);
    expect(finalTexts.some((t) => t.includes("Done"))).toBe(true);

    const recorded = await readTrace(trace.currentPath());
    const recordedTypes = recorded.map((m) => (m.payload as { type?: string }).type);
    expect(recordedTypes).toContain("tool_call");
    expect(recordedTypes).toContain("tool_call_output");
    expect(recordedTypes.some((t) => t?.startsWith("partial_"))).toBe(false);
  });

  it("lets the next Agent turn recover truncated text, keeps UI == Agent output, and preserves it after Task end", async () => {
    const NAME = "__recoverable_text_tool__";
    const source = `BEGIN\n${"detail\n".repeat(100)}FINAL ANSWER\n`;
    BUILTIN_TOOL_FACTORIES[NAME] = (definition) => ({
      name: NAME,
      definition,
      async *execute(_args, ctx) {
        yield partialToolCallOutput({
          eventType: "delta",
          output: source.slice(0, 200),
          toolCallId: ctx.toolCallId,
        });
        yield partialToolCallOutput({
          eventType: "delta",
          output: source.slice(200),
          toolCallId: ctx.toolCallId,
        });
      },
    });
    try {
      let calls = 0;
      let agentVisibleOutput = "";
      let recoveredPath = "";
      let recoveredDuringTask = "";
      const llm: LLMInterface = {
        async *streamGenerate(params): AsyncGenerator<OmniMessage, LLMOutcome> {
          calls += 1;
          if (calls === 1) {
            yield toolCall({
              name: NAME,
              arguments: "{}",
              toolCallId: "recover-call",
              stopReason: "completed",
            });
            yield tokenUsage(emptyTokenCounts(), {
              cache_read: 0,
              cache_write: 0,
              output: 1,
              total: 1,
            });
            return { status: "completed" };
          }
          const toolResult = params.newMessages.find(
            (m) => (m.payload as { type?: string }).type === "tool_call_output",
          );
          agentVisibleOutput = (toolResult?.payload as { output?: string }).output ?? "";
          recoveredPath = recoveryPath(agentVisibleOutput) ?? "";
          recoveredDuringTask = await readFile(recoveredPath, "utf8");
          yield assistantText("Recovered the final answer.");
          yield tokenUsage(emptyTokenCounts(), {
            cache_read: 0,
            cache_write: 0,
            output: 1,
            total: 2,
          });
          return { status: "completed" };
        },
      };
      const environment = new Environment({
        workspaceDir: workspace,
        toolConfig: {
          customTools: [
            { name: NAME, description: "recover", permission: "r", maxOutputLength: 40 },
          ],
          mcpServers: [],
        },
        sessionScratchpadDir: join(workspace, "session-scratchpad"),
      });
      const trace = new Writer({ tracesDir: traces, sessionId: "sess_truncated_output" });
      const engine = new ContextEngine({ llm, environment, trace });
      const all = await collectRun(engine, [userText("recover it")], allowAll);

      expect(recoveredDuringTask).toBe(source);
      const frontendComplete = all.find(
        (m) =>
          (m.payload as { type?: string }).type === "tool_call_output" &&
          (m.payload as { tool_call_id?: string }).tool_call_id === "recover-call",
      );
      expect((frontendComplete!.payload as { output: string }).output).toBe(agentVisibleOutput);
      const frontendStream = all
        .filter(
          (m) =>
            (m.payload as { type?: string }).type === "partial_tool_call_output" &&
            (m.payload as { tool_call_id?: string }).tool_call_id === "recover-call" &&
            (m.payload as { event_type?: string }).event_type === "delta",
        )
        .map((m) => (m.payload as { output?: string }).output ?? "")
        .join("");
      expect(frontendStream).toBe(agentVisibleOutput);

      const recorded = await readTrace(trace.currentPath());
      const tracedOutput = recorded.find(
        (m) =>
          (m.payload as { type?: string }).type === "tool_call_output" &&
          (m.payload as { tool_call_id?: string }).tool_call_id === "recover-call",
      );
      expect((tracedOutput!.payload as { output: string }).output).toBe(agentVisibleOutput);

      expect(await readFile(recoveredPath, "utf8")).toBe(source);
      environment.dispose();
      expect(await readFile(recoveredPath, "utf8")).toBe(source);
    } finally {
      delete BUILTIN_TOOL_FACTORIES[NAME];
    }
  });

  it("a slow tool delays the run only by its own latency: the loop adds no waits, timers, or dropped wakes", async () => {
    // Regression pin for the ci-windows timeout of the test above (goal-mode PR #66's
    // merge-ref run): on one cold Windows runner the suite-start burst of first Git-Bash
    // spawns ran ~28-36s and the test crossed the then-30s platform deadline, which looked
    // like a goal-mode hang in the run loop. The loop's actual contract, pinned here with
    // virtual tool latency instead of a real spawn (platform-neutral, deterministic): tool
    // latency flows through 1:1 — wall time ≈ latency + ε. An engine-side wait inserted
    // between turns would blow the upper bound, a dropped continuation wake would hang this
    // test into its own deadline, and a timer armed alongside the tool would trip the spies
    // (the engine's only setTimeout is the reconnect backoff, a failure-path affair).
    const TOOL_LATENCY_MS = 300;
    const EPSILON_MS = 1_000;
    const realSetTimeout = globalThis.setTimeout.bind(globalThis);
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const intervalSpy = vi.spyOn(globalThis, "setInterval");
    try {
      const llm = new FakeLLM();
      const environment: EnvironmentInterface = {
        async listTools() {
          return [];
        },
        async *executeTool({ toolCall: tc }) {
          // The injected "slow spawn" (through the pre-spy setTimeout, invisible to the spies).
          await new Promise<void>((resolve) => realSetTimeout(resolve, TOOL_LATENCY_MS));
          yield toolCallOutput({ output: "wrote hello.txt", toolCallId: tc.payload.tool_call_id });
        },
        toolPermission() {
          return "rw";
        },
      };
      const engine = new ContextEngine({ llm, environment });

      const start = performance.now();
      const collected = await collectRun(
        engine,
        [userText("Create hello.txt saying Hello, Penguin")],
        allowAll,
      );
      const elapsed = performance.now() - start;
      const timersArmed = timeoutSpy.mock.calls.length + intervalSpy.mock.calls.length;

      // The flow completed both turns, with the slow tool's output fed back and paired.
      expect(llm.calls).toBe(2);
      expect(
        llm.receivedSecondInput!.some(
          (m) => (m.payload as { type?: string }).type === "tool_call_output",
        ),
      ).toBe(true);
      expect(collected.map((m) => (m.payload as { type?: string }).type)).toContain(
        "tool_call_output",
      );
      // Latency-additive: the tool's own wait, plus scheduling slack — nothing multiplied.
      expect(elapsed).toBeGreaterThanOrEqual(TOOL_LATENCY_MS - 5);
      expect(elapsed).toBeLessThan(TOOL_LATENCY_MS + EPSILON_MS);
      // And no engine-armed wall-clock wait rode along.
      expect(timersArmed).toBe(0);
    } finally {
      timeoutSpy.mockRestore();
      intervalSpy.mockRestore();
    }
  });

  it("streams origin-tagged nested messages to the consumer but keeps them out of trace and the next-turn input", async () => {
    const NAME = "__nested_forward_tool__";
    BUILTIN_TOOL_FACTORIES[NAME] = (definition) => ({
      name: NAME,
      definition,
      async *execute(_args, ctx) {
        // Simulates run_subagent: forwards one complete tool_call_output from a child session
        // (with origin), then yields its own output.
        yield withOrigin(
          toolCallOutput({ output: "child result", toolCallId: "child_call" }),
          "sess_child",
        );
        yield partialToolCallOutput({
          eventType: "delta",
          output: "own result",
          toolCallId: ctx.toolCallId,
        });
      },
    });
    try {
      let calls = 0;
      let secondInput: OmniMessage[] | null = null;
      const llm: LLMInterface = {
        async *streamGenerate(params): AsyncGenerator<OmniMessage, LLMOutcome> {
          calls += 1;
          if (calls === 1) {
            yield toolCall({
              name: NAME,
              arguments: "{}",
              toolCallId: "p1",
              stopReason: "completed",
            });
            return { status: "completed" };
          }
          secondInput = params.newMessages;
          yield assistantText("Done");
          return { status: "completed" };
        },
      };
      const environment = new Environment({
        workspaceDir: workspace,
        toolConfig: {
          customTools: [{ name: NAME, description: "fwd", permission: "rw" }],
          mcpServers: [],
        },
      });
      const trace = new Writer({ tracesDir: traces, sessionId: "sess_fwd" });
      const engine = new ContextEngine({ llm, environment, trace });

      const all = await collectRun(engine, [userText("go")], allowAll);

      // The nested message reaches the frontend via the stream (with origin), for rendering.
      const nested = all.find((m) => m.origin?.length);
      expect(nested).toBeDefined();
      expect((nested!.payload as { output?: string }).output).toBe("child result");
      // The input fed back for the next turn contains only this level's tool output, not the
      // child session's tool_call_output (unpaired; feeding it back by mistake would be rejected).
      const secondOutputs = secondInput!.filter(
        (m) => (m.payload as { type?: string }).type === "tool_call_output",
      );
      expect(secondOutputs).toHaveLength(1);
      expect((secondOutputs[0]!.payload as { output?: string }).output).toBe("own result");
      // The parent Trace does not record the nested message (the child Session has its own Trace).
      const recorded = await readTrace(trace.currentPath());
      expect(
        recorded.some((m) => (m.payload as { output?: string }).output === "child result"),
      ).toBe(false);
    } finally {
      delete BUILTIN_TOOL_FACTORIES[NAME];
    }
  });

  it("denied approval feeds an aborted result back to the model, no file written", async () => {
    const llm = new FakeLLM();
    const environment = new Environment({
      workspaceDir: workspace,
      toolConfig: execCommandToolConfig(),
    });
    const engine = new ContextEngine({ llm, environment });

    const all = await collectRun(engine, [userText("Create hello.txt")], denyAll);

    await expect(readFile(join(workspace, "hello.txt"), "utf8")).rejects.toThrow();
    const denialOutput = llm.receivedSecondInput!.find(
      (m) => (m.payload as { type?: string }).type === "tool_call_output",
    );
    expect((denialOutput!.payload as { output: string }).output).toContain("denied");
    // A denial's stop_reason is "aborted", indicating the tool call was manually canceled.
    const deniedMsg = all.find(
      (m) =>
        (m.payload as { type?: string }).type === "tool_call_output" &&
        (m.payload as { stop_reason?: string }).stop_reason === "aborted",
    );
    expect(deniedMsg).toBeDefined();
  });

  it("engine maxTurns fallback is -1 (unlimited) when the option is omitted (direct SDK construction)", () => {
    const engine = new ContextEngine({
      llm: new FakeLLM(),
      environment: new Environment({
        workspaceDir: workspace,
        toolConfig: execCommandToolConfig(),
      }),
    });
    // Reads the fallback via a private field (white-box, only testing the fallback). The
    // SDK-construction fallback for an omitted option now matches the agent-config default
    // (defaultSystemConfig().max_turns, asserted in state.test.ts): -1 = no turn cap.
    expect((engine as unknown as { maxTurns: number }).maxTurns).toBe(-1);
  });

  it("streams the max-turns stop note before the complete text (no extra leading newline)", async () => {
    const llm: LLMInterface = {
      async *streamGenerate() {
        yield toolCall({
          name: "exec_command",
          arguments: JSON.stringify({ cmd: "true" }),
          toolCallId: "c1",
          stopReason: "completed",
        });
        // The model output completes normally -> this turn is not interrupted, so the loop can
        // advance to the next turn and trigger max_turns.
        yield tokenUsage(emptyTokenCounts(), {
          cache_read: 0,
          cache_write: 0,
          output: 1,
          total: 1,
        });
        return { status: "completed" };
      },
    };
    const environment = new Environment({
      workspaceDir: workspace,
      toolConfig: execCommandToolConfig(),
    });
    const engine = new ContextEngine({ llm, environment, maxTurns: 1 });

    const all = await collectRun(engine, [userText("go")], allowAll);
    const partials = all
      .filter((m) => (m.payload as { type?: string }).type === "partial_text")
      .map((m) => m.payload);
    const maxTurnText = "[reached max turns (1); stopping]";

    expect(partials).toMatchObject([
      { event_type: "start", text: "" },
      { event_type: "delta", text: maxTurnText },
      { event_type: "stop", text: "", stop_reason: "failed" },
    ]);
    // No more leading newline.
    expect(maxTurnText.startsWith("\n")).toBe(false);
    expect(
      all.some(
        (m) =>
          isCompleteModelMessage(m) && m.payload.type === "text" && m.payload.text === maxTurnText,
      ),
    ).toBe(true);
  });

  it("maxTurns -1 removes the cap instead of stopping before the first turn (issue #55)", async () => {
    // Two tool-call turns followed by a final text turn: with the old `0 >= -1` guard the
    // engine emitted the stop note without ever calling the LLM.
    let calls = 0;
    const llm: LLMInterface = {
      async *streamGenerate() {
        calls += 1;
        if (calls <= 2) {
          yield toolCall({
            name: "exec_command",
            arguments: JSON.stringify({ cmd: "true" }),
            toolCallId: `c${calls}`,
            stopReason: "completed",
          });
        } else {
          yield assistantText("Done");
        }
        yield tokenUsage(emptyTokenCounts(), {
          cache_read: 0,
          cache_write: 0,
          output: 1,
          total: 1,
        });
        return { status: "completed" };
      },
    };
    const environment = new Environment({
      workspaceDir: workspace,
      toolConfig: execCommandToolConfig(),
    });
    const engine = new ContextEngine({ llm, environment, maxTurns: -1 });

    const all = await collectRun(engine, [userText("go")], allowAll);
    expect(calls).toBe(3);
    const texts = all
      .filter((m) => isCompleteModelMessage(m) && m.payload.type === "text")
      .map((m) => (m.payload as TextPayload).text);
    expect(texts.some((t) => t.includes("reached max turns"))).toBe(false);
    expect(texts.some((t) => t === "Done")).toBe(true);
  });

  it("max turns with pending tool outputs carries them over so the next run pairs the tool_call (issue #33)", async () => {
    const received: OmniMessage[][] = [];
    const llm: LLMInterface = {
      async *streamGenerate(params): AsyncGenerator<OmniMessage, LLMOutcome> {
        received.push(params.newMessages);
        if (received.length === 1) {
          // Turn 1: the tool call completes normally; the tool output cannot be fed back
          // because max_turns was hit.
          yield toolCall({
            name: "exec_command",
            arguments: JSON.stringify({ cmd: "true" }),
            toolCallId: "c1",
            stopReason: "completed",
          });
          yield tokenUsage(emptyTokenCounts(), {
            cache_read: 0,
            cache_write: 0,
            output: 1,
            total: 1,
          });
          return { status: "completed" };
        }
        yield assistantText("continuing");
        return { status: "completed" };
      },
    };
    const environment = new Environment({
      workspaceDir: workspace,
      toolConfig: execCommandToolConfig(),
    });
    const engine = new ContextEngine({ llm, environment, maxTurns: 1 });

    await collectRun(engine, [userText("go")], allowAll);

    // Continuing input on the same Session: the previous turn's tool output is resent, merged
    // with the new input, as a structured carry-over (case A); since the committed tool_call now
    // has a paired output, it does not trigger the provider's unanswered-tool_use rejection.
    await collectRun(engine, [userText("continue the fix")], allowAll);
    expect(received).toHaveLength(2);
    const secondTypes = received[1]!.map((m) => (m.payload as { type?: string }).type);
    expect(secondTypes).toEqual(["tool_call_output", "text"]);
    expect((received[1]![0]!.payload as { tool_call_id?: string }).tool_call_id).toBe("c1");
    expect((received[1]![1]!.payload as TextPayload).text).toBe("continue the fix");
  });

  it("aborts before run: emits abort and carries the (wrapped) input over to the next run", async () => {
    const received: OmniMessage[][] = [];
    const llm: LLMInterface = {
      async *streamGenerate(params) {
        received.push(params.newMessages);
        yield assistantText("ok");
        yield tokenUsage(emptyTokenCounts(), {
          cache_read: 0,
          cache_write: 0,
          output: 1,
          total: 1,
        });
        return { status: "completed" };
      },
    };
    const environment = new Environment({
      workspaceDir: workspace,
      toolConfig: execCommandToolConfig(),
    });
    const engine = new ContextEngine({ llm, environment });
    const controller = new AbortController();
    controller.abort();

    const all = await collectRun(engine, [userText("go")], allowAll, controller.signal);
    // Interrupted before dispatch: emits abort, and the model is never actually called.
    expect(all.map((m) => (m.payload as { type?: string }).type)).toContain("abort");
    expect(received).toHaveLength(0);

    // Next turn: input that never made it to a Request is kept **as-is** as carry-over, and sent
    // together with the new input (trailing-input semantics; not flattened, so replay matches
    // in-process behavior).
    await collectRun(engine, [userText("next")], allowAll);
    expect(received).toHaveLength(1);
    const texts = received[0]!.map((m) => (m.payload as { text?: string }).text ?? "");
    expect(texts).toContain("go");
    expect(texts).toContain("next");
    expect(texts.join("\n")).not.toContain("[turn_aborted]");
  });

  it("downgrades a goal round's protocol in the [turn_aborted] transcript (auth exit path)", async () => {
    // An aborted/failed goal round's input rides into the next task via flatten carry-over;
    // its [goal] protocol ("the system sends the next round automatically", the file rules)
    // is stale the moment the goal ends and must not re-enter the model as live instructions.
    const goalInput = goalRoundMessage({
      objective: "fix the tests",
      goalFilePath: "/tmp/GOAL.yaml",
      round: 1,
      tokensUsed: 0,
      budget: -1,
      body: "fix the tests",
    });
    const received: OmniMessage[][] = [];
    let calls = 0;
    const llm: LLMInterface = {
      async *streamGenerate(params) {
        received.push(params.newMessages);
        if (++calls === 1) {
          yield partialText("start", "");
          yield partialText("delta", "half a thought");
          // `auth`: the one LLM status that still exits straight to the flatten path.
          return { status: "auth", errorMessage: "boom" };
        }
        yield assistantText("ok");
        yield tokenUsage(emptyTokenCounts(), {
          cache_read: 0,
          cache_write: 0,
          output: 1,
          total: 1,
        });
        return { status: "completed" };
      },
    };
    const environment = new Environment({
      workspaceDir: workspace,
      toolConfig: execCommandToolConfig(),
    });
    const engine = new ContextEngine({ llm, environment });

    await collectRun(engine, [userText(goalInput)], allowAll);
    await collectRun(engine, [userText("unrelated new task")], allowAll);

    expect(received).toHaveLength(2);
    const texts = received[1]!.map((m) => (m.payload as { text?: string }).text ?? "");
    const joined = texts.join("\n");
    // The transcript survives (interrupted-work context), the protocol does not.
    expect(joined).toContain("[turn_aborted]");
    expect(joined).toContain("goal round 1 of an ended goal run");
    expect(joined).toContain("fix the tests");
    expect(joined).not.toContain("[goal]");
    expect(joined).not.toContain("Do not modify the goal file");
    expect(joined).toContain("unrelated new task");
  });

  it("downgrades a goal round held raw in carry-over (pre-dispatch abort path)", async () => {
    // Aborted before the Request went out: the input is held AS-IS (not flattened) — without
    // the downgrade, the full [goal] block would be re-sent verbatim as current input.
    const goalInput = goalRoundMessage({
      objective: "fix the tests",
      goalFilePath: "/tmp/GOAL.yaml",
      round: 2,
      tokensUsed: 0,
      budget: -1,
      body: "fix the tests",
    });
    const received: OmniMessage[][] = [];
    const llm: LLMInterface = {
      async *streamGenerate(params) {
        received.push(params.newMessages);
        yield assistantText("ok");
        yield tokenUsage(emptyTokenCounts(), {
          cache_read: 0,
          cache_write: 0,
          output: 1,
          total: 1,
        });
        return { status: "completed" };
      },
    };
    const environment = new Environment({
      workspaceDir: workspace,
      toolConfig: execCommandToolConfig(),
    });
    const engine = new ContextEngine({ llm, environment });
    const controller = new AbortController();
    controller.abort();

    await collectRun(engine, [userText(goalInput)], allowAll, controller.signal);
    await collectRun(engine, [userText("unrelated new task")], allowAll);

    expect(received).toHaveLength(1);
    const texts = received[0]!.map((m) => (m.payload as { text?: string }).text ?? "");
    const joined = texts.join("\n");
    expect(joined).toContain("goal round 2 of an ended goal run");
    expect(joined).toContain("fix the tests");
    expect(joined).not.toContain("[goal]");
    expect(joined).toContain("unrelated new task");
  });

  it("never writes the flatten carry-over to trace (case B): synthesized carry-over is memory-only", async () => {
    let call = 0;
    const llm: LLMInterface = {
      async *streamGenerate() {
        call += 1;
        if (call === 1) {
          // The model output is interrupted mid-stream (case B): partial thinking + aborted finish.
          yield thinkingMessage("half thought", "aborted");
          return { status: "aborted" };
        }
        yield assistantText("ok");
        yield tokenUsage(emptyTokenCounts(), {
          cache_read: 0,
          cache_write: 0,
          output: 1,
          total: 1,
        });
        return { status: "completed" };
      },
    };
    const environment = new Environment({
      workspaceDir: workspace,
      toolConfig: execCommandToolConfig(),
    });
    const trace = new Writer({ tracesDir: traces, sessionId: "sess_carry_tr" });
    const engine = new ContextEngine({ llm, environment, trace });

    await collectRun(engine, [userText("first ask")], allowAll);
    // Synthesized carry-over is not written to Trace (Trace only records real messages).
    expect(turnAbortedCount(await readTrace(trace.currentPath()))).toBe(0);

    await collectRun(engine, [userText("next")], allowAll);
    // Likewise not persisted when sent: flattening is only sent to the model.
    expect(turnAbortedCount(await readTrace(trace.currentPath()))).toBe(0);
  });

  it("never writes case-A backfill placeholders to trace: pairing is re-synthesized on resume", async () => {
    const controller = new AbortController();
    let call = 0;
    const llm: LLMInterface = {
      async *streamGenerate() {
        call += 1;
        if (call === 1) {
          yield toolCall({
            name: "exec_command",
            arguments: JSON.stringify({ cmd: "true" }),
            toolCallId: "a1",
            stopReason: "completed",
          });
          yield toolCall({
            name: "exec_command",
            arguments: JSON.stringify({ cmd: "true" }),
            toolCallId: "a2",
            stopReason: "completed",
          });
          yield tokenUsage(emptyTokenCounts(), {
            cache_read: 0,
            cache_write: 0,
            output: 1,
            total: 1,
          });
          return { status: "completed" };
        }
        yield assistantText("resumed");
        return { status: "completed" };
      },
    };
    const environment = new Environment({
      workspaceDir: workspace,
      toolConfig: execCommandToolConfig(),
    });
    const trace = new Writer({ tracesDir: traces, sessionId: "sess_backfill_tr" });
    const engine = new ContextEngine({ llm, environment, trace });
    // Interrupted while approving the first tool: a1 and a2 are both committed but not
    // dispatched, so the carry-over is two interrupted-state placeholders.
    const approve: ApproveFn = async () => {
      controller.abort();
      return "allow";
    };
    await collectRun(engine, [userText("go")], approve, controller.signal);
    const placeholders = (msgs: OmniMessage[]): number =>
      msgs.filter(
        (m) => (m.payload as { output?: string }).output === "[interrupted: tool aborted by user]",
      ).length;
    // The placeholder is synthesized only in memory, never written to Trace (resume/replay
    // re-synthesizes it on demand as a pairing fallback).
    expect(placeholders(await readTrace(trace.currentPath()))).toBe(0);

    await collectRun(engine, [userText("continue")], allowAll);
    const recorded = await readTrace(trace.currentPath());
    // The backfill is sent along with the request, and is likewise never persisted.
    expect(placeholders(recorded)).toBe(0);
    expect(
      recorded.filter((m) => (m.payload as { type?: string }).type === "tool_call_output"),
    ).toHaveLength(0);
  });

  it("writes a subagent pointer event (session id only) when a direct child's session_meta arrives", async () => {
    let llmCalls = 0;
    const llm: LLMInterface = {
      async *streamGenerate() {
        llmCalls += 1;
        if (llmCalls === 1) {
          yield toolCall({ name: "spawn", arguments: "{}", toolCallId: "tc-spawn" });
          yield tokenUsage(emptyTokenCounts(), {
            cache_read: 0,
            cache_write: 0,
            output: 1,
            total: 1,
          });
          return { status: "completed" };
        }
        yield assistantText("done");
        return { status: "completed" };
      },
    };
    const childMeta = (sid: string) =>
      sessionMeta({
        session_id: sid,
        provider: "custom",
        model_id: "m-child",
        model_context_window: 1000,
        system_prompt: "sys",
        tools: [],
        agent_state: "/root/p/worker/agent_state",
        workspace: "/tmp/w",
      });
    // Custom Environment: on execution, first forwards origin-tagged child session messages
    // (child meta / child text / grandchild meta), then yields the complete output (simulates
    // run_subagent's forwarding behavior).
    const environment: EnvironmentInterface = {
      listTools: async () => [],
      toolPermission: () => undefined,
      async *executeTool(request) {
        yield withOrigin(childMeta("sess-child"), "sess-child");
        yield withOrigin(assistantText("from child"), "sess-child");
        yield withOrigin(withOrigin(childMeta("sess-grand"), "sess-grand"), "sess-child");
        yield toolCallOutput({
          output: "spawned",
          toolCallId: request.toolCall.payload.tool_call_id,
        });
      },
    };
    const trace = new Writer({ tracesDir: traces, sessionId: "sess_subagent_ptr" });
    const engine = new ContextEngine({ llm, environment, trace });
    await collectRun(engine, [userText("go")], allowAll);

    const rows = await readTrace(trace.currentPath());
    // A direct child session's (origin length 1) session_meta -> exactly one subagent pointer
    // event (recording only the Session id); a grandchild session's (origin length 2) does not
    // get a pointer, since its own child Trace records it.
    const pointers = rows.filter((m) => (m.payload as { type?: string }).type === "subagent");
    expect(pointers).toHaveLength(1);
    expect(pointers[0]!.type).toBe("event_msg");
    expect((pointers[0]!.payload as { session_id?: string }).session_id).toBe("sess-child");
    // Origin-tagged child session messages (session_meta and body alike) are never written
    // to the parent Trace.
    expect(rows.some((m) => m.origin !== undefined)).toBe(false);
  });

  it("in-run reconnect never writes the synthesized [turn_retried] to trace", async () => {
    let calls = 0;
    const inputs: OmniMessage[][] = [];
    const llm: LLMInterface = {
      async *streamGenerate(params) {
        calls += 1;
        inputs.push(params.newMessages);
        if (calls === 1) {
          yield assistantText("half", "timeout");
          return { status: "timeout" };
        }
        yield assistantText("recovered");
        yield tokenUsage(emptyTokenCounts(), {
          cache_read: 0,
          cache_write: 0,
          output: 1,
          total: 1,
        });
        return { status: "completed" };
      },
    };
    const environment = new Environment({
      workspaceDir: workspace,
      toolConfig: execCommandToolConfig(),
    });
    const trace = new Writer({ tracesDir: traces, sessionId: "sess_retry_tr" });
    const engine = new ContextEngine({
      llm,
      environment,
      trace,
      maxReconnects: 1,
      reconnectBackoffMs: 1,
    });

    await collectRun(engine, [userText("go")], allowAll);
    expect(calls).toBe(2);
    // Retry = original input + [turn_retried] (carrying the partial text).
    expect((inputs[1]![1]!.payload as { text?: string }).text ?? "").toContain("[turn_retried]");
    // The synthesized message is only sent to the model: Trace has no [turn_retried] /
    // [turn_aborted]; the original input is written only on its first occurrence.
    const recorded = await readTrace(trace.currentPath());
    expect(turnAbortedCount(recorded)).toBe(0);
    expect(
      recorded.some((m) =>
        ((m.payload as { text?: string }).text ?? "").startsWith("[turn_retried]"),
      ),
    ).toBe(false);
    expect(recorded.filter((m) => (m.payload as { text?: string }).text === "go")).toHaveLength(1);
  });

  it("forwards RunOptions.thinkingLevel to every LLM request of the run (reconnects included); compaction keeps the default", async () => {
    const levels: (string | undefined)[] = [];
    let calls = 0;
    const llm: LLMInterface = {
      async *streamGenerate(params) {
        calls += 1;
        levels.push(params.thinkingLevel);
        if (calls === 1) {
          // First attempt drops: the reconnect retry must carry the same per-turn level.
          yield assistantText("half", "timeout");
          return { status: "timeout" };
        }
        if (calls === 2) {
          // Retry completes with usage above the compaction threshold → a Task-boundary
          // summarize compaction issues one more request (the engine's, not this run's turn):
          // it must NOT carry the per-turn override.
          yield assistantText("recovered");
          yield tokenUsage(emptyTokenCounts(), {
            cache_read: 0,
            cache_write: 0,
            output: 1,
            total: 100,
          });
          return { status: "completed" };
        }
        yield assistantText("<summary>s</summary>");
        yield tokenUsage(emptyTokenCounts(), {
          cache_read: 0,
          cache_write: 0,
          output: 1,
          total: 5,
        });
        return { status: "completed" };
      },
    };
    const environment = new Environment({
      workspaceDir: workspace,
      toolConfig: execCommandToolConfig(),
    });
    const engine = new ContextEngine({
      llm,
      environment,
      maxReconnects: 1,
      reconnectBackoffMs: 1,
      createLLM: () => llm,
      compaction: { maxContextLength: 10, maxSessionTurns: -1, mode: "summarize", prompt: "SUM" },
    });

    const all: OmniMessage[] = [];
    for await (const msg of engine.run([userText("go")], {
      approve: allowAll,
      thinkingLevel: "high",
    })) {
      all.push(msg);
    }
    expect(calls).toBe(3);
    // Turn attempt + reconnect retry carry the run's level; the compaction request does not.
    expect(levels).toEqual(["high", "high", undefined]);
  });
});

describe("ContextEngine async/incremental tool calls (overlapping execution)", () => {
  let workspace: string;
  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "penguin-ws2-"));
  });
  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  it("emits both tool calls in one round; second is approved while the first executes; outputs come back in completion order", async () => {
    // The first turn yields two tool_calls; the second yields the final reply.
    const llm: LLMInterface = {
      calls: 0,
      async *streamGenerate(this: { calls: number }) {
        this.calls += 1;
        if (this.calls === 1) {
          // First tool: slow (sleep 0.4s). Second tool: fast.
          yield toolCall({
            name: "exec_command",
            arguments: JSON.stringify({ cmd: "sleep 0.4; printf one > a.txt" }),
            toolCallId: "t1",
            stopReason: "completed",
          });
          yield toolCall({
            name: "exec_command",
            arguments: JSON.stringify({ cmd: "printf two > b.txt" }),
            toolCallId: "t2",
            stopReason: "completed",
          });
          // The model output completes normally -> this turn is not interrupted, results are
          // fed back into the next turn.
          yield tokenUsage(emptyTokenCounts(), {
            cache_read: 0,
            cache_write: 0,
            output: 1,
            total: 1,
          });
          return { status: "completed" };
        }
        yield assistantText("both done");
        yield tokenUsage(emptyTokenCounts(), {
          cache_read: 0,
          cache_write: 0,
          output: 1,
          total: 1,
        });
        return { status: "completed" };
      },
    } as LLMInterface & { calls: number };

    const environment = new Environment({
      workspaceDir: workspace,
      toolConfig: execCommandToolConfig(),
    });
    const engine = new ContextEngine({ llm, environment });

    // Record approval order and timestamps to prove the second tool enters approval while the
    // first is still executing (execution can overlap).
    const approvedAt: Record<string, number> = {};
    const firstCompleteAt: Record<string, number> = {};
    const start = Date.now();
    const approve: ApproveFn = async (tc) => {
      approvedAt[tc.payload.tool_call_id] = Date.now() - start;
      return "allow";
    };

    const all: OmniMessage[] = [];
    for await (const msg of engine.run([userText("go")], { approve })) {
      all.push(msg);
      if (isCompleteModelMessage(msg) && msg.payload.type === "tool_call_output") {
        const id = (msg.payload as { tool_call_id: string }).tool_call_id;
        if (firstCompleteAt[id] === undefined) firstCompleteAt[id] = Date.now() - start;
      }
    }

    // Both tools were approved.
    expect(approvedAt["t1"]).toBeDefined();
    expect(approvedAt["t2"]).toBeDefined();
    // The second tool's approval happens before the first tool's execution completes (the slow
    // command has not finished yet) -- i.e., execution does not block the next approval.
    expect(approvedAt["t2"]!).toBeLessThan(firstCompleteAt["t1"] ?? Infinity);
    // The fast b.txt finishes first, the slow a.txt finishes later (outputs in completion order).
    // POSIX only: on Windows a cold Git-Bash spawn costs 1-2s, which can swamp the 400ms sleep
    // delta that makes t1 "the slow one" — CI has seen the two complete within 5ms — so the
    // relative completion order is not controllable there. The overlap assertion above and the
    // file contents below still run on Windows.
    if (process.platform !== "win32") {
      expect(firstCompleteAt["t2"]!).toBeLessThan(firstCompleteAt["t1"]!);
    }

    expect(await readFileEventually(join(workspace, "a.txt"), "one")).toBe("one");
    expect(await readFileEventually(join(workspace, "b.txt"), "two")).toBe("two");
    // Both tool outputs are fed back into the second turn, producing the final reply.
    expect(
      all.some(
        (m) =>
          isCompleteModelMessage(m) && m.payload.type === "text" && m.payload.text === "both done",
      ),
    ).toBe(true);
  });

  it("collects all tool outputs (count matches tool calls) before the next round", async () => {
    const llm = {
      calls: 0,
      async *streamGenerate(this: { calls: number }, params) {
        this.calls += 1;
        if (this.calls === 1) {
          yield toolCall({
            name: "exec_command",
            arguments: JSON.stringify({ cmd: "printf x" }),
            toolCallId: "u1",
            stopReason: "completed",
          });
          yield toolCall({
            name: "exec_command",
            arguments: JSON.stringify({ cmd: "printf y" }),
            toolCallId: "u2",
            stopReason: "completed",
          });
          yield tokenUsage(emptyTokenCounts(), {
            cache_read: 0,
            cache_write: 0,
            output: 1,
            total: 1,
          });
          return { status: "completed" };
        }
        // The second turn receives two tool_call_outputs.
        const outputs = params.newMessages.filter(
          (m) => (m.payload as { type?: string }).type === "tool_call_output",
        );
        expect(outputs).toHaveLength(2);
        yield assistantText("ok");
        yield tokenUsage(emptyTokenCounts(), {
          cache_read: 0,
          cache_write: 0,
          output: 1,
          total: 1,
        });
        return { status: "completed" };
      },
    } as LLMInterface & { calls: number };

    const environment = new Environment({
      workspaceDir: workspace,
      toolConfig: execCommandToolConfig(),
    });
    const engine = new ContextEngine({ llm, environment });

    const all: OmniMessage[] = [];
    for await (const msg of engine.run([userText("go")], { approve: allowAll })) {
      all.push(msg);
    }
    const completeOutputs = all.filter(
      (m) => isCompleteModelMessage(m) && m.payload.type === "tool_call_output",
    );
    expect(completeOutputs).toHaveLength(2);
    // The second turn did happen (otherwise the outputs assertion inside streamGenerate above
    // would never run), and the "ok" it produces appears in the output stream.
    expect(llm.calls).toBe(2);
    expect(
      all.some(
        (m) => isCompleteModelMessage(m) && m.payload.type === "text" && m.payload.text === "ok",
      ),
    ).toBe(true);
  });
});

describe("ContextEngine tool execution resilience", () => {
  let workspace: string;
  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "penguin-ws4-"));
  });
  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  it("feeds a failed tool output back and keeps tool_use/result paired (Environment converges errors, never throws)", async () => {
    // The Environment converges the error into one complete tool_call_output (never throws);
    // verify the engine feeds it back normally.
    const failingEnv: EnvironmentInterface = {
      async listTools() {
        return [];
      },
      toolPermission(): ToolPermission | undefined {
        return "rw";
      },
      async *executeTool(request) {
        const id = request.toolCall.payload.tool_call_id;
        yield toolCallOutput({
          output: "[tool error] boom",
          toolCallId: id,
          stopReason: "failed",
        });
      },
    };
    const llm: LLMInterface = {
      calls: 0,
      async *streamGenerate(this: { calls: number }, params) {
        this.calls += 1;
        const usage = () =>
          tokenUsage(emptyTokenCounts(), {
            cache_read: 0,
            cache_write: 0,
            output: 1,
            total: 1,
          });
        if (this.calls === 1) {
          yield toolCall({
            name: "exec_command",
            arguments: JSON.stringify({ cmd: "x" }),
            toolCallId: "e1",
            stopReason: "completed",
          });
          yield usage(); // The model output completes normally.
          return { status: "completed" };
        }
        // Second turn: must receive one tool_call_output (the failure reply), keeping the pairing.
        const outputs = params.newMessages.filter(
          (m) => (m.payload as { type?: string }).type === "tool_call_output",
        );
        expect(outputs).toHaveLength(1);
        expect((outputs[0]!.payload as { output: string }).output).toContain("boom");
        yield assistantText("recovered");
        yield usage();
        return { status: "completed" };
      },
    } as LLMInterface & { calls: number };

    const engine = new ContextEngine({ llm, environment: failingEnv });
    const all: OmniMessage[] = [];
    for await (const msg of engine.run([userText("go")], { approve: allowAll })) {
      all.push(msg);
    }
    // A failed failure output was produced, and the Task normally advanced to the second turn.
    const failed = all.find(
      (m) =>
        (m.payload as { type?: string }).type === "tool_call_output" &&
        (m.payload as { stop_reason?: string }).stop_reason === "failed",
    );
    expect(failed).toBeDefined();
    expect(
      all.some(
        (m) =>
          isCompleteModelMessage(m) && m.payload.type === "text" && m.payload.text === "recovered",
      ),
    ).toBe(true);
  });

  it("converts a throwing executeTool (contract-violating custom environment) into a failed tool_call_output", async () => {
    // EnvironmentInterface's contract says it never throws, but a custom implementation can be
    // injected via the public API: a contract-violating exception must be converged by the
    // engine's boundary safety net into a failed output (keeping tool_use/result paired), and
    // must never become an unhandled rejection.
    const throwingEnv: EnvironmentInterface = {
      async listTools() {
        return [];
      },
      toolPermission(): ToolPermission | undefined {
        return "rw";
      },
      // eslint-disable-next-line require-yield
      async *executeTool(): AsyncGenerator<OmniMessage> {
        throw new Error("custom env exploded");
      },
    };
    const llm: LLMInterface = {
      calls: 0,
      async *streamGenerate(this: { calls: number }, params) {
        this.calls += 1;
        const usage = () =>
          tokenUsage(emptyTokenCounts(), {
            cache_read: 0,
            cache_write: 0,
            output: 1,
            total: 1,
          });
        if (this.calls === 1) {
          yield toolCall({
            name: "exec_command",
            arguments: JSON.stringify({ cmd: "x" }),
            toolCallId: "t1",
            stopReason: "completed",
          });
          yield usage();
          return { status: "completed" };
        }
        // Second turn: the contract-violating exception has been converged into a failed
        // tool_call_output fed back, so the pairing is intact.
        const outputs = params.newMessages.filter(
          (m) => (m.payload as { type?: string }).type === "tool_call_output",
        );
        expect(outputs).toHaveLength(1);
        expect((outputs[0]!.payload as { output: string }).output).toContain("custom env exploded");
        expect((outputs[0]!.payload as { stop_reason?: string }).stop_reason).toBe("failed");
        yield assistantText("survived");
        yield usage();
        return { status: "completed" };
      },
    } as LLMInterface & { calls: number };

    const engine = new ContextEngine({ llm, environment: throwingEnv });
    const all: OmniMessage[] = [];
    for await (const msg of engine.run([userText("go")], { approve: allowAll })) {
      all.push(msg);
    }
    expect(
      all.some(
        (m) =>
          isCompleteModelMessage(m) && m.payload.type === "text" && m.payload.text === "survived",
      ),
    ).toBe(true);
  });

  it("treats a throwing approve callback as deny instead of letting the exception escape run", async () => {
    const llm: LLMInterface = {
      calls: 0,
      async *streamGenerate(this: { calls: number }, params) {
        this.calls += 1;
        const usage = () =>
          tokenUsage(emptyTokenCounts(), {
            cache_read: 0,
            cache_write: 0,
            output: 1,
            total: 1,
          });
        if (this.calls === 1) {
          yield toolCall({
            name: "exec_command",
            arguments: JSON.stringify({ cmd: "x" }),
            toolCallId: "t1",
            stopReason: "completed",
          });
          yield usage();
          return { status: "completed" };
        }
        // Second turn: the approval exception is converged to deny, feeding back one aborted
        // output, keeping the pairing intact.
        const outputs = params.newMessages.filter(
          (m) => (m.payload as { type?: string }).type === "tool_call_output",
        );
        expect(outputs).toHaveLength(1);
        expect((outputs[0]!.payload as { stop_reason?: string }).stop_reason).toBe("aborted");
        yield assistantText("done");
        yield usage();
        return { status: "completed" };
      },
    } as LLMInterface & { calls: number };

    const engine = new ContextEngine({
      llm,
      environment: new Environment({
        workspaceDir: workspace,
        toolConfig: execCommandToolConfig(),
      }),
    });
    const all: OmniMessage[] = [];
    for await (const msg of engine.run([userText("go")], {
      approve: async () => {
        throw new Error("approval channel closed");
      },
    })) {
      all.push(msg);
    }
    const denied = all.find(
      (m) =>
        (m.payload as { type?: string }).type === "approval_decision" &&
        (m.payload as { decision?: string }).decision === "deny",
    );
    expect(denied).toBeDefined();
    expect(
      all.some(
        (m) => isCompleteModelMessage(m) && m.payload.type === "text" && m.payload.text === "done",
      ),
    ).toBe(true);
  });
});

describe("ContextEngine abort during execution", () => {
  let workspace: string;
  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "penguin-ws3-"));
  });
  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  it("aborting a long-running tool ends the turn, emits abort, and carries tool results over (model output completed)", async () => {
    const received: OmniMessage[][] = [];
    let call = 0;
    const llm: LLMInterface = {
      async *streamGenerate(params) {
        received.push(params.newMessages);
        call += 1;
        if (call === 1) {
          yield toolCall({
            name: "exec_command",
            arguments: JSON.stringify({ cmd: "sleep 5" }),
            toolCallId: "slow",
            stopReason: "completed",
          });
          // Model output completed (outcome=completed) -> AgentHub has committed this turn
          // including the tool_call.
          yield tokenUsage(emptyTokenCounts(), {
            cache_read: 0,
            cache_write: 0,
            output: 1,
            total: 1,
          });
          return { status: "completed" };
        }
        yield assistantText("resumed");
        yield tokenUsage(emptyTokenCounts(), {
          cache_read: 0,
          cache_write: 0,
          output: 1,
          total: 1,
        });
        return { status: "completed" };
      },
    };
    const environment = new Environment({
      workspaceDir: workspace,
      toolConfig: execCommandToolConfig(),
    });
    const engine = new ContextEngine({ llm, environment });
    const controller = new AbortController();
    const startedAt = Date.now();
    setTimeout(() => controller.abort(), 200);

    const all: OmniMessage[] = [];
    for await (const msg of engine.run([userText("go")], {
      approve: allowAll,
      signal: controller.signal,
    })) {
      all.push(msg);
    }
    const elapsed = Date.now() - startedAt;

    expect(elapsed).toBeLessThan(3000); // Did not wait the full 5s.
    expect(all.map((m) => (m.payload as { type?: string }).type)).toContain("abort");

    // Case A: model output has completed -> the interrupted tool's result is backfilled as a
    // structured tool_call_output, pairing with the already-committed tool_call.
    await collectRun(engine, [userText("continue")], allowAll);
    expect(received).toHaveLength(2);
    const out = received[1]!.find(
      (m) => (m.payload as { type?: string }).type === "tool_call_output",
    );
    expect(out).toBeDefined();
    expect((out!.payload as { tool_call_id?: string }).tool_call_id).toBe("slow");
    // Case A must be a structured backfill and must **not** be flattened into [turn_aborted]
    // (otherwise the already-committed tool_call would lose its pairing).
    const carriedText = received[1]!
      .map((m) => (m.payload as { text?: string }).text ?? "")
      .join("");
    expect(carriedText).not.toContain("[turn_aborted]");
  });

  it("case A backfills outputs for committed-but-undispatched tool_calls (preserves pairing)", async () => {
    const received: OmniMessage[][] = [];
    const controller = new AbortController();
    let call = 0;
    const llm: LLMInterface = {
      async *streamGenerate(params) {
        received.push(params.newMessages);
        call += 1;
        if (call === 1) {
          // Two real tool_calls + token_usage: AgentHub commits this turn including both
          // a1 and a2 tool_calls.
          yield toolCall({
            name: "exec_command",
            arguments: JSON.stringify({ cmd: "true" }),
            toolCallId: "a1",
            stopReason: "completed",
          });
          yield toolCall({
            name: "exec_command",
            arguments: JSON.stringify({ cmd: "true" }),
            toolCallId: "a2",
            stopReason: "completed",
          });
          yield tokenUsage(emptyTokenCounts(), {
            cache_read: 0,
            cache_write: 0,
            output: 1,
            total: 1,
          });
          return { status: "completed" };
        }
        yield assistantText("resumed");
        yield tokenUsage(emptyTokenCounts(), {
          cache_read: 0,
          cache_write: 0,
          output: 1,
          total: 1,
        });
        return { status: "completed" };
      },
    };
    const environment = new Environment({
      workspaceDir: workspace,
      toolConfig: execCommandToolConfig(),
    });
    const engine = new ContextEngine({ llm, environment });
    // Interrupted immediately while approving the first tool: after a1's approval, signal is
    // already aborted -> neither a1 nor a2 is dispatched, but both have been committed by AgentHub.
    let approvals = 0;
    const approve: ApproveFn = async () => {
      approvals += 1;
      if (approvals === 1) controller.abort();
      return "allow";
    };

    const all = await collectRun(engine, [userText("go")], approve, controller.signal);
    expect(all.map((m) => (m.payload as { type?: string }).type)).toContain("abort");

    // Next run: case A's structured carry-over must backfill paired outputs for both a1 and a2
    // (the undispatched a2 gets an interrupted-state placeholder).
    await collectRun(engine, [userText("continue")], allowAll);
    const ids = received[1]!
      .filter((m) => (m.payload as { type?: string }).type === "tool_call_output")
      .map((m) => (m.payload as { tool_call_id?: string }).tool_call_id);
    expect(ids).toContain("a1");
    expect(ids).toContain("a2");
  });
});

describe("ContextEngine LLM timeout / network interruption (PRN-012)", () => {
  let workspace: string;
  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "penguin-ws4-"));
  });
  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  it("auto-retries on LLM timeout: original input + [turn_retried] carrying partial products", async () => {
    let calls = 0;
    const inputs: OmniMessage[][] = [];
    const llm: LLMInterface = {
      async *streamGenerate(params) {
        calls += 1;
        inputs.push(params.newMessages);
        if (calls === 1) {
          // Timeout/network drop: produces partial text and ends without a token_usage,
          // returning timeout.
          yield partialText("start");
          yield partialText("delta", "thinking...");
          yield partialText("stop", "", "timeout");
          yield assistantText("thinking...", "timeout");
          return { status: "timeout" };
        }
        // Retry succeeds: completes normally.
        yield assistantText("done");
        yield tokenUsage(emptyTokenCounts(), {
          cache_read: 0,
          cache_write: 0,
          output: 1,
          total: 1,
        });
        return { status: "completed" };
      },
    };
    const environment = new Environment({
      workspaceDir: workspace,
      toolConfig: execCommandToolConfig(),
    });
    const engine = new ContextEngine({
      llm,
      environment,
      maxReconnects: 2,
      reconnectBackoffMs: 0,
    });

    const all = await collectRun(engine, [userText("go")], allowAll);

    expect(calls).toBe(2); // Initial timeout -> auto-retries once within the same run and succeeds.
    // Retry = original input kept as-is + one [turn_retried] carrying the partial products
    // already produced (not [turn_aborted], to avoid the model mistaking it for a user interrupt).
    expect(inputs[1]).toHaveLength(2);
    expect(inputs[1]![0]).toEqual(inputs[0]![0]);
    const retried = (inputs[1]![1]!.payload as { text?: string }).text ?? "";
    expect(retried).toContain("[turn_retried]");
    expect(retried).toContain("[text]thinking...[/text]");
    expect(retried).not.toContain("[turn_aborted]");
    // The final reply is produced, with no abort throughout.
    expect(
      all.some(
        (m) => isCompleteModelMessage(m) && m.payload.type === "text" && m.payload.text === "done",
      ),
    ).toBe(true);
    expect(all.map((m) => (m.payload as { type?: string }).type)).not.toContain("abort");
  });

  it("skips a malformed (never-committed) tool_call: no dispatch, no paired output", async () => {
    // A tool_call produced by an interrupted finish (stop_reason not completed) is never
    // committed into history by AgentHub: the engine does not dispatch it for execution, does
    // not add it to this turn's ledger, and does not backfill a paired output; the malformed
    // turn is cleaned up by reconnect.
    let calls = 0;
    const inputs: OmniMessage[][] = [];
    const llm: LLMInterface = {
      async *streamGenerate(params) {
        calls += 1;
        inputs.push(params.newMessages);
        if (calls === 1) {
          yield toolCall({
            name: "exec_command",
            arguments: '{"cmd": "ec',
            toolCallId: "tc-broken",
            stopReason: "malformed",
          });
          return { status: "malformed", errorMessage: "incomplete stream" };
        }
        yield assistantText("done");
        yield tokenUsage(emptyTokenCounts(), {
          cache_read: 0,
          cache_write: 0,
          output: 1,
          total: 1,
        });
        return { status: "completed" };
      },
    };
    const environment = new Environment({
      workspaceDir: workspace,
      toolConfig: execCommandToolConfig(),
    });
    const engine = new ContextEngine({ llm, environment, maxReconnects: 1, reconnectBackoffMs: 0 });

    const all = await collectRun(engine, [userText("go")], allowAll);

    // The reconnect retry succeeds, with no abort throughout.
    expect(calls).toBe(2);
    expect(all.map((m) => (m.payload as { type?: string }).type)).not.toContain("abort");

    // No output pointing to that tool_call is produced; the tool is also never approved/executed.
    const paired = all.find(
      (m) =>
        isCompleteModelMessage(m) &&
        m.payload.type === "tool_call_output" &&
        m.payload.tool_call_id === "tc-broken",
    );
    expect(paired).toBeUndefined();
    expect(all.map((m) => (m.payload as { type?: string }).type)).not.toContain(
      "approval_decision",
    );

    // The retry resends the original input as-is; the half-formed tool_call is discarded
    // entirely and does not appear in the retry input in any form.
    expect(inputs[1]).toEqual(inputs[0]);
    const retryText = (inputs[1]![0]!.payload as { text?: string }).text ?? "";
    expect(retryText).toBe("go");
  });

  it("auto-retries on LLM malformed: original input + [turn_retried] carrying partial products", async () => {
    let calls = 0;
    const inputs: OmniMessage[][] = [];
    const llm: LLMInterface = {
      async *streamGenerate(params) {
        calls += 1;
        inputs.push(params.newMessages);
        if (calls === 1) {
          yield partialText("start");
          yield partialText("delta", "partial json response");
          yield partialText("stop", "", "malformed");
          yield assistantText("partial json response", "malformed");
          return {
            status: "malformed",
            message: "Unexpected token < in JSON at position 0",
          };
        }
        yield assistantText("done");
        yield tokenUsage(emptyTokenCounts(), {
          cache_read: 0,
          cache_write: 0,
          output: 1,
          total: 1,
        });
        return { status: "completed" };
      },
    };
    const environment = new Environment({
      workspaceDir: workspace,
      toolConfig: execCommandToolConfig(),
    });
    const engine = new ContextEngine({
      llm,
      environment,
      maxReconnects: 1,
      reconnectBackoffMs: 0,
    });

    const all = await collectRun(engine, [userText("go")], allowAll);

    expect(calls).toBe(2);
    // The malformed attempt never entered AgentHub history: the original input is resent,
    // plus [turn_retried] carrying the partial products already produced.
    expect(inputs[1]).toHaveLength(2);
    expect(inputs[1]![0]).toEqual(inputs[0]![0]);
    const retried = (inputs[1]![1]!.payload as { text?: string }).text ?? "";
    expect(retried).toContain("[turn_retried]");
    expect(retried).toContain("partial json response");
    expect(retried).not.toContain("[turn_aborted]");
    expect(
      all.some(
        (m) => isCompleteModelMessage(m) && m.payload.type === "text" && m.payload.text === "done",
      ),
    ).toBe(true);
    expect(all.map((m) => (m.payload as { type?: string }).type)).not.toContain("abort");
  });

  it("emits abort and carries the original input over when reconnect retries are exhausted", async () => {
    let calls = 0;
    const inputs: OmniMessage[][] = [];
    const llm: LLMInterface = {
      async *streamGenerate(params) {
        calls += 1;
        inputs.push(params.newMessages);
        yield assistantText("partial...", "timeout");
        return { status: "timeout" }; // Always needs a reconnect.
      },
    };
    const environment = new Environment({
      workspaceDir: workspace,
      toolConfig: execCommandToolConfig(),
    });
    const engine = new ContextEngine({
      llm,
      environment,
      maxReconnects: 1,
      reconnectBackoffMs: 0,
    });

    const all = await collectRun(engine, [userText("go")], allowAll);
    expect(calls).toBe(2); // Initial attempt + maxReconnects(1) retries.
    const abort = all.find((m) => (m.payload as { type?: string }).type === "abort");
    expect(abort).toBeDefined();
    expect((abort!.payload as { reason?: string }).reason).toContain("reconnect failed");

    // carry-over = original input + [turn_retried] (accumulating partial products from both
    // failed attempts): the next run resends it merged with the new input, without producing
    // [turn_aborted].
    await collectRun(engine, [userText("next")], allowAll);
    const nextRunTexts = inputs[2]!.map((m) => (m.payload as { text?: string }).text ?? "");
    expect(nextRunTexts).toHaveLength(3);
    expect(nextRunTexts[0]).toBe("go");
    expect(nextRunTexts[1]).toContain("[turn_retried]");
    expect(nextRunTexts[1]).toContain("partial...");
    expect(nextRunTexts[2]).toBe("next");
    expect(nextRunTexts.join("\n")).not.toContain("[turn_aborted]");
  });

  it("a failed outcome retries like a timeout, then converges to a graceful abort (run does not throw)", async () => {
    let calls = 0;
    const inputs: OmniMessage[][] = [];
    const llm: LLMInterface = {
      // The LLM must never throw an exception at the engine: an error resolves by returning
      // a failed outcome after closing the structure. `failed` is still the honest
      // classification for a parameter error — it is simply retried anyway, because the
      // classifier cannot reliably tell a permanent 4xx from a gateway's transient one.
      // eslint-disable-next-line require-yield
      async *streamGenerate(params) {
        calls += 1;
        inputs.push(params.newMessages);
        return { status: "failed", errorMessage: "400 unknown parameter: max_output_tokens" };
      },
    };
    const environment = new Environment({
      workspaceDir: workspace,
      toolConfig: execCommandToolConfig(),
    });
    const engine = new ContextEngine({
      llm,
      environment,
      maxReconnects: 2,
      reconnectBackoffMs: 0,
    });

    // Must not throw; should gracefully converge to an abort once the ladder is spent.
    const all = await collectRun(engine, [userText("go")], allowAll);
    expect(calls).toBe(3); // initial attempt + maxReconnects(2): `failed` takes the ladder now.
    const abort = all.find((m) => (m.payload as { type?: string }).type === "abort");
    expect(abort).toBeDefined();
    // Asserted whole, not by fragments: this string is shown verbatim in the error panel and
    // the CLI and is persisted as the error message, so its grammar is part of the contract.
    const reason = (abort!.payload as { reason?: string }).reason ?? "";
    expect(reason).toBe(
      "llm request failed after 2 retries: 400 unknown parameter: max_output_tokens",
    );

    // The spent turn's input is stashed as carry-over; the next run (attempt index 3, after
    // this run's three) resends it merged with the new input.
    await collectRun(engine, [userText("next")], allowAll);
    const text = inputs[3]!.map((m) => (m.payload as { text?: string }).text ?? "").join("\n");
    expect(text).toContain("go");
    expect(text).toContain("next");
  });

  it("a failed request that succeeds on retry never reaches the user as an error", async () => {
    // The point of retrying `failed`: the classifier is an allowlist, so a transient gateway
    // fault phrased its own way ("Upstream HTTP/2 stream failed") lands here. It used to kill
    // the turn; now the turn simply completes.
    let calls = 0;
    const llm: LLMInterface = {
      async *streamGenerate() {
        calls += 1;
        if (calls === 1) {
          return {
            status: "failed" as const,
            message: "Upstream HTTP/2 stream failed (upstream_http2_stream_error)",
          };
        }
        yield assistantText("recovered");
        return { status: "completed" as const };
      },
    };
    const engine = new ContextEngine({
      llm,
      environment: new Environment({
        workspaceDir: workspace,
        toolConfig: execCommandToolConfig(),
      }),
      reconnectBackoffMs: 0,
    });
    const all = await collectRun(engine, [userText("go")], allowAll);
    expect(calls).toBe(2);
    expect(all.find((m) => (m.payload as { type?: string }).type === "abort")).toBeUndefined();
    // The failure is still classified `failed` on the wire — the retry is a policy decision,
    // not a relabelling, so observability still sees a real failure rather than a "timeout".
    const ends = all.filter((m) => (m.payload as { type?: string }).type === "request_end");
    expect(ends.map((m) => (m.payload as { status?: string }).status)).toEqual([
      "failed",
      "completed",
    ]);
    // ...and it announces its retry wait like any other retryable failure, so the frontend
    // countdown works for it too.
    expect((ends[0]!.payload as { retry_in_ms?: number }).retry_in_ms).toBeGreaterThanOrEqual(0);
  });

  it("auth is the only LLM status that stops the run: no retry, request_end carries status auth", async () => {
    let calls = 0;
    const llm: LLMInterface = {
      // GenerativeModel classifies a 401/invalid_api_key as status "auth" (see
      // llm.test.ts); the engine must stop directly — the auth branch is the second belt
      // keeping a dead credential out of the retry loop (the classifier is the first).
      // Every other failure, `failed` included, takes the ladder instead.
      // eslint-disable-next-line require-yield
      async *streamGenerate() {
        calls += 1;
        return { status: "auth", errorMessage: "401 invalid x-api-key" };
      },
    };
    const environment = new Environment({
      workspaceDir: workspace,
      toolConfig: execCommandToolConfig(),
    });
    const engine = new ContextEngine({ llm, environment, reconnectBackoffMs: 1 });

    const all = await collectRun(engine, [userText("go")], allowAll);
    expect(calls).toBe(1); // A rejected credential cannot be retried into working.
    // The request's own terminal status is the host signal (streams to the web).
    const end = all.find((m) => (m.payload as { type?: string }).type === "request_end");
    expect((end!.payload as { status?: string }).status).toBe("auth");
    expect((end!.payload as { error_message?: string }).error_message).toBe(
      "401 invalid x-api-key",
    );
    // No planned retry is announced for a terminal failure.
    expect((end!.payload as { retry_in_ms?: number }).retry_in_ms).toBeUndefined();
    const abort = all.find((m) => (m.payload as { type?: string }).type === "abort");
    expect(abort).toBeDefined();
    expect((abort!.payload as { reason?: string }).reason).toContain("llm request error");
  });

  it("a bare 403 (classified failed) retries within the default cap and succeeds", async () => {
    let calls = 0;
    const llm: LLMInterface = {
      async *streamGenerate() {
        calls += 1;
        // Two provider 403 rejections (GenerativeModel labels them failed — there is no
        // quota/message heuristic anymore), then success: every non-auth failure rides
        // the ladder, and attempt 3 is within the default cap of 5.
        if (calls <= 2) return { status: "failed", errorMessage: "403 forbidden" };
        yield assistantText("recovered");
        yield tokenUsage(emptyTokenCounts(), {
          cache_read: 0,
          cache_write: 0,
          output: 1,
          total: 1,
        });
        return { status: "completed" };
      },
    };
    const environment = new Environment({
      workspaceDir: workspace,
      toolConfig: execCommandToolConfig(),
    });
    const engine = new ContextEngine({ llm, environment, reconnectBackoffMs: 1 });

    const all = await collectRun(engine, [userText("go")], allowAll);
    expect(calls).toBe(3);
    expect(
      all.some(
        (m) =>
          isCompleteModelMessage(m) && m.payload.type === "text" && m.payload.text === "recovered",
      ),
    ).toBe(true);
    expect(all.map((m) => (m.payload as { type?: string }).type)).not.toContain("abort");
  });

  it("default reconnect cap is 5: the exhaustion abort message says so", async () => {
    let calls = 0;
    const llm: LLMInterface = {
      // eslint-disable-next-line require-yield
      async *streamGenerate() {
        calls += 1;
        return { status: "timeout" }; // Always needs a reconnect.
      },
    };
    const environment = new Environment({
      workspaceDir: workspace,
      toolConfig: execCommandToolConfig(),
    });
    // No maxReconnects override: exercises the default cap (tiny base keeps the
    // exponential waits at 1+2+4+8+16 = 31ms total).
    const engine = new ContextEngine({ llm, environment, reconnectBackoffMs: 1 });

    const all = await collectRun(engine, [userText("go")], allowAll);
    expect(calls).toBe(6); // Initial attempt + 5 retries.
    const abort = all.find((m) => (m.payload as { type?: string }).type === "abort");
    expect((abort!.payload as { reason?: string }).reason).toBe("reconnect failed after 5 retries");
  });

  it("skipReconnectWait wakes the backoff early ('retry now'): attempt numbering unchanged; no-op without a wait", async () => {
    let calls = 0;
    const llm: LLMInterface = {
      async *streamGenerate() {
        calls += 1;
        if (calls === 1) return { status: "timeout" };
        yield assistantText("ok");
        yield tokenUsage(emptyTokenCounts(), {
          cache_read: 0,
          cache_write: 0,
          output: 1,
          total: 1,
        });
        return { status: "completed" };
      },
    };
    const environment = new Environment({
      workspaceDir: workspace,
      toolConfig: execCommandToolConfig(),
    });
    // A wait long enough that the run could only finish in time if the skip woke it.
    const engine = new ContextEngine({
      llm,
      environment,
      maxReconnects: 2,
      reconnectBackoffMs: 60_000,
    });

    // No reconnect wait in progress yet: skip is a benign no-op.
    expect(engine.skipReconnectWait()).toBe(false);

    const started = Date.now();
    const runP = collectRun(engine, [userText("go")], allowAll);
    // Poll the skip itself: it keeps returning false until the engine parks in the
    // backoff, and consumes the wait exactly once when it does.
    while (!engine.skipReconnectWait()) {
      await new Promise((r) => setTimeout(r, 5));
    }
    const all = await runP;
    expect(Date.now() - started).toBeLessThan(10_000); // woke early: the scheduled wait was 60s
    // Exactly the one retry — the skipped wait consumed no extra attempt.
    expect(calls).toBe(2);
    const ends = all.filter((m) => (m.payload as { type?: string }).type === "request_end");
    expect(ends.map((m) => (m.payload as { status?: string }).status)).toEqual([
      "timeout",
      "completed",
    ]);
    expect(all.map((m) => (m.payload as { type?: string }).type)).not.toContain("abort");
    // The wait settled (skip won the race): further skips are no-ops again.
    expect(engine.skipReconnectWait()).toBe(false);
  });

  it("reconnectDelayMs: exponential-with-ceiling ladder (defaults: 2s base, 30s cap)", () => {
    // The default cap (5) walks 2s/4s/8s/16s and hits the 30s ceiling on the fifth wait —
    // ≈ 60s of total patience (issue #218: the old 250ms base burned the whole ladder in
    // ~7.75s, faster than a provider restart or rate-limit window can recover). Every wait
    // sits at or above the hosts' 2s countdown floor, so each retry is visible.
    const ladder = [1, 2, 3, 4, 5].map((n) => reconnectDelayMs(2000, 30_000, n));
    expect(ladder).toEqual([2000, 4000, 8000, 16000, 30000]);
    expect(ladder.reduce((a, b) => a + b, 0)).toBe(60_000);
    // Past the ceiling the delay stays pinned (no overflow, no further growth).
    expect([6, 7].map((n) => reconnectDelayMs(2000, 30_000, n))).toEqual([30_000, 30_000]);
    // The cap also applies when the base itself exceeds it.
    expect(reconnectDelayMs(50_000, 30_000, 1)).toBe(30_000);
  });

  it("request_end carries the outcome's failure detail on non-completed statuses only", async () => {
    let calls = 0;
    const llm: LLMInterface = {
      async *streamGenerate() {
        calls += 1;
        if (calls === 1) {
          // A retryable provider rejection: the detail must reach observability via the
          // event — a retried request never produces an abort to carry it.
          return {
            status: "timeout",
            errorMessage: "403 quota exceeded (insufficient_user_quota)",
          };
        }
        yield assistantText("ok");
        yield tokenUsage(emptyTokenCounts(), {
          cache_read: 0,
          cache_write: 0,
          output: 1,
          total: 1,
        });
        return { status: "completed" };
      },
    };
    const environment = new Environment({
      workspaceDir: workspace,
      toolConfig: execCommandToolConfig(),
    });
    const engine = new ContextEngine({ llm, environment, maxReconnects: 1, reconnectBackoffMs: 0 });

    const all = await collectRun(engine, [userText("go")], allowAll);
    const ends = all.filter((m) => (m.payload as { type?: string }).type === "request_end") as {
      payload: { status?: string; error_message?: string; attempt?: number; retry_in_ms?: number };
    }[];
    expect(ends).toHaveLength(2);
    expect(ends[0]!.payload.status).toBe("timeout");
    expect(ends[0]!.payload.error_message).toBe("403 quota exceeded (insufficient_user_quota)");
    // The engine will retry: the planned backoff is announced (base 0 here -> 0ms), and the
    // authoritative attempt ordinal is stamped (this was the run's 1st request).
    expect(ends[0]!.payload.retry_in_ms).toBe(0);
    expect(ends[0]!.payload.attempt).toBe(1);
    expect(ends[1]!.payload.status).toBe("completed");
    expect(ends[1]!.payload.error_message).toBeUndefined();
    expect(ends[1]!.payload.retry_in_ms).toBeUndefined();
    // A completion that needed retries still carries its ordinal ("recovered on attempt 2");
    // only a clean first-try completion stays unstamped.
    expect(ends[1]!.payload.attempt).toBe(2);
  });

  it("request_end announces the planned backoff (retry_in_ms) from the shared ladder; absent once the cap is reached", async () => {
    let calls = 0;
    const llm: LLMInterface = {
      // eslint-disable-next-line require-yield
      async *streamGenerate() {
        calls += 1;
        return { status: "timeout" }; // Always needs a reconnect.
      },
    };
    const environment = new Environment({
      workspaceDir: workspace,
      toolConfig: execCommandToolConfig(),
    });
    const engine = new ContextEngine({
      llm,
      environment,
      maxReconnects: 2,
      reconnectBackoffMs: 10,
      reconnectBackoffMaxMs: 15,
    });

    const all = await collectRun(engine, [userText("go")], allowAll);
    const ends = all.filter((m) => (m.payload as { type?: string }).type === "request_end") as {
      payload: { retry_in_ms?: number };
    }[];
    // Announced waits follow the same exponential-with-ceiling formula the sleep uses
    // (10, then min(20, 15) = 15); the FINAL failure carries none — no retry follows,
    // the exhaustion abort does.
    expect(ends.map((e) => e.payload.retry_in_ms)).toEqual([10, 15, undefined]);
    expect(calls).toBe(3); // Initial attempt + 2 retries.
  });

  it("LLM timeout after a tool already executed: retry carries the call/result via [turn_retried] (tool runs once)", async () => {
    let calls = 0;
    const inputs: OmniMessage[][] = [];
    const llm: LLMInterface = {
      async *streamGenerate(params) {
        calls += 1;
        inputs.push(params.newMessages);
        if (calls === 1) {
          // Real tool_call -> the engine dispatches it for execution (appends to a file, a
          // side effect), followed by a timeout/network drop (timeout).
          yield toolCall({
            name: "exec_command",
            arguments: JSON.stringify({ cmd: "printf x >> count.txt" }),
            toolCallId: "t1",
            stopReason: "completed",
          });
          return { status: "timeout" };
        }
        yield assistantText("second");
        yield tokenUsage(emptyTokenCounts(), {
          cache_read: 0,
          cache_write: 0,
          output: 1,
          total: 1,
        });
        return { status: "completed" };
      },
    };
    const environment = new Environment({
      workspaceDir: workspace,
      toolConfig: execCommandToolConfig(),
    });
    const engine = new ContextEngine({
      llm,
      environment,
      maxReconnects: 3,
      reconnectBackoffMs: 0,
    });

    const all = await collectRun(engine, [userText("go")], allowAll);

    // The tool executes exactly once: retry input = original input + [turn_retried] (containing
    // a text transcript of the t1 call/result), so the model does not call it again; the
    // transcript is plain text and is never dispatched again.
    const content = await readFile(join(workspace, "count.txt"), "utf8").catch(() => "");
    expect(content).toBe("x");
    expect(calls).toBe(2); // Completes after one retry within the same run.
    expect(inputs[1]![0]).toEqual(inputs[0]![0]);
    const retried = (inputs[1]![1]!.payload as { text?: string }).text ?? "";
    expect(retried).toContain("[turn_retried]");
    expect(retried).toContain('[tool_call name="exec_command" id="t1"]');
    expect(retried).toContain('[tool_call_output id="t1"');
    // Completes, no abort.
    expect(
      all.some(
        (m) =>
          isCompleteModelMessage(m) && m.payload.type === "text" && m.payload.text === "second",
      ),
    ).toBe(true);
    expect(all.map((m) => (m.payload as { type?: string }).type)).not.toContain("abort");
  });

  it("flatten carry-over (auth exit) includes the model's partial thinking and text (PRN-014)", async () => {
    let calls = 0;
    const inputs: OmniMessage[][] = [];
    const llm: LLMInterface = {
      async *streamGenerate(params) {
        calls += 1;
        inputs.push(params.newMessages);
        if (calls === 1) {
          // Before the terminal error, partial thinking and text were already produced (the
          // LLM finishes them as complete messages). `auth` is the trigger because it is the
          // one LLM status that still exits straight to the flatten path — `failed` now takes
          // the reconnect ladder, whose carry-over is [turn_retried] instead (covered by the
          // exhausted-retries test below).
          yield thinkingMessage("half-thought", "failed");
          yield assistantText("half-text", "failed");
          return { status: "auth", errorMessage: "boom" };
        }
        yield assistantText("ok");
        yield tokenUsage(emptyTokenCounts(), {
          cache_read: 0,
          cache_write: 0,
          output: 1,
          total: 1,
        });
        return { status: "completed" };
      },
    };
    const environment = new Environment({
      workspaceDir: workspace,
      toolConfig: execCommandToolConfig(),
    });
    const engine = new ContextEngine({ llm, environment, reconnectBackoffMs: 0 });

    await collectRun(engine, [userText("go")], allowAll);
    expect(calls).toBe(1); // auth -> no retry, exits immediately.

    // Next run: the flattened carry-over contains the original input plus partial thinking/text
    // (both completed and incomplete messages are carried over).
    await collectRun(engine, [userText("next")], allowAll);
    const text = inputs[1]!.map((m) => (m.payload as { text?: string }).text ?? "").join("\n");
    expect(text).toContain("[turn_aborted]");
    expect(text).toContain("[thinking]half-thought[/thinking]");
    expect(text).toContain("[text]half-text[/text]");
    expect(text).toContain("go");
    expect(text).toContain("next");
  });

  it("carry-over after exhausted retries: raw original input + [turn_retried] with all attempts' products", async () => {
    let calls = 0;
    const inputs: OmniMessage[][] = [];
    const llm: LLMInterface = {
      async *streamGenerate(params) {
        calls += 1;
        inputs.push(params.newMessages);
        if (calls === 1) {
          // Attempt 1: a real tool_call (execution has a side effect) followed by a timeout.
          yield toolCall({
            name: "exec_command",
            arguments: JSON.stringify({ cmd: "printf x >> chain.txt" }),
            toolCallId: "t1",
            stopReason: "completed",
          });
          return { status: "timeout" };
        }
        if (calls === 2) {
          // Attempt 2 (retry, original input resent): produces partial thinking then times out
          // again -> retries exhausted.
          yield thinkingMessage("retry-thought", "timeout");
          return { status: "timeout" };
        }
        yield assistantText("ok");
        yield tokenUsage(emptyTokenCounts(), {
          cache_read: 0,
          cache_write: 0,
          output: 1,
          total: 1,
        });
        return { status: "completed" };
      },
    };
    const environment = new Environment({
      workspaceDir: workspace,
      toolConfig: execCommandToolConfig(),
    });
    // maxReconnects=1 -> exhausted after attempt 2; the original input is stashed as carry-over
    // for the next run.
    const engine = new ContextEngine({
      llm,
      environment,
      maxReconnects: 1,
      reconnectBackoffMs: 0,
    });

    await collectRun(engine, [userText("go")], allowAll);
    expect(calls).toBe(2);
    // Retry = original input + [turn_retried] (attempt 1's t1 call/result).
    expect(inputs[1]![0]).toEqual(inputs[0]![0]);
    expect((inputs[1]![1]!.payload as { text?: string }).text ?? "").toContain("[turn_retried]");

    // Next run: carry-over = original input + [turn_retried] (accumulating attempt 1's t1
    // call/result and attempt 2's partial thinking), a single un-nested block; produces no
    // [turn_aborted].
    await collectRun(engine, [userText("next")], allowAll);
    const nextRunTexts = inputs[2]!.map((m) => (m.payload as { text?: string }).text ?? "");
    expect(nextRunTexts).toHaveLength(3);
    expect(nextRunTexts[0]).toBe("go");
    const block = nextRunTexts[1]!;
    expect(block).toContain('[tool_call name="exec_command" id="t1"]');
    expect(block).toContain('[tool_call_output id="t1"');
    expect(block).toContain("[thinking]retry-thought[/thinking]");
    expect((block.match(/\[turn_retried\]/g) ?? []).length).toBe(1);
    expect(nextRunTexts[2]).toBe("next");
    expect(nextRunTexts.join("\n")).not.toContain("[turn_aborted]");
    // t1 already executed once during the failed attempts (side effect occurred); the
    // transcript is plain text and is not dispatched again by either the retry or the next run.
    const content = await readFile(join(workspace, "chain.txt"), "utf8").catch(() => "");
    expect(content).toBe("x");
  });

  it("user abort after a failed retry: [turn_retried] un-nests into the [turn_aborted] flatten", async () => {
    const controller = new AbortController();
    let calls = 0;
    const inputs: OmniMessage[][] = [];
    const llm: LLMInterface = {
      async *streamGenerate(params) {
        calls += 1;
        inputs.push(params.newMessages);
        if (calls === 1) {
          yield thinkingMessage("half-1", "timeout");
          return { status: "timeout" };
        }
        if (calls === 2) {
          // Interrupted by the user while the retry is in progress.
          controller.abort();
          return { status: "aborted" };
        }
        yield assistantText("ok");
        yield tokenUsage(emptyTokenCounts(), {
          cache_read: 0,
          cache_write: 0,
          output: 1,
          total: 1,
        });
        return { status: "completed" };
      },
    };
    const environment = new Environment({
      workspaceDir: workspace,
      toolConfig: execCommandToolConfig(),
    });
    const engine = new ContextEngine({
      llm,
      environment,
      maxReconnects: 2,
      reconnectBackoffMs: 0,
    });

    await collectRun(engine, [userText("go")], allowAll, controller.signal);
    expect(calls).toBe(2);
    // The retry input carries [turn_retried].
    expect((inputs[1]![1]!.payload as { text?: string }).text ?? "").toContain("[turn_retried]");

    // The next run after the interrupt: flattens into a single-level [turn_aborted], with
    // [turn_retried]'s content un-nested and merged in.
    await collectRun(engine, [userText("next")], allowAll);
    const text = inputs[2]!.map((m) => (m.payload as { text?: string }).text ?? "").join("\n");
    expect(text).toContain("[turn_aborted]");
    expect(text).toContain("[thinking]half-1[/thinking]");
    expect(text).not.toContain("[turn_retried]");
    expect((text.match(/\[turn_aborted\]/g) ?? []).length).toBe(1);
  });

  it("keeps raw inputs across repeated pre-request aborts (no flatten)", async () => {
    const received: OmniMessage[][] = [];
    const llm: LLMInterface = {
      async *streamGenerate(params) {
        received.push(params.newMessages);
        yield assistantText("ok");
        yield tokenUsage(emptyTokenCounts(), {
          cache_read: 0,
          cache_write: 0,
          output: 1,
          total: 1,
        });
        return { status: "completed" };
      },
    };
    const environment = new Environment({
      workspaceDir: workspace,
      toolConfig: execCommandToolConfig(),
    });
    const engine = new ContextEngine({ llm, environment });

    // Run 1 & 2 are both interrupted before dispatch -> the input is stashed as-is as
    // carry-over (run 1/2 never call the LLM).
    const c1 = new AbortController();
    c1.abort();
    await collectRun(engine, [userText("go")], allowAll, c1.signal);
    const c2 = new AbortController();
    c2.abort();
    await collectRun(engine, [userText("next")], allowAll, c2.signal);

    // Run 3 is normal: its first LLM input = the as-is preserved "go", "next" + "more",
    // producing no [turn_aborted] (input that never made it to a Request is kept as-is
    // per the trailing-input semantics).
    await collectRun(engine, [userText("more")], allowAll);
    const texts = received[0]!.map((m) => (m.payload as { text?: string }).text ?? "");
    expect(texts).toEqual(["go", "next", "more"]);
    expect(texts.join("\n")).not.toContain("[turn_aborted]");
  });
});

describe("ContextEngine mid-run steering ([user_steering])", () => {
  let workspace: string;
  let traces: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "penguin-ws-"));
    traces = await mkdtemp(join(tmpdir(), "penguin-tr-"));
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    await rm(traces, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  /** Fake environment: streams a delta then closes with a fixed complete output (no real shell). */
  function steeringEnvironment(result = "tool result"): EnvironmentInterface {
    return {
      listTools: async () => [],
      toolPermission: (): ToolPermission => "rw",
      async *executeTool({ toolCall: tc }) {
        const toolCallId = tc.payload.tool_call_id;
        yield partialToolCallOutput({ eventType: "start", toolCallId });
        yield partialToolCallOutput({ eventType: "delta", output: result, toolCallId });
        yield partialToolCallOutput({ eventType: "stop", toolCallId });
        yield toolCallOutput({ output: result, toolCallId });
      },
    };
  }

  /** The text payloads of the [user_steering]-wrapped user messages in a list. */
  const steeringTexts = (msgs: OmniMessage[]): string[] =>
    msgs
      .map((m) => m.payload as { role?: string; text?: string })
      .filter((p) => p.role === "user" && (p.text ?? "").startsWith("[user_steering]"))
      .map((p) => p.text!);

  it("delivers queued steering as standalone user messages alongside the turn's tool outputs — traced, streamed, fed to the model in order; tool output untouched", async () => {
    const llm = new FakeLLM();
    const trace = new Writer({ tracesDir: traces, sessionId: "sess_steer" });
    const engine = new ContextEngine({ llm, environment: steeringEnvironment(), trace });

    // Idle: nothing running yet -> steer refuses, the host falls back to a normal task.
    expect(engine.steer([userText("too early")])).toBe(false);

    // Queue two messages while the task runs (deterministically: from the approval callback,
    // i.e. after the tool_call streamed but before the tool executed).
    const approve: ApproveFn = async () => {
      expect(engine.steer([userText("focus on the tests")])).toBe(true);
      expect(engine.steer([userText("also update the docs")])).toBe(true);
      return "allow";
    };
    const all = await collectRun(engine, [userText("go")], approve);

    const expected = [
      "[user_steering]\nfocus on the tests\n[/user_steering]",
      "[user_steering]\nalso update the docs\n[/user_steering]",
    ];

    // The tool output itself is never rewritten.
    const outputs = all.filter(
      (m) => isCompleteModelMessage(m) && m.payload.type === "tool_call_output",
    );
    expect(outputs).toHaveLength(1);
    expect((outputs[0]!.payload as { output: string }).output).toBe("tool result");

    // Streamed: the steering user messages are yielded (live consumers never saw this text).
    expect(steeringTexts(all)).toEqual(expected);

    // The next turn's LLM input = tool output first, then the steering user messages in order.
    const second = llm.receivedSecondInput!;
    expect(second.map((m) => (m.payload as { type?: string }).type)).toEqual([
      "tool_call_output",
      "text",
      "text",
    ]);
    expect(steeringTexts(second)).toEqual(expected);

    // Trace recorded them as real user input (replay attributes them to the next turn).
    const recorded = await readTrace(trace.currentPath());
    expect(steeringTexts(recorded)).toEqual(expected);
    const recordedOutputs = recorded.filter(
      (m) => (m.payload as { type?: string }).type === "tool_call_output",
    );
    expect((recordedOutputs[0]!.payload as { output: string }).output).toBe("tool result");

    // Task over: the queue window is closed again.
    expect(engine.steer([userText("late")])).toBe(false);
  });

  it("delivers steering left at loop end as a [user_steering] continuation turn (traced, streamed)", async () => {
    // Turn 1 ends with no tool calls while steering is queued mid-stream -> the engine keeps
    // looping and sends the queued text as the next input, wrapped in the same marker (UIs
    // keep it inside the running Task; the model knows it is mid-task user input).
    let engineRef: ContextEngine | null = null;
    const inputs: OmniMessage[][] = [];
    const llm: LLMInterface = {
      async *streamGenerate(params): AsyncGenerator<OmniMessage, LLMOutcome> {
        inputs.push(params.newMessages);
        if (inputs.length === 1) {
          yield assistantText("final answer");
          expect(engineRef!.steer([userText("one more thing")])).toBe(true);
          return { status: "completed" };
        }
        yield assistantText("handled the follow-up");
        return { status: "completed" };
      },
    };
    const trace = new Writer({ tracesDir: traces, sessionId: "sess_steer_loop" });
    const engine = new ContextEngine({ llm, environment: steeringEnvironment(), trace });
    engineRef = engine;

    const all = await collectRun(engine, [userText("go")], allowAll);

    const wrapped = "[user_steering]\none more thing\n[/user_steering]";
    // Turn 2 received exactly the wrapped steering message as its input.
    expect(inputs).toHaveLength(2);
    expect(inputs[1]!.map((m) => (m.payload as { text?: string }).text)).toEqual([wrapped]);
    // Streamed and traced like any user input.
    expect(steeringTexts(all)).toEqual([wrapped]);
    expect(steeringTexts(await readTrace(trace.currentPath()))).toEqual([wrapped]);
  });

  /** Image URLs of the image messages in a list, in order. */
  const steeredImages = (msgs: OmniMessage[]): string[] =>
    msgs
      .map((m) => m.payload as { type?: string; image_url?: string })
      .filter((p) => p.type === "image_url")
      .map((p) => p.image_url!);

  it("carries a steering message's images right behind its text (vision model), streamed and traced with it", async () => {
    // An image with no caption is a complete steering message on its own; each entry's images
    // follow that entry's text, so two steers stay distinguishable in the delivered order.
    let engineRef: ContextEngine | null = null;
    const inputs: OmniMessage[][] = [];
    const llm: LLMInterface = {
      async *streamGenerate(params): AsyncGenerator<OmniMessage, LLMOutcome> {
        inputs.push(params.newMessages);
        if (inputs.length === 1) {
          expect(engineRef!.steer([imageUrlMessage("data:image/png;base64,AAAA")])).toBe(true);
          expect(
            engineRef!.steer([
              userText("this one too"),
              imageUrlMessage("data:image/png;base64,BBBB"),
            ]),
          ).toBe(true);
          yield assistantText("final answer");
          return { status: "completed" };
        }
        yield assistantText("looked at both");
        return { status: "completed" };
      },
    };
    const trace = new Writer({ tracesDir: traces, sessionId: "sess_steer_img" });
    const engine = new ContextEngine({ llm, environment: steeringEnvironment(), trace });
    engineRef = engine;

    const all = await collectRun(engine, [userText("go")], allowAll);

    expect(inputs).toHaveLength(2);
    expect(
      inputs[1]!.map((m) => {
        const p = m.payload as { type: string; text?: string; image_url?: string };
        return p.type === "image_url" ? `img:${p.image_url}` : p.text;
      }),
    ).toEqual([
      "[user_steering]\n\n[/user_steering]",
      "img:data:image/png;base64,AAAA",
      "[user_steering]\nthis one too\n[/user_steering]",
      "img:data:image/png;base64,BBBB",
    ]);
    // Streamed and traced like the text they belong to (a plain run never yields its Prompt,
    // so these are the steering images and nothing else).
    const expectedImages = ["data:image/png;base64,AAAA", "data:image/png;base64,BBBB"];
    expect(steeredImages(all)).toEqual(expectedImages);
    expect(steeredImages(await readTrace(trace.currentPath()))).toEqual(expectedImages);
  });

  it("without vision, a steering message's images fold into [attached image: …] lines INSIDE the block", async () => {
    // The block must stay the whole text: lines appended after the closing tag would cost the
    // message its steering identity (parseUserSteeringText) and read as a new Task everywhere.
    const scratch = await mkdtemp(join(tmpdir(), "penguin-steer-img-"));
    try {
      let engineRef: ContextEngine | null = null;
      const inputs: OmniMessage[][] = [];
      const llm: LLMInterface = {
        async *streamGenerate(params): AsyncGenerator<OmniMessage, LLMOutcome> {
          inputs.push(params.newMessages);
          if (inputs.length === 1) {
            expect(
              engineRef!.steer([userText("look at this"), imageUrlMessage(PNG_DATA_URL)]),
            ).toBe(true);
            // An image with no caption of its own: the whole steering message is the picture.
            expect(engineRef!.steer([imageUrlMessage(PNG_DATA_URL)])).toBe(true);
            yield assistantText("final answer");
            return { status: "completed" };
          }
          yield assistantText("read the file");
          return { status: "completed" };
        },
      };
      const engine = new ContextEngine({
        llm,
        environment: steeringEnvironment(),
        foldInputImages: (messages) => imagesToScratchpadPaths(messages, scratch),
      });
      engineRef = engine;
      await collectRun(engine, [userText("go")], allowAll);

      // Both entries arrive as text and nothing else — every image became a line inside a block.
      expect(inputs[1]!.map((m) => (m.payload as { type: string }).type)).toEqual(["text", "text"]);
      const inner = inputs[1]!.map((m) =>
        parseUserSteeringText((m.payload as { text: string }).text),
      );
      expect(inner[0]).toMatch(/^look at this\n\n\[attached image: .+\]$/);
      // The caption-less one is the path line and nothing else: no blank line standing in for
      // the text that was never sent.
      expect(inner[1]).toMatch(/^\[attached image: .+\]$/);
      // Both files really landed in the scratchpad.
      expect(await readdir(scratch)).toHaveLength(2);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  // Session hands the engine the same throwing fold a Prompt gets: an unwritable scratchpad
  // ends the run rather than dropping the attachment and carrying on. The picture usually
  // arrives BECAUSE the run is going the wrong way, so continuing without it would spend the
  // rest of the Task heading further that way.
  it("a steering fold that fails ends the run instead of carrying on without the images", async () => {
    let engineRef: ContextEngine | null = null;
    const inputs: OmniMessage[][] = [];
    const llm: LLMInterface = {
      async *streamGenerate(params): AsyncGenerator<OmniMessage, LLMOutcome> {
        inputs.push(params.newMessages);
        if (inputs.length === 1) {
          expect(
            engineRef!.steer([
              userText("look at this"),
              imageUrlMessage("data:image/png;base64,AAAA"),
            ]),
          ).toBe(true);
        }
        yield assistantText("final answer");
        return { status: "completed" };
      },
    };
    const engine = new ContextEngine({
      llm,
      environment: steeringEnvironment(),
      foldInputImages: () =>
        Promise.reject(Object.assign(new Error("ENOSPC: no space left"), { code: "ENOSPC" })),
    });
    engineRef = engine;

    await expect(collectRun(engine, [userText("go")], allowAll)).rejects.toThrow(/ENOSPC/);
    // It ended at delivery: no second request went out carrying a note in place of the image.
    expect(inputs).toHaveLength(1);
  });

  it("a fold returning an unreadable shape names the broken contract instead of carrying on", async () => {
    // foldInputImages is public API (ContextEngineDeps is exported), so a third-party adapter
    // can return the wrong thing. Sending the images on as messages would be the worse answer:
    // a fold is configured precisely because the model does not take images.
    let engineRef: ContextEngine | null = null;
    const inputs: OmniMessage[][] = [];
    const llm: LLMInterface = {
      async *streamGenerate(params): AsyncGenerator<OmniMessage, LLMOutcome> {
        inputs.push(params.newMessages);
        if (inputs.length === 1) {
          expect(
            engineRef!.steer([
              userText("look at this"),
              imageUrlMessage("data:image/png;base64,AAAA"),
            ]),
          ).toBe(true);
        }
        yield assistantText("final answer");
        return { status: "completed" };
      },
    };
    const engine = new ContextEngine({
      llm,
      environment: steeringEnvironment(),
      foldInputImages: async () => [],
    });
    engineRef = engine;

    await expect(collectRun(engine, [userText("go")], allowAll)).rejects.toThrow(
      /foldInputImages must return/,
    );
    expect(inputs).toHaveLength(1);
  });

  it("a steering message with neither text nor images queues nothing (and asks for no fallback)", async () => {
    // `false` means "no Task running — send it as a normal task", which would be the wrong
    // advice for an empty message; so it returns true and simply delivers nothing.
    let engineRef: ContextEngine | null = null;
    const inputs: OmniMessage[][] = [];
    const llm: LLMInterface = {
      async *streamGenerate(params): AsyncGenerator<OmniMessage, LLMOutcome> {
        inputs.push(params.newMessages);
        if (inputs.length === 1) {
          expect(engineRef!.steer([userText("   ")])).toBe(true);
          yield assistantText("final answer");
          return { status: "completed" };
        }
        yield assistantText("must not happen");
        return { status: "completed" };
      },
    };
    const engine = new ContextEngine({ llm, environment: steeringEnvironment() });
    engineRef = engine;
    const all = await collectRun(engine, [userText("go")], allowAll);

    // Nothing queued -> the turn produced no tool calls and no steering, so the Task ends.
    expect(inputs).toHaveLength(1);
    const userTexts = all.filter(
      (m) => m.type === "model_msg" && (m.payload as { role?: string }).role === "user",
    );
    expect(userTexts).toHaveLength(0);
  });

  it("steering queued during a mid-run compaction is delivered right after it (never swallowed)", async () => {
    // Turn 1 completes over the context threshold -> summarize compaction runs on the old
    // LLM; the user steers DURING the compaction request (the acceptance window stays open);
    // the new context's first input must be [summary, steering], not just the summary.
    let engineRef: ContextEngine | null = null;
    const newInputs: OmniMessage[][] = [];
    const oldLLM: LLMInterface = {
      async *streamGenerate(params): AsyncGenerator<OmniMessage, LLMOutcome> {
        const texts = params.newMessages.map((m) => (m.payload as { text?: string }).text ?? "");
        if (texts.some((t) => t.includes("summary prompt"))) {
          // The compaction request: steering arrives while it streams.
          expect(engineRef!.steer([userText("switch to staging")])).toBe(true);
          yield assistantText("[summary]the gist[/summary]");
          yield tokenUsage(emptyTokenCounts(), {
            cache_read: 0,
            cache_write: 0,
            output: 1,
            total: 10,
          });
          return { status: "completed" };
        }
        // Turn 1: final answer with usage over the threshold.
        yield assistantText("done with the answer");
        yield tokenUsage(emptyTokenCounts(), {
          cache_read: 0,
          cache_write: 0,
          output: 5,
          total: 5000,
        });
        return { status: "completed" };
      },
    };
    const newLLM: LLMInterface = {
      async *streamGenerate(params): AsyncGenerator<OmniMessage, LLMOutcome> {
        newInputs.push(params.newMessages);
        yield assistantText("continuing after compaction");
        return { status: "completed" };
      },
    };
    const engine = new ContextEngine({
      llm: oldLLM,
      environment: steeringEnvironment(),
      createLLM: () => newLLM,
      compaction: {
        maxContextLength: 1000,
        maxSessionTurns: -1,
        mode: "summarize",
        prompt: "summary prompt",
      },
    });
    engineRef = engine;

    const all = await collectRun(engine, [userText("go")], allowAll);

    const wrapped = "[user_steering]\nswitch to staging\n[/user_steering]";
    // The new context received the summary followed by the steering user message.
    expect(newInputs).toHaveLength(1);
    expect(newInputs[0]!.map((m) => (m.payload as { text?: string }).text)).toEqual([
      "[context_summary]\nthe gist\n[/context_summary]",
      wrapped,
    ]);
    // The steering message reached the output stream too.
    expect(steeringTexts(all)).toEqual([wrapped]);
  });

  it("discards the queue on abort — the next run sees no leftover steering", async () => {
    const llm = new FakeLLM();
    const engine = new ContextEngine({ llm, environment: steeringEnvironment() });
    const ac = new AbortController();
    const approve: ApproveFn = async () => {
      expect(engine.steer([userText("stale steering")])).toBe(true);
      ac.abort();
      return "allow";
    };
    const first = await collectRun(engine, [userText("go")], approve, ac.signal);
    expect(first.some((m) => (m.payload as { type?: string }).type === "abort")).toBe(true);

    // Aborted: whatever was queued is dropped with the run (documented steering contract).
    expect(engine.steer([userText("after abort")])).toBe(false);
    await collectRun(engine, [userText("continue")], allowAll);
    const followUpTexts = (llm.receivedSecondInput ?? [])
      .map((m) => {
        const p = m.payload as { text?: string; output?: string };
        return p.text ?? p.output ?? "";
      })
      .join("\n");
    expect(followUpTexts).not.toContain("stale steering");
    expect(followUpTexts).not.toContain("[user_steering]");
  });
});
