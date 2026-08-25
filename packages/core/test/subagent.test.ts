/**
 * Behavior tests for run_subagent / input_subagent: foreground delegation, backgrounding,
 * polling, resuming with an appended Prompt, the approval queue, and lifecycle finalization.
 */
import { afterEach, describe, expect, it } from "vitest";
import { Environment } from "../src/environment/index.js";
import { createSubagentTool } from "../src/environment/tools/run-subagent.js";
import { createInputSubagentTool } from "../src/environment/tools/input-subagent.js";
import {
  ManagedSubagentSession,
  SubagentSessionManager,
} from "../src/environment/tools/subagent/index.js";
import {
  abortEvent,
  assistantText,
  partialText,
  toolCall,
  userText,
  withOrigin,
} from "../src/omnimessage/index.js";
import { collectWindow } from "../src/environment/tools/subagent/collect.js";
import type { MessageOrigin, OmniMessage } from "../src/omnimessage/index.js";
import type {
  ApproveFn,
  EnvironmentServices,
  SubagentHandle,
  SubagentRunner,
  ToolDefinitionConfig,
} from "../src/interfaces/index.js";
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

/**
 * Test fakes still talk in prompt strings; the contract now takes the OmniMessage list a
 * Session's `run` takes, so the adapters below unwrap it once (see SubagentHandle.run).
 */
const promptOf = (messages: OmniMessage[]): string =>
  messages.map((m) => (m.payload as { text?: string }).text ?? "").join("");

/** Adapts a prompt-string fake to SubagentHandle.run's OmniMessage input. */
const asHandleRun =
  <T extends RunInput>(run: (input: T) => AsyncGenerator<OmniMessage>): SubagentHandle["run"] =>
  ({ messages, ...rest }) =>
    run({ prompt: promptOf(messages), ...rest } as unknown as T);

