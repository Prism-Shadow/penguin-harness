/**
 * context_engine integration tests (mock LLM, no API key needed).
 *
 * New protocol: a single `run(prompt, { signal, approve })` automatically drives the whole
 * ReAct loop — it consumes the LLM stream, calls `approve` immediately for each tool_call,
 * executes it via Environment when allowed, feeds the result back and continues to the next
 * turn, until some turn produces no tool_call (Task done) or is interrupted. Approval/execution
 * are within-turn interactions, and execution can overlap.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assistantText,
  emptyTokenCounts,
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
import { ContextEngine } from "../src/engine/context-engine.js";
import type { ApproveFn, EnvironmentInterface, ToolPermission } from "../src/interfaces.js";

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

/** Count of text messages in the list starting with `<turn_aborted>` (flatten carry-over count). */
const turnAbortedCount = (msgs: OmniMessage[]): number =>
  msgs.filter((m) => ((m.payload as { text?: string }).text ?? "").startsWith("<turn_aborted>"))
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

describe("ContextEngine ReAct loop (mock LLM, approve callback)", () => {
  let workspace: string;
  let traces: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "penguin-ws-"));
    traces = await mkdtemp(join(tmpdir(), "penguin-tr-"));
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
    await rm(traces, { recursive: true, force: true });
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
    expect(await readFile(join(workspace, "hello.txt"), "utf8")).toBe("Hello, Penguin");

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

  it("max_turns default is 100", () => {
    const engine = new ContextEngine({
      llm: new FakeLLM(),
      environment: new Environment({
        workspaceDir: workspace,
        toolConfig: execCommandToolConfig(),
      }),
    });
    // Reads the default via a private field (white-box, only testing the default).
    expect((engine as unknown as { maxTurns: number }).maxTurns).toBe(100);
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
    expect(texts.join("\n")).not.toContain("<turn_aborted>");
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
        thinking_level: "medium",
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

  it("in-run reconnect never writes the synthesized <turn_retried> to trace", async () => {
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
    // Retry = original input + <turn_retried> (carrying the partial text).
    expect((inputs[1]![1]!.payload as { text?: string }).text ?? "").toContain("<turn_retried>");
    // The synthesized message is only sent to the model: Trace has no <turn_retried> /
    // <turn_aborted>; the original input is written only on its first occurrence.
    const recorded = await readTrace(trace.currentPath());
    expect(turnAbortedCount(recorded)).toBe(0);
    expect(
      recorded.some((m) =>
        ((m.payload as { text?: string }).text ?? "").startsWith("<turn_retried>"),
      ),
    ).toBe(false);
    expect(recorded.filter((m) => (m.payload as { text?: string }).text === "go")).toHaveLength(1);
  });
});

