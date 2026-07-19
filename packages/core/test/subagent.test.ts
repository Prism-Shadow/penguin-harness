/**
 * Behavior tests for run_subagent / input_subagent: foreground delegation, backgrounding,
 * polling, resuming with an appended Prompt, the approval queue, and lifecycle finalization.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createSubagentTool } from "../src/environment/tools/run-subagent.js";
import { createInputSubagentTool } from "../src/environment/tools/input-subagent.js";
import {
  ManagedSubagentSession,
  SubagentSessionManager,
} from "../src/environment/tools/subagent/index.js";
import { abortEvent, partialText, toolCall, withOrigin } from "../src/omnimessage/index.js";
import { collectWindow } from "../src/environment/tools/subagent/collect.js";
import type { MessageOrigin, OmniMessage } from "../src/omnimessage/index.js";
import type {
  ApproveFn,
  EnvironmentServices,
  SubagentHandle,
  SubagentRunner,
  ToolDefinitionConfig,
} from "../src/interfaces.js";
import type { ToolExecutionContext, ToolResult } from "../src/environment/tools/types.js";

const DEF: ToolDefinitionConfig = {
  name: "run_subagent",
  description: "delegate a subtask",
  permission: "rw",
};

const INPUT_DEF: ToolDefinitionConfig = {
  name: "input_subagent",
  description: "drive a background subagent",
  permission: "rw",
};

const CTX: ToolExecutionContext = {
  workspaceDir: "/tmp/ws",
  toolCallId: "call_1",
};

/** The origin tag the simulated runner stamps on (contract: every message handle.run yields
 *  already carries the child Session id). */
const HOP: MessageOrigin = "session-child-12ab34cd";

interface LoosePayload {
  type?: string;
  event_type?: string;
  output?: string;
  stop_reason?: string;
  tool_call_id?: string;
}
const pl = (m: OmniMessage): LoosePayload => m.payload as LoosePayload;

type RunInput = { prompt: string; signal?: AbortSignal; approve?: ApproveFn };

/** Builds a SubagentRunner from a run implementation (spawn arguments observed via a spy). */
function runnerOf(
  run: (input: RunInput) => AsyncGenerator<OmniMessage>,
  spawnSpy?: (input: { agentId?: string; modelId?: string }) => void,
): SubagentRunner {
  return {
    async spawn(input) {
      spawnSpy?.(input);
      const handle: SubagentHandle = { sessionId: HOP, run, dispose() {} };
      return handle;
    },
  };
}