/** Builds a SubagentRunner from a run implementation (spawn arguments observed via a spy). */
function runnerOf(
  run: (input: RunInput) => AsyncGenerator<OmniMessage>,
  spawnSpy?: (input: {
    agentId?: string;
    modelId?: string;
    provider?: string;
    thinkingLevel?: string;
  }) => void,
): SubagentRunner {
  return {
    async spawn(input) {
      spawnSpy?.(input);
      const handle: SubagentHandle = {
        sessionId: HOP,
        run: ({ messages, ...rest }) => run({ prompt: promptOf(messages), ...rest }),
        dispose() {},
      };
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
    const seen: Array<{
      prompt?: string;
      agentId?: string;
      modelId?: string;
      provider?: string;
      thinkingLevel?: string;
    }> = [];
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
      tool.execute(
        {
          prompt: "world",
          agent_id: "researcher",
          model_id: "m1",
          provider: "p1",
          thinking_level: "high",
        },
        CTX,
      ),
    );

    // Child session messages pass through verbatim (with origin).
    const forwarded = out.filter((m) => m.origin?.length);
    expect(forwarded).toHaveLength(2);
    expect(forwarded[0]!.origin![0]).toEqual(HOP);
    // The child's text deltas are mirrored as this tool's own output (Environment derives the
    // complete tool_call_output from this).
    expect(ownDeltas(out)).toBe("Hello world");
    expect(result?.stopReason).toBe("completed");
    // The model is free to choose the agent, model, and thinking level (spawn arguments); the
    // prompt is handed to run.
    expect(seen[0]).toEqual({
      prompt: "world",
      agentId: "researcher",
      modelId: "m1",
      provider: "p1",
      thinkingLevel: "high",
    });
  });

  it("rejects half a model reference in either direction, and never spawns", async () => {
    // A model is referenced by the (provider, model_id) pair; the tool refuses half of one
    // rather than letting the session layer guess a group for a bare upstream id.
    for (const args of [
      { prompt: "x", model_id: "m1" },
      { prompt: "x", provider: "p1" },
    ]) {
      const spawned: unknown[] = [];
      const runner = runnerOf(
        async function* () {},
        (input) => spawned.push(input),
      );
      const { services } = makeServices(runner);
      const tool = createSubagentTool(DEF, services);
      const { out, result } = await collectWithReturn(tool.execute(args, CTX));
      expect(result?.stopReason).toBe("failed");
      expect(ownDeltas(out)).toContain("must be given together");
      expect(spawned).toHaveLength(0);
    }
  });

  it("leaves an omitted model reference to the runner, which inherits the parent session's model", async () => {
    // With neither half given, the tool forwards NO pair — it never invents one; the real
    // runner (the spawn closure in agent.ts) then fills in the PARENT session's model, not
    // the Project default (that inheritance is locked in agent.test.ts).
    const seen: Array<{ modelId?: string; provider?: string }> = [];
    const runner = runnerOf(
      async function* () {
        yield withOrigin(partialText("delta", "ok"), HOP);
      },
      (input) => seen.push(input),
    );
    const { services } = makeServices(runner);
    const tool = createSubagentTool(DEF, services);
    const { result } = await collectWithReturn(tool.execute({ prompt: "x" }, CTX));
    expect(result?.stopReason).toBe("completed");
    expect(seen).toHaveLength(1);
    expect(seen[0]?.modelId).toBeUndefined();
    expect(seen[0]?.provider).toBeUndefined();
  });

  it("rejects a thinking_level outside the selectable tiers, and never spawns", async () => {
    // A typo must fail loudly: silently inheriting a level the caller did not ask for would
    // defeat the override. "none" is deliberately not offered (mirroring the pickers — many
    // models cannot disable thinking), so it is rejected like any other unknown value.
    for (const thinking_level of ["hgih", "none", "", 3]) {
      const spawned: unknown[] = [];
      const runner = runnerOf(
        async function* () {},
        (input) => spawned.push(input),
      );
      const { services } = makeServices(runner);
      const tool = createSubagentTool(DEF, services);
      const { out, result } = await collectWithReturn(
        tool.execute({ prompt: "x", thinking_level }, CTX),
      );
      expect(result?.stopReason).toBe("failed");
      expect(ownDeltas(out)).toContain("invalid `thinking_level`");
      expect(ownDeltas(out)).toContain("low / medium / high / xhigh / max");
      expect(spawned).toHaveLength(0);
    }
  });

  it("forwards NO thinking level when the argument is omitted or null (the runner inherits)", async () => {
    // Omission means "inherit the parent session's effective level" — the tool forwards
    // nothing and the real runner (the spawn closure in agent.ts) resolves the inheritance
    // (locked in agent.test.ts). A JSON null counts as omitted, like a missing key.
    for (const args of [{ prompt: "x" }, { prompt: "x", thinking_level: null }]) {
      const seen: Array<{ thinkingLevel?: string }> = [];
      const runner = runnerOf(
        async function* () {
          yield withOrigin(partialText("delta", "ok"), HOP);
        },
        (input) => seen.push(input),
      );
      const { services } = makeServices(runner);
      const tool = createSubagentTool(DEF, services);
      const { result } = await collectWithReturn(tool.execute(args, CTX));
      expect(result?.stopReason).toBe("completed");
      expect(seen).toHaveLength(1);
      expect("thinkingLevel" in seen[0]!).toBe(false);
    }
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
        yield withOrigin(assistantText(`start:${prompt} end:${prompt}`), HOP);
        return;
      }
      yield withOrigin(partialText("delta", `ran:${prompt}`), HOP);
      yield withOrigin(assistantText(`ran:${prompt}`), HOP);
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

  it("rejects a mid-run prompt when the handle predates steering", async () => {
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
      yield withOrigin(assistantText(`approved:${decision}`), HOP);
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
        run: async function* ({ signal }): AsyncGenerator<OmniMessage> {
          await aborted(signal);
        },
        dispose() {},
      });
      session.startRun([userText("occupy")]);
      manager.register(session);
    }
    const tool = createSubagentTool(DEF, services);
    const { out, result } = await collectWithReturn(tool.execute({ prompt: "x" }, CTX));
    expect(result?.stopReason).toBe("failed");
    expect(ownDeltas(out)).toContain("too many background subagents");
  });

  it("aborts background subagents and denies pending approvals on dispose", async () => {
    let sawAbort = false;
    let decision: unknown = null;
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
      run: async function* ({ signal }): AsyncGenerator<OmniMessage> {
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
      session.startRun([userText("go")]);
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

describe("subagent steering and per-run abort", () => {
  /**
   * A steer-capable child: round 1 pends until released or aborted (an abort emits the
   * child's abort event, as a real interrupted child session does); later rounds finish
   * immediately. Records every prompt and steering delivery.
   */
  function steerableChild(): {
    runner: SubagentRunner;
    prompts: string[];
    /** Each round's raw input messages (the contract's own shape — sender included). */
    inputs: OmniMessage[][];
    steers: OmniMessage[][];
    release: () => void;
  } {
    const prompts: string[] = [];
    const inputs: OmniMessage[][] = [];
    const steers: OmniMessage[][] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const runner: SubagentRunner = {
      async spawn() {
        const handle: SubagentHandle = {
          sessionId: HOP,
          async *run({ messages, signal }): AsyncGenerator<OmniMessage> {
            const prompt = promptOf(messages);
            inputs.push(messages);
            prompts.push(prompt);
            if (prompts.length === 1) {
              yield withOrigin(partialText("delta", `start:${prompt} `), HOP);
              await Promise.race([gate, aborted(signal)]);
              if (signal?.aborted) {
                yield withOrigin(abortEvent("run aborted"), HOP);
                return;
              }
              yield withOrigin(partialText("delta", `end:${prompt}`), HOP);
              yield withOrigin(assistantText(`end:${prompt}`), HOP);
              return;
            }
            yield withOrigin(partialText("delta", `ran:${prompt}`), HOP);
            yield withOrigin(assistantText(`ran:${prompt}`), HOP);
          },
          steer(messages) {
            steers.push(messages);
            return true;
          },
          dispose() {},
        };
        return handle;
      },
    };
    return { runner, prompts, inputs, steers, release: () => release() };
  }

  it("queues a mid-run prompt as a steering message with the parent_agent sender", async () => {
    const child = steerableChild();
    const { services } = makeServices(child.runner);
    const runTool = createSubagentTool(DEF, services);
    const { result: started } = await collectWithReturn(
      runTool.execute({ prompt: "task", yield_time_ms: 250 }, CTX),
    );
    const id = extractSubagentId(started);

    const writeTool = createInputSubagentTool(INPUT_DEF, services);
    const { out, result } = await collectWithReturn(
      writeTool.execute({ subagent_id: id, prompt: "go left", yield_time_ms: 250 }, CTX),
    );
    expect(ownDeltas(out)).toContain(`steering message queued for subagent ${id}`);
    expect(result?.stopReason).toBe("completed");
    expect(result?.note).toContain("still running");
    expect(child.steers).toHaveLength(1);
    const payload = child.steers[0]![0]!.payload as { text?: string; sender?: string };
    expect(payload.text).toBe("go left");
    expect(payload.sender).toBe("parent_agent");
    // No new round was started: the prompt rode the running one.
    expect(child.prompts).toEqual(["task"]);
    child.release();
  });

  it("abort ends only the current run; the session survives for a follow-up", async () => {
    const child = steerableChild();
    const { services, manager } = makeServices(child.runner);
    const runTool = createSubagentTool(DEF, services);
    const { result: started } = await collectWithReturn(
      runTool.execute({ prompt: "task", yield_time_ms: 250 }, CTX),
    );
    const id = extractSubagentId(started);

    const writeTool = createInputSubagentTool(INPUT_DEF, services);
    const { out, result } = await collectWithReturn(
      writeTool.execute({ subagent_id: id, abort: true, yield_time_ms: 3000 }, CTX),
    );
    expect(ownDeltas(out)).toContain(`aborting subagent ${id}'s current run`);
    // The aborted round settles as failed with the child's abort reason; the session is kept.
    expect(result?.stopReason).toBe("failed");
    expect(result?.note).toContain("subagent aborted");
    expect(result?.note).toContain(`subagent idle with subagent_id ${id}`);
    expect(manager.get(id)).toBeDefined();

    const followUp = await collectWithReturn(
      writeTool.execute({ subagent_id: id, prompt: "again", yield_time_ms: 3000 }, CTX),
    );
    expect(ownDeltas(followUp.out)).toContain("ran:again");
    expect(followUp.result?.stopReason).toBe("completed");
    expect(child.prompts).toEqual(["task", "again"]);
  });

  it("abort with a prompt interrupts and redirects in one call", async () => {
    const child = steerableChild();
    const { services } = makeServices(child.runner);
    const runTool = createSubagentTool(DEF, services);
    const { result: started } = await collectWithReturn(
      runTool.execute({ prompt: "task", yield_time_ms: 250 }, CTX),
    );
    const id = extractSubagentId(started);

    const writeTool = createInputSubagentTool(INPUT_DEF, services);
    const { out, result } = await collectWithReturn(
      writeTool.execute(
        { subagent_id: id, abort: true, prompt: "redirect", yield_time_ms: 3000 },
        CTX,
      ),
    );
    expect(ownDeltas(out)).toContain("ran:redirect");
    expect(result?.stopReason).toBe("completed");
    expect(child.prompts).toEqual(["task", "redirect"]);
    // The redirect ran fresh — nothing was delivered as steering.
    expect(child.steers).toHaveLength(0);
  });

  it("abort on an idle subagent is a harmless no-op", async () => {
    const child = steerableChild();
    const { services } = makeServices(child.runner);
    const runTool = createSubagentTool(DEF, services);
    const { result: started } = await collectWithReturn(
      runTool.execute({ prompt: "task", yield_time_ms: 250 }, CTX),
    );
    const id = extractSubagentId(started);
    child.release();
    const writeTool = createInputSubagentTool(INPUT_DEF, services);
    await collectWithReturn(writeTool.execute({ subagent_id: id, yield_time_ms: 3000 }, CTX));

    const { out, result } = await collectWithReturn(
      writeTool.execute({ subagent_id: id, abort: true, yield_time_ms: 250 }, CTX),
    );
    expect(ownDeltas(out)).toContain("already idle; nothing to abort");
    expect(result?.stopReason).toBe("completed");
  });

  it("exposes list/steer/abort to the host via Environment, converging on the same channel", async () => {
    const child = steerableChild();
    const env = new Environment({
      workspaceDir: "/tmp/ws",
      toolConfig: { customTools: [DEF], mcpServers: [] },
      services: { subagentRunner: child.runner },
    });
    try {
      let pings = 0;
      env.setSubagentStateListener(() => {
        pings += 1;
      });
      const forwarded: OmniMessage[] = [];
      env.setBackgroundMessageListener((msg) => forwarded.push(msg));

      // Spawn through the real tool path; the window expires with the child still running.
      const gen = env.executeTool({
        toolCall: toolCall({
          name: "run_subagent",
          arguments: JSON.stringify({ prompt: "task", yield_time_ms: 250 }),
          toolCallId: "c_env",
        }),
      });
      for (;;) {
        const res = await gen.next();
        if (res.done) break;
      }

      expect(env.listBackgroundSubagents()).toEqual([
        { sessionId: HOP, subagentId: `subagent-${HOP.slice(-8)}`, running: true },
      ]);

      // Host steering while running: human sender (field absent), same handle channel.
      expect(await env.sendToBackgroundSubagent(HOP, [userText("from the panel")])).toBe("steered");
      expect(child.steers).toHaveLength(1);
      const payload = child.steers[0]![0]!.payload as { text?: string; sender?: string };
      expect(payload.text).toBe("from the panel");
      expect(payload.sender).toBeUndefined();

      // Host abort ends the round; the settle pings the state listener and the listing flips.
      expect(env.abortBackgroundSubagentRun(HOP)).toBe(true);
      await until(() => env.listBackgroundSubagents()[0]?.running === false);
      expect(pings).toBeGreaterThan(0);

      // Host message on the idle child starts a follow-up round; its messages reach the
      // frontend live through the tap the first host touch attached.
      expect(await env.sendToBackgroundSubagent(HOP, [userText("round two")])).toBe("started");
      await until(() => env.listBackgroundSubagents()[0]?.running === false);
      expect(child.prompts).toEqual(["task", "round two"]);
      // The caller's own message reaches the child unchanged: a human's panel round records
      // no sender, exactly like the steering above — only the model's dispatch is
      // "parent_agent" (round one, through run_subagent).
      const [dispatched, panelRound] = child.inputs as [OmniMessage[], OmniMessage[]];
      expect((dispatched[0]!.payload as { sender?: string }).sender).toBe("parent_agent");
      expect((panelRound[0]!.payload as { sender?: string }).sender).toBeUndefined();
      await until(() =>
        forwarded.some((m) => {
          const p = m.payload as { type?: string; text?: string };
          return p.type === "partial_text" && (p.text ?? "").includes("ran:round two");
        }),
      );

      expect(await env.sendToBackgroundSubagent("session-unknown", [userText("x")])).toBe("gone");
      expect(env.abortBackgroundSubagentRun("session-unknown")).toBe(false);
    } finally {
      env.dispose();
    }
  });

  it("escalates a windowless child approval through the host fallback sink", async () => {
    const runner = runnerOf(async function* ({ approve }: RunInput) {
      yield withOrigin(partialText("delta", "working "), HOP);
      const decision = approve
        ? await approve(
            withOrigin(toolCall({ name: "exec_command", arguments: "{}", toolCallId: "t1" }), HOP),
          )
        : "deny";
      yield withOrigin(partialText("delta", `approved:${decision}`), HOP);
      yield withOrigin(assistantText(`approved:${decision}`), HOP);
    });
    const env = new Environment({
      workspaceDir: "/tmp/ws",
      toolConfig: { customTools: [DEF], mcpServers: [] },
      services: { subagentRunner: runner },
    });
    try {
      const consulted: string[] = [];
      env.setSubagentApprovalFallback(async (tc) => {
        consulted.push(tc.payload.tool_call_id);
        return "allow";
      });
      // The spawning call carries NO approve: no window sink, no background-launch standing
      // sink — previously this approval parked until the model's next poll. With the host
      // fallback it resolves inside the window and the child finishes normally.
      const gen = env.executeTool({
        toolCall: toolCall({
          name: "run_subagent",
          arguments: JSON.stringify({ prompt: "task", yield_time_ms: 3000 }),
          toolCallId: "c_fallback",
        }),
      });
      const out: OmniMessage[] = [];
      for (;;) {
        const res = await gen.next();
        if (res.done) break;
        out.push(res.value);
      }
      const complete = out[out.length - 1]!.payload as { output?: string };
      expect(complete.output).toContain("approved:allow");
      expect(consulted).toEqual(["t1"]);
    } finally {
      env.dispose();
    }
  });

  it("revives a released child through the runner's resume and starts its next round", async () => {
    const prompts: string[] = [];
    const levels: (string | undefined)[] = [];
    const resumes: { agentId?: string; sessionId: string }[] = [];
    const run = async function* ({
      prompt,
      thinkingLevel,
    }: RunInput & { thinkingLevel?: string }): AsyncGenerator<OmniMessage> {
      prompts.push(prompt);
      levels.push(thinkingLevel);
      yield withOrigin(partialText("delta", `ran:${prompt}`), HOP);
    };
    const runner: SubagentRunner = {
      async spawn() {
        return { sessionId: HOP, run: asHandleRun(run), dispose() {} };
      },
      async resume(input) {
        resumes.push(input);
        return { sessionId: HOP, run: asHandleRun(run), dispose() {} };
      },
    };
    const env = new Environment({
      workspaceDir: "/tmp/ws",
      toolConfig: { customTools: [DEF], mcpServers: [] },
      services: { subagentRunner: runner },
    });
    try {
      // The child finishes inside the foreground window: never registered, killed at the end
      // of the call — released, exactly the state the panel later messages into.
      const gen = env.executeTool({
        toolCall: toolCall({
          name: "run_subagent",
          arguments: JSON.stringify({ prompt: "task" }),
          toolCallId: "c_resume",
        }),
      });
      for (;;) {
        const res = await gen.next();
        if (res.done) break;
      }
      expect(env.listBackgroundSubagents()).toEqual([]);

      // Without the resume option the child is simply gone; with it, the session revives,
      // re-registers (the model can address it again), and runs the message as a new round.
      expect(await env.sendToBackgroundSubagent(HOP, [userText("wake up")])).toBe("gone");
      expect(
        await env.sendToBackgroundSubagent(HOP, [userText("wake up")], {
          thinkingLevel: "high",
          resume: { agentId: "owner_agent" },
        }),
      ).toBe("resumed");
      expect(resumes).toEqual([{ agentId: "owner_agent", sessionId: HOP }]);
      await until(() => env.listBackgroundSubagents()[0]?.running === false);
      expect(env.listBackgroundSubagents()[0]!.subagentId).toBe(`subagent-${HOP.slice(-8)}`);
      expect(prompts).toEqual(["task", "wake up"]);
      // The per-turn thinking level rides only the round the message starts.
      expect(levels).toEqual([undefined, "high"]);
    } finally {
      env.dispose();
    }
  });

  it("input_subagent revives a released id through the runner (a subagent is never destroyed)", async () => {
    const prompts: string[] = [];
    const resumes: { agentId?: string; sessionId: string }[] = [];
    const run = async function* ({ prompt }: RunInput): AsyncGenerator<OmniMessage> {
      prompts.push(prompt);
      yield withOrigin(assistantText(`ran:${prompt}`), HOP);
    };
    const runner: SubagentRunner = {
      async spawn() {
        return { sessionId: HOP, run: asHandleRun(run), dispose() {} };
      },
      async resume(input) {
        resumes.push(input);
        return { sessionId: HOP, run: asHandleRun(run), dispose() {} };
      },
    };
    const { services, manager } = makeServices(runner);

    // Register the target, let its round settle, then fill the registry so capacity
    // eviction RELEASES it (frees the slot — nothing is destroyed).
    const target = new ManagedSubagentSession({
      sessionId: HOP,
      run: asHandleRun(run),
      dispose() {},
    });
    target.startRun([userText("first")]);
    await until(() => !target.running);
    manager.track(target);
    const id = manager.register(target);
    for (let i = 0; i < 8; i += 1) {
      const filler = new ManagedSubagentSession({
        sessionId: `session-filler-0000000${i}`,
        run: asHandleRun(run),
        dispose() {},
      });
      filler.startRun([userText("filler")]);
      await until(() => !filler.running);
      manager.register(filler);
    }
    expect(manager.get(id)).toBeUndefined();

    // The model messages the released id: the tombstone resumes the child (self-spawn — no
    // agentId recorded) and the prompt runs as its next round on the same handle.
    const input = createInputSubagentTool(INPUT_DEF, services);
    const { out, result } = await collectWithReturn(
      input.execute({ subagent_id: id, prompt: "again", yield_time_ms: 3000 }, CTX),
    );
    expect(ownDeltas(out)).toContain(`[subagent ${id} resumed]`);
    expect(ownDeltas(out)).toContain("ran:again");
    expect(result?.stopReason).toBe("completed");
    expect(resumes).toEqual([{ sessionId: HOP }]);
    expect(prompts).toContain("again");
    expect(manager.get(id)).toBeDefined();
  });

  it("tracks live sessions by child session id from spawn to kill", () => {
    const manager = new SubagentSessionManager();
    managers.push(manager);
    const session = new ManagedSubagentSession({
      sessionId: HOP,
      // eslint-disable-next-line require-yield
      async *run({ signal }): AsyncGenerator<OmniMessage> {
        await aborted(signal);
      },
      dispose() {},
    });
    manager.track(session);
    // Reachable by session id before any background registration (no subagent_id yet).
    expect(manager.bySessionId(HOP)).toBe(session);
    expect(manager.listLive()).toEqual([{ sessionId: HOP, subagentId: null, running: false }]);

    session.startRun([userText("occupy")]);
    const id = manager.register(session);
    expect(manager.listLive()).toEqual([{ sessionId: HOP, subagentId: id, running: true }]);

    session.kill();
    expect(manager.bySessionId(HOP)).toBeUndefined();
    expect(manager.listLive()).toEqual([]);
  });
});