describe("ContextEngine async/incremental tool calls (overlapping execution)", () => {
  let workspace: string;
  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "penguin-ws2-"));
  });
  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
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
    expect(firstCompleteAt["t2"]!).toBeLessThan(firstCompleteAt["t1"]!);

    expect(await readFile(join(workspace, "a.txt"), "utf8")).toBe("one");
    expect(await readFile(join(workspace, "b.txt"), "utf8")).toBe("two");
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
    await rm(workspace, { recursive: true, force: true });
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
    await rm(workspace, { recursive: true, force: true });
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
    // Case A must be a structured backfill and must **not** be flattened into <turn_aborted>
    // (otherwise the already-committed tool_call would lose its pairing).
    const carriedText = received[1]!
      .map((m) => (m.payload as { text?: string }).text ?? "")
      .join("");
    expect(carriedText).not.toContain("<turn_aborted>");
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
    await rm(workspace, { recursive: true, force: true });
  });

  it("auto-retries on LLM timeout: original input + <turn_retried> carrying partial products", async () => {
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
    // Retry = original input kept as-is + one <turn_retried> carrying the partial products
    // already produced (not <turn_aborted>, to avoid the model mistaking it for a user interrupt).
    expect(inputs[1]).toHaveLength(2);
    expect(inputs[1]![0]).toEqual(inputs[0]![0]);
    const retried = (inputs[1]![1]!.payload as { text?: string }).text ?? "";
    expect(retried).toContain("<turn_retried>");
    expect(retried).toContain("<text>thinking...</text>");
    expect(retried).not.toContain("<turn_aborted>");
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
          return { status: "malformed", message: "incomplete stream" };
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

  it("auto-retries on LLM malformed: original input + <turn_retried> carrying partial products", async () => {
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
    // plus <turn_retried> carrying the partial products already produced.
    expect(inputs[1]).toHaveLength(2);
    expect(inputs[1]![0]).toEqual(inputs[0]![0]);
    const retried = (inputs[1]![1]!.payload as { text?: string }).text ?? "";
    expect(retried).toContain("<turn_retried>");
    expect(retried).toContain("partial json response");
    expect(retried).not.toContain("<turn_aborted>");
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

    // carry-over = original input + <turn_retried> (accumulating partial products from both
    // failed attempts): the next run resends it merged with the new input, without producing
    // <turn_aborted>.
    await collectRun(engine, [userText("next")], allowAll);
    const nextRunTexts = inputs[2]!.map((m) => (m.payload as { text?: string }).text ?? "");
    expect(nextRunTexts).toHaveLength(3);
    expect(nextRunTexts[0]).toBe("go");
    expect(nextRunTexts[1]).toContain("<turn_retried>");
    expect(nextRunTexts[1]).toContain("partial...");
    expect(nextRunTexts[2]).toBe("next");
    expect(nextRunTexts.join("\n")).not.toContain("<turn_aborted>");
  });

  it("surfaces a non-retryable LLM failure (outcome=failed) as a graceful abort (run does not throw)", async () => {
    let calls = 0;
    const inputs: OmniMessage[][] = [];
    const llm: LLMInterface = {
      // The LLM must never throw an exception at the engine: a non-retryable error resolves
      // by returning a failed outcome after closing the structure.
      // eslint-disable-next-line require-yield
      async *streamGenerate(params) {
        calls += 1;
        inputs.push(params.newMessages);
        return { status: "failed", message: "invalid api key" };
      },
    };
    const environment = new Environment({
      workspaceDir: workspace,
      toolConfig: execCommandToolConfig(),
    });
    const engine = new ContextEngine({ llm, environment, reconnectBackoffMs: 0 });

    // Must not throw; should gracefully converge to an abort.
    const all = await collectRun(engine, [userText("go")], allowAll);
    expect(calls).toBe(1); // failed -> no retry.
    const abort = all.find((m) => (m.payload as { type?: string }).type === "abort");
    expect(abort).toBeDefined();
    const reason = (abort!.payload as { reason?: string }).reason ?? "";
    expect(reason).toContain("llm request error");
    expect(reason).toContain("invalid api key");

    // The failed turn's input is flattened and stashed; the next run resends it merged with
    // the new input.
    await collectRun(engine, [userText("next")], allowAll);
    const text = inputs[1]!.map((m) => (m.payload as { text?: string }).text ?? "").join("\n");
    expect(text).toContain("go");
    expect(text).toContain("next");
  });

  it("LLM timeout after a tool already executed: retry carries the call/result via <turn_retried> (tool runs once)", async () => {
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

    // The tool executes exactly once: retry input = original input + <turn_retried> (containing
    // a text transcript of the t1 call/result), so the model does not call it again; the
    // transcript is plain text and is never dispatched again.
    const content = await readFile(join(workspace, "count.txt"), "utf8").catch(() => "");
    expect(content).toBe("x");
    expect(calls).toBe(2); // Completes after one retry within the same run.
    expect(inputs[1]![0]).toEqual(inputs[0]![0]);
    const retried = (inputs[1]![1]!.payload as { text?: string }).text ?? "";
    expect(retried).toContain("<turn_retried>");
    expect(retried).toContain('<tool_call name="exec_command" id="t1">');
    expect(retried).toContain('<tool_call_output id="t1"');
    // Completes, no abort.
    expect(
      all.some(
        (m) =>
          isCompleteModelMessage(m) && m.payload.type === "text" && m.payload.text === "second",
      ),
    ).toBe(true);
    expect(all.map((m) => (m.payload as { type?: string }).type)).not.toContain("abort");
  });

  it("flatten carry-over (failed exit) includes the model's partial thinking and text (PRN-014)", async () => {
    let calls = 0;
    const inputs: OmniMessage[][] = [];
    const llm: LLMInterface = {
      async *streamGenerate(params) {
        calls += 1;
        inputs.push(params.newMessages);
        if (calls === 1) {
          // Before the non-retryable error, partial thinking and text were already produced
          // (the LLM finishes them as complete messages, stop_reason failed).
          yield thinkingMessage("half-thought", "failed");
          yield assistantText("half-text", "failed");
          return { status: "failed", message: "boom" };
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
    expect(calls).toBe(1); // failed -> no retry, exits immediately.

    // Next run: the flattened carry-over contains the original input plus partial thinking/text
    // (both completed and incomplete messages are carried over).
    await collectRun(engine, [userText("next")], allowAll);
    const text = inputs[1]!.map((m) => (m.payload as { text?: string }).text ?? "").join("\n");
    expect(text).toContain("<turn_aborted>");
    expect(text).toContain("<thinking>half-thought</thinking>");
    expect(text).toContain("<text>half-text</text>");
    expect(text).toContain("go");
    expect(text).toContain("next");
  });

  it("carry-over after exhausted retries: raw original input + <turn_retried> with all attempts' products", async () => {
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
    // Retry = original input + <turn_retried> (attempt 1's t1 call/result).
    expect(inputs[1]![0]).toEqual(inputs[0]![0]);
    expect((inputs[1]![1]!.payload as { text?: string }).text ?? "").toContain("<turn_retried>");

    // Next run: carry-over = original input + <turn_retried> (accumulating attempt 1's t1
    // call/result and attempt 2's partial thinking), a single un-nested block; produces no
    // <turn_aborted>.
    await collectRun(engine, [userText("next")], allowAll);
    const nextRunTexts = inputs[2]!.map((m) => (m.payload as { text?: string }).text ?? "");
    expect(nextRunTexts).toHaveLength(3);
    expect(nextRunTexts[0]).toBe("go");
    const block = nextRunTexts[1]!;
    expect(block).toContain('<tool_call name="exec_command" id="t1">');
    expect(block).toContain('<tool_call_output id="t1"');
    expect(block).toContain("<thinking>retry-thought</thinking>");
    expect((block.match(/<turn_retried>/g) ?? []).length).toBe(1);
    expect(nextRunTexts[2]).toBe("next");
    expect(nextRunTexts.join("\n")).not.toContain("<turn_aborted>");
    // t1 already executed once during the failed attempts (side effect occurred); the
    // transcript is plain text and is not dispatched again by either the retry or the next run.
    const content = await readFile(join(workspace, "chain.txt"), "utf8").catch(() => "");
    expect(content).toBe("x");
  });

  it("user abort after a failed retry: <turn_retried> un-nests into the <turn_aborted> flatten", async () => {
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
    // The retry input carries <turn_retried>.
    expect((inputs[1]![1]!.payload as { text?: string }).text ?? "").toContain("<turn_retried>");

    // The next run after the interrupt: flattens into a single-level <turn_aborted>, with
    // <turn_retried>'s content un-nested and merged in.
    await collectRun(engine, [userText("next")], allowAll);
    const text = inputs[2]!.map((m) => (m.payload as { text?: string }).text ?? "").join("\n");
    expect(text).toContain("<turn_aborted>");
    expect(text).toContain("<thinking>half-1</thinking>");
    expect(text).not.toContain("<turn_retried>");
    expect((text.match(/<turn_aborted>/g) ?? []).length).toBe(1);
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
    // producing no <turn_aborted> (input that never made it to a Request is kept as-is
    // per the trailing-input semantics).
    await collectRun(engine, [userText("more")], allowAll);
    const texts = received[0]!.map((m) => (m.payload as { text?: string }).text ?? "");
    expect(texts).toEqual(["go", "next", "more"]);
    expect(texts.join("\n")).not.toContain("<turn_aborted>");
  });
});