/** A promise that resolves when the signal aborts (never resolves if there is no signal). */
function aborted(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (!signal) return;
    if (signal.aborted) return resolve();
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

/** Polls until a condition holds (test helper). */
async function until(cond: () => boolean, ms = 3000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error("condition not met in time");
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** Collects yielded messages and captures the generator's return value (the tool reports its
 *  finish reason via the return value). */
async function collectWithReturn(
  gen: AsyncGenerator<OmniMessage, ToolResult | void>,
): Promise<{ out: OmniMessage[]; result: ToolResult | void }> {
  const out: OmniMessage[] = [];
  for (;;) {
    const res = await gen.next();
    if (res.done) return { out, result: res.value };
    out.push(res.value);
  }
}

/** Concatenates the tool's own (origin-free) output deltas. */
const ownDeltas = (out: OmniMessage[]): string =>
  out
    .filter(
      (m) =>
        !m.origin?.length &&
        pl(m).type === "partial_tool_call_output" &&
        pl(m).event_type === "delta",
    )
    .map((m) => pl(m).output ?? "")
    .join("");

/** Extracts the subagent_id from run_subagent's finishing note. */
function extractSubagentId(result: ToolResult | void): string {
  const m = (result?.note ?? "").match(/subagent_id (subagent-[0-9a-f]+)/);
  expect(m, `expected a subagent_id in: ${JSON.stringify(result?.note)}`).toBeTruthy();
  return m![1]!;
}

const managers: SubagentSessionManager[] = [];
function makeServices(runner?: SubagentRunner): {
  services: EnvironmentServices;
  manager: SubagentSessionManager;
} {
  const manager = new SubagentSessionManager();
  managers.push(manager);
  return {
    services: { ...(runner ? { subagentRunner: runner } : {}), subagentSessions: manager },
    manager,
  };
}

afterEach(() => {
  for (const m of managers.splice(0)) m.dispose();
});

describe("run_subagent tool (foreground)", () => {
  it("forwards stamped child messages and mirrors child text as its own output deltas", async () => {
    const seen: Array<{ prompt?: string; agentId?: string; modelId?: string }> = [];
    const runner = runnerOf(
      async function* (input) {
        seen[0] = { ...seen[0], prompt: input.prompt };
        yield withOrigin(partialText("delta", "Hello "), HOP);
        yield withOrigin(partialText("delta", input.prompt), HOP);
      },
      (input) => {
        seen[0] = { ...input };
      },
    );
    const { services } = makeServices(runner);
    const tool = createSubagentTool(DEF, services);
    const { out, result } = await collectWithReturn(
      tool.execute({ prompt: "world", agent_id: "researcher", model_id: "m1" }, CTX),
    );

    // Child session messages pass through verbatim (with origin).
    const forwarded = out.filter((m) => m.origin?.length);
    expect(forwarded).toHaveLength(2);
    expect(forwarded[0]!.origin![0]).toEqual(HOP);
    // The child's text deltas are mirrored as this tool's own output (Environment derives the
    // complete tool_call_output from this).
    expect(ownDeltas(out)).toBe("Hello world");
    expect(result?.stopReason).toBe("completed");
    // The model is free to choose the agent and model (spawn arguments); the prompt is
    // handed to run.
    expect(seen[0]).toEqual({ prompt: "world", agentId: "researcher", modelId: "m1" });
  });

  it("does not mirror deeper-nested (origin.length > 1) text into its own output", async () => {
    const grandHop: MessageOrigin = "sess_grandchild";
    const runner = runnerOf(async function* () {
      // Grandchild-level text (two hops): only forwarded, not counted as the child Agent's reply.
      yield withOrigin(withOrigin(partialText("delta", "deep"), grandHop), HOP);
      yield withOrigin(partialText("delta", "answer"), HOP);
    });
    const { services } = makeServices(runner);
    const tool = createSubagentTool(DEF, services);
    const { out } = await collectWithReturn(tool.execute({ prompt: "x" }, CTX));
    expect(ownDeltas(out)).toBe("answer");
    // Grandchild-level messages are still forwarded (origin two hops).
    expect(out.some((m) => (m.origin?.length ?? 0) === 2)).toBe(true);
  });

  it("fails gracefully when no runner is injected", async () => {
    const { services } = makeServices();
    const tool = createSubagentTool(DEF, services);
    const { out, result } = await collectWithReturn(tool.execute({ prompt: "x" }, CTX));
    expect(result?.stopReason).toBe("failed");
    expect(ownDeltas(out)).toContain("no subagent runner");
  });

  it("fails when the required prompt is missing", async () => {
    const runner = runnerOf(
      // eslint-disable-next-line require-yield
      async function* () {
        /* never invoked */
      },
    );
    const { services } = makeServices(runner);
    const tool = createSubagentTool(DEF, services);
    const { out, result } = await collectWithReturn(tool.execute({}, CTX));
    expect(result?.stopReason).toBe("failed");
    expect(ownDeltas(out)).toContain("prompt");
  });

  it("notes when the subagent produces no text", async () => {
    const runner = runnerOf(
      // eslint-disable-next-line require-yield
      async function* () {
        /* yields no assistant text */
      },
    );
    const { services } = makeServices(runner);
    const tool = createSubagentTool(DEF, services);
    const { result } = await collectWithReturn(tool.execute({ prompt: "x" }, CTX));
    expect(result?.stopReason).toBe("completed");
    expect(result?.note).toContain("without a text answer");
  });

  it("reports a failed delegation when the child session aborts", async () => {
    const runner = runnerOf(async function* () {
      yield withOrigin(partialText("delta", "partial"), HOP);
      yield withOrigin(abortEvent("llm error"), HOP);
    });
    const { services } = makeServices(runner);
    const tool = createSubagentTool(DEF, services);
    const { result } = await collectWithReturn(tool.execute({ prompt: "x" }, CTX));
    expect(result?.stopReason).toBe("failed");
    expect(result?.note).toContain("subagent aborted: llm error");
  });

  it("surfaces child approval requests through the parent approve callback", async () => {
    const askedFor: string[] = [];
    const approve: ApproveFn = async (tc) => {
      askedFor.push(tc.payload.name);
      expect(tc.origin?.length).toBe(1); // The approval request carries origin, so the approval UI can identify its source
      return "allow";
    };
    const runner = runnerOf(async function* ({ approve: childApprove }) {
      const decision = childApprove
        ? await childApprove(
            withOrigin(toolCall({ name: "exec_command", arguments: "{}", toolCallId: "t1" }), HOP),
          )
        : "deny";
      yield withOrigin(partialText("delta", `decision:${decision}`), HOP);
    });
    const { services } = makeServices(runner);
    const tool = createSubagentTool(DEF, services);
    const { out, result } = await collectWithReturn(
      tool.execute({ prompt: "x" }, { ...CTX, approve }),
    );
    expect(result?.stopReason).toBe("completed");
    expect(ownDeltas(out)).toContain("decision:allow");
    expect(askedFor).toEqual(["exec_command"]);
  });

  it("kills the child and reports aborted when interrupted during the start window", async () => {
    let sawAbort = false;
    const runner = runnerOf(async function* ({ signal }) {
      yield withOrigin(partialText("delta", "working"), HOP);
      await aborted(signal);
      sawAbort = true;
    });
    const { services } = makeServices(runner);
    const tool = createSubagentTool(DEF, services);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    const { result } = await collectWithReturn(
      tool.execute({ prompt: "x", yield_time_ms: 10_000 }, { ...CTX, signal: controller.signal }),
    );
    expect(result?.stopReason).toBe("aborted");
    await until(() => sawAbort);
  });
});

describe("run_subagent backgrounding + input_subagent", () => {
  /** A child Agent whose first-turn task is stuck on a gate: after backgrounding, the test
   *  controls when it finishes. */
  function gatedChild(): {
    run: (input: RunInput) => AsyncGenerator<OmniMessage>;
    release: () => void;
    prompts: string[];
  } {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const prompts: string[] = [];
    const run = async function* ({ prompt, signal }: RunInput): AsyncGenerator<OmniMessage> {
      prompts.push(prompt);
      if (prompts.length === 1) {
        yield withOrigin(partialText("delta", `start:${prompt} `), HOP);
        await Promise.race([gate, aborted(signal)]);
        if (signal?.aborted) return;
        yield withOrigin(partialText("delta", `end:${prompt}`), HOP);
        return;
      }
      yield withOrigin(partialText("delta", `ran:${prompt}`), HOP);
    };
    return { run, release, prompts };
  }

  it("yields a subagent_id when the subagent is still working past yield_time_ms", async () => {
    const child = gatedChild();
    const { services, manager } = makeServices(runnerOf(child.run));
    const tool = createSubagentTool(DEF, services);
    const { out, result } = await collectWithReturn(
      tool.execute({ prompt: "task", yield_time_ms: 250 }, CTX),
    );
    expect(result?.stopReason).toBe("completed");
    expect(ownDeltas(out)).toBe("start:task ");
    const id = extractSubagentId(result);
    // subagent_id is derived from the tail of the child Session id: it can be correlated with
    // the message origin / frontend nesting tag.
    expect(id).toBe(`subagent-${HOP.slice(-8)}`);
    expect(manager.get(id)).toBeDefined();
    child.release();
  });

  it("polls a background subagent and reports the final status when it finishes", async () => {
    const child = gatedChild();
    const { services } = makeServices(runnerOf(child.run));
    const runTool = createSubagentTool(DEF, services);
    const { result: started } = await collectWithReturn(
      runTool.execute({ prompt: "task", yield_time_ms: 250 }, CTX),
    );
    const id = extractSubagentId(started);

    child.release();
    const writeTool = createInputSubagentTool(INPUT_DEF, services);
    const { out, result } = await collectWithReturn(
      writeTool.execute({ subagent_id: id, yield_time_ms: 3000 }, CTX),
    );
    // Output buffered while backgrounded is delivered on the tail via polling; after a turn
    // ends, the session is kept (resumable).
    expect(ownDeltas(out)).toContain("end:task");
    expect(result?.stopReason).toBe("completed");
    expect(result?.note).toContain(`subagent idle with subagent_id ${id}`);
  });

  it("continues the same subagent session with a follow-up prompt", async () => {
    const child = gatedChild();
    const { services } = makeServices(runnerOf(child.run));
    const runTool = createSubagentTool(DEF, services);
    const { result: started } = await collectWithReturn(
      runTool.execute({ prompt: "one", yield_time_ms: 250 }, CTX),
    );
    const id = extractSubagentId(started);
    child.release();
    const writeTool = createInputSubagentTool(INPUT_DEF, services);
    await collectWithReturn(writeTool.execute({ subagent_id: id, yield_time_ms: 3000 }, CTX));

    // Appends a Prompt: resumes for a second turn on the same child Session.
    const { out, result } = await collectWithReturn(
      writeTool.execute({ subagent_id: id, prompt: "two", yield_time_ms: 3000 }, CTX),
    );
    expect(ownDeltas(out)).toContain("ran:two");
    expect(result?.stopReason).toBe("completed");
    expect(child.prompts).toEqual(["one", "two"]);
  });

  it("rejects a follow-up prompt while the subagent is still running", async () => {
    const child = gatedChild();
    const { services } = makeServices(runnerOf(child.run));
    const runTool = createSubagentTool(DEF, services);
    const { result: started } = await collectWithReturn(
      runTool.execute({ prompt: "task", yield_time_ms: 250 }, CTX),
    );
    const id = extractSubagentId(started);

    const writeTool = createInputSubagentTool(INPUT_DEF, services);
    const { out, result } = await collectWithReturn(
      writeTool.execute({ subagent_id: id, prompt: "more", yield_time_ms: 250 }, CTX),
    );
    expect(result?.stopReason).toBe("failed");
    expect(ownDeltas(out)).toContain("still running");
    child.release();
  });

  it("reports an unknown subagent_id without throwing", async () => {
    const { services } = makeServices();
    const writeTool = createInputSubagentTool(INPUT_DEF, services);
    const { out, result } = await collectWithReturn(
      writeTool.execute({ subagent_id: "subagent-deadbeef" }, CTX),
    );
    expect(result?.stopReason).toBe("failed");
    expect(ownDeltas(out)).toContain("unknown subagent_id subagent-deadbeef");
  });

  it("queues child approvals while backgrounded and surfaces them on the next poll", async () => {
    const runner = runnerOf(async function* ({ approve }: RunInput) {
      yield withOrigin(partialText("delta", "working "), HOP);
      const decision = approve
        ? await approve(
            withOrigin(toolCall({ name: "exec_command", arguments: "{}", toolCallId: "t1" }), HOP),
          )
        : "deny";
      yield withOrigin(partialText("delta", `approved:${decision}`), HOP);
    });
    const { services } = makeServices(runner);
    // The start call has no approve: once the window ends and it backgrounds, the child
    // session's approval request queues up waiting.
    const runTool = createSubagentTool(DEF, services);
    const { result: started } = await collectWithReturn(
      runTool.execute({ prompt: "task", yield_time_ms: 250 }, CTX),
    );
    const id = extractSubagentId(started);
    expect(started?.note).toContain("waiting for approval of 1 tool call(s)");

    // Polling hooks up the approval outlet: the queued request is put to ctx.approve, and the
    // decision is sent back to the child session.
    const approve: ApproveFn = async () => "allow";
    const writeTool = createInputSubagentTool(INPUT_DEF, services);
    const { out, result } = await collectWithReturn(
      writeTool.execute({ subagent_id: id, yield_time_ms: 3000 }, { ...CTX, approve }),
    );
    expect(ownDeltas(out)).toContain("approved:allow");
    expect(result?.stopReason).toBe("completed");
  });

  it("refuses to spawn beyond the background subagent capacity", async () => {
    const { services, manager } = makeServices(
      runnerOf(async function* ({ signal }) {
        yield withOrigin(partialText("delta", "x"), HOP);
        await aborted(signal);
      }),
    );
    // Fills the concurrency limit: 8 running background sessions (running ones cannot be evicted).
    for (let i = 0; i < 8; i += 1) {
      const session = new ManagedSubagentSession({
        sessionId: `session-occupy-0000000${i}`,
        // eslint-disable-next-line require-yield
        run: async function* ({ signal }: RunInput): AsyncGenerator<OmniMessage> {
          await aborted(signal);
        },
        dispose() {},
      });
      session.startRun("occupy");
      manager.register(session);
    }
    const tool = createSubagentTool(DEF, services);
    const { out, result } = await collectWithReturn(tool.execute({ prompt: "x" }, CTX));
    expect(result?.stopReason).toBe("failed");
    expect(ownDeltas(out)).toContain("too many background subagents");
  });

  it("aborts background subagents and denies pending approvals on dispose", async () => {
    let sawAbort = false;
    let decision: string | null = null;
    const runner = runnerOf(async function* ({ approve, signal }: RunInput) {
      yield withOrigin(partialText("delta", "working"), HOP);
      if (approve) {
        decision = await approve(
          withOrigin(toolCall({ name: "exec_command", arguments: "{}", toolCallId: "t1" }), HOP),
        );
      }
      await aborted(signal);
      sawAbort = true;
    });
    const { services, manager } = makeServices(runner);
    const tool = createSubagentTool(DEF, services);
    const { result } = await collectWithReturn(
      tool.execute({ prompt: "task", yield_time_ms: 250 }, CTX),
    );
    extractSubagentId(result);

    manager.dispose();
    await until(() => sawAbort);
    expect(decision).toBe("deny");
  });

  it("delivers output arriving while the consumer is suspended without waiting out the window", async () => {
    // Wake-race regression: when output arrives while suspended at `yield`, its wakeup happens
    // before the next wait begins (so it would be missed). collectWindow must re-check the
    // buffer right before sleeping, otherwise this batch of output would not be delivered
    // until the window ends (here, 5s).
    let emitSecond: (() => void) | null = null;
    const session = new ManagedSubagentSession({
      sessionId: HOP,
      run: async function* ({ signal }: RunInput): AsyncGenerator<OmniMessage> {
        yield withOrigin(partialText("delta", "first"), HOP);
        await new Promise<void>((resolve) => {
          emitSecond = resolve;
        });
        yield withOrigin(partialText("delta", "second"), HOP);
        await aborted(signal);
      },
      dispose() {},
    });
    try {
      session.startRun("go");
      const gen = collectWindow(session, { yieldMs: 5000, toolCallId: "call_race" });
      const first = await gen.next(); // First: the forwarded "first" child session message
      expect(first.done).toBe(false);
      // The generator is still suspended at the yield above: releasing "second" now means both
      // buffering and the wakeup have already happened.
      await until(() => emitSecond !== null);
      emitSecond!();
      await until(() => session.hasPending);
      const startedAt = Date.now();
      let out = "";
      for (;;) {
        const res = await gen.next();
        expect(res.done).toBe(false);
        const p = pl(res.value as OmniMessage);
        if (p.type === "partial_text" || p.type === "partial_tool_call_output") {
          out += (res.value.payload as { text?: string; output?: string }).text ?? p.output ?? "";
        }
        if (out.includes("second")) break;
      }
      expect(Date.now() - startedAt).toBeLessThan(1500);
      await gen.return(undefined);
    } finally {
      session.kill();
    }
  });
});
