/**
 * The prompt cache across a Session's lifecycle, measured through the simulator.
 *
 * `prompt-cache-invariants.test.ts` asks whether the harness assembles each request as an
 * extension of the one before it. This suite asks the question a bill answers: with the
 * provider's own rules applied — the automatic breakpoint, the minimum cacheable prefix, the
 * position lookback, the five-minute TTL — does the conversation keep hitting the cache while it
 * is interrupted, backgrounded, delegated, scheduled, resumed, retuned and compacted?
 *
 * Each scenario drives a real `Session` over a real `GenerativeModel` whose provider stream is
 * scripted, feeds every recorded request to one `PromptCacheSim` in the order it was issued (the
 * simulator IS the provider for the scenario, child sessions and reopened contexts included), and
 * asserts through `expectHits` that each request reads back the whole prefix of the previous
 * request of its context. Where that cannot hold by design, the index is named in `allowed` with
 * the reason and the loss is bounded explicitly.
 *
 * The agent, the fake collaborators and `expectHits` itself live in `helpers/prompt-cache`; what
 * stays here is the scaffolding each scenario needs and the scenarios themselves.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Environment } from "../src/environment/index.js";
import { Session } from "../src/index.js";
import { buildScheduledMessage, sessionMeta, userText } from "../src/omnimessage/index.js";
import type { OmniMessage } from "../src/omnimessage/index.js";
import { Writer, readTrace, resumeTrace } from "../src/trace/index.js";
import type { CompactionSettings, TraceSink } from "../src/engine/context-engine.js";
import { DETACHED_TOOL_NOTE_PREFIX } from "../src/interfaces/index.js";
import type {
  EnvironmentInterface,
  LLMInterface,
  RunCutoff,
  SubagentHandle,
  SubagentRunner,
  ToolConfig,
  ToolDefinitionConfig,
  ToolDetachResult,
} from "../src/interfaces/index.js";
import {
  CHILD_SESSION_ID,
  MAIN,
  META,
  SESSION_ID,
  allowAll,
  blockTypes,
  collect,
  compactionSettings,
  expectHits,
  explainMiss,
  fakeEnvironment,
  fakeEnvironmentWith,
  formatCacheReport,
  modelConfig,
  ordering,
  positionCount,
  prefixTokens,
  recordingModel,
  replay,
  tokensBeforeLastUserMessage,
  toolTurn,
  wireMessage,
} from "./helpers/prompt-cache/index.js";
import type { RecordedRequest } from "./helpers/prompt-cache/index.js";

// ---------------------------------------------------------------------------
// Scaffolding each scenario needs
// ---------------------------------------------------------------------------

interface SessionSpec {
  llm: LLMInterface;
  environment: EnvironmentInterface;
  sessionId?: string;
  trace?: TraceSink;
  compaction?: CompactionSettings;
  openNextContext?: ConstructorParameters<typeof Session>[0]["openNextContext"];
  initialEngineState?: ConstructorParameters<typeof Session>[0]["initialEngineState"];
  metaAlreadyWritten?: boolean;
  modelSwitch?: ConstructorParameters<typeof Session>[0]["modelSwitch"];
}

function makeSession(spec: SessionSpec): Session {
  const session = new Session({
    meta: { ...META, ...(spec.sessionId ? { session_id: spec.sessionId } : {}) },
    bootstrap: async () => ({ llm: spec.llm }),
    environment: spec.environment,
    imagesDir: "/tmp/penguin-prompt-cache/scratchpad",
    modelHasVision: true,
    ...(spec.trace ? { trace: spec.trace } : {}),
    ...(spec.compaction ? { compaction: spec.compaction } : {}),
    ...(spec.openNextContext ? { openNextContext: spec.openNextContext } : {}),
    ...(spec.initialEngineState ? { initialEngineState: spec.initialEngineState } : {}),
    ...(spec.metaAlreadyWritten ? { metaAlreadyWritten: true } : {}),
    ...(spec.modelSwitch ? { modelSwitch: spec.modelSwitch } : {}),
  });
  cleanups.push(() => session.dispose());
  return session;
}

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

function toolDef(name: string): ToolDefinitionConfig {
  return { name, description: `${name} for the prompt-cache scenarios`, permission: "rw" };
}

const commandToolConfig = (names: string[]): ToolConfig => ({
  customTools: names.map(toolDef),
  mcpServers: [],
});

/** A real Environment over a scratch workspace, disposed after the test. */
async function makeEnvironment(names: string[], services?: { subagentRunner: SubagentRunner }) {
  const dir = await mkdtemp(path.join(tmpdir(), "penguin-prompt-cache-"));
  const environment = new Environment({
    workspaceDir: dir,
    toolConfig: commandToolConfig(names),
    ...(services ? { services } : {}),
  });
  cleanups.push(async () => {
    environment.dispose();
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });
  return { environment, dir };
}

/**
 * Waits until the predicate holds (real process exits, real background reports). The deadline
 * sits under this package's 5s test timeout, so a predicate that never holds fails here with its
 * own message rather than as an anonymous test timeout.
 */
async function waitFor(predicate: () => boolean): Promise<void> {
  await vi.waitFor(
    () => {
      if (!predicate()) throw new Error("condition not met yet");
    },
    { timeout: 4000, interval: 20 },
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("the prompt cache across a Session's lifecycle", () => {
  it("an ordinary conversation hits the prompt cache on every request after the first", async () => {
    const { order, onRequest } = ordering();
    const { model } = recordingModel(
      modelConfig(),
      [
        toolTurn(),
        { text: "The entry point re-exports the public API." },
        { text: "Nothing else has changed since." },
      ],
      { label: MAIN, onRequest },
    );
    const session = makeSession({ llm: model, environment: fakeEnvironment });

    await collect(session.run([userText("what does the entry point do?")], { approve: allowAll }));
    await collect(session.run([userText("anything else worth knowing?")], { approve: allowAll }));

    expect(order).toHaveLength(3);
    expectHits(order, replay(order));
  });

  it("an interrupted turn still hits the prompt cache up to its last user message", async () => {
    const { order, onRequest } = ordering();
    const { model } = recordingModel(
      modelConfig(),
      [
        toolTurn(),
        { text: "The entry point re-exports the public API." },
        { text: "Starting on the refactor", outcome: "abort-after-text" },
        { text: "Picking up from where that stopped." },
      ],
      { label: MAIN, onRequest },
    );
    const session = makeSession({ llm: model, environment: fakeEnvironment });

    await collect(session.run([userText("what does the entry point do?")], { approve: allowAll }));

    // Interrupt once the model's text is on the stream, so the aborted turn has output to fold.
    const controller = new AbortController();
    for await (const msg of session.run([userText("now refactor it")], {
      approve: allowAll,
      signal: controller.signal,
    })) {
      const payload = msg.payload as { type?: string; event_type?: string };
      if (payload.type === "partial_text" && payload.event_type === "delta") controller.abort();
    }
    await collect(session.run([userText("never mind, summarize instead")], { approve: allowAll }));

    expect(order).toHaveLength(4);
    const usages = replay(order);
    const reason =
      "the interrupted turn is folded into a [turn_aborted] carry-over, so the last user " +
      "message is rewritten and the interrupted request's own entry is unreachable";
    expectHits(order, usages, new Map([[3, reason]]));
    const report = formatCacheReport(order, usages);

    // The harness's half: the flattened carry-over and the new prompt ride one user message,
    // and the divergence never reaches earlier than that message.
    const folded = wireMessage(order[3]!, -1);
    expect(folded.role, report).toBe("user");
    expect(blockTypes(folded), report).toEqual(["text", "text"]);
    expect(folded.content[0]!.text, report).toContain("[turn_aborted]");
    expect(tokensBeforeLastUserMessage(order[3]!), report).toBe(
      tokensBeforeLastUserMessage(order[2]!),
    );
    // The provider's half: the only entry the interrupted request wrote ends at its own last
    // block, which is the block that was rewritten — so the read falls back to the breakpoint
    // the request before it closed. Nothing earlier than that is lost.
    expect(usages[3]!.cache_read_input_tokens, report).toBe(prefixTokens(order[1]!));
    expect(usages[3]!.cache_read_input_tokens, report).toBeLessThan(
      tokensBeforeLastUserMessage(order[3]!),
    );
  });

  it("a background command's completion notice still hits the prompt cache", async () => {
    const { environment } = await makeEnvironment(["exec_command", "input_command"]);
    const { order, onRequest } = ordering();
    const { model } = recordingModel(
      modelConfig({ tools: await environment.listTools() }),
      [
        {
          toolCalls: [
            {
              id: "call_bg",
              name: "exec_command",
              args: { cmd: "sleep 0.4; printf 'build ok'", run_in_background: true },
            },
          ],
        },
        { text: "Started it; I will report when it settles." },
        { text: "The build finished cleanly." },
      ],
      { label: MAIN, onRequest },
    );
    const session = makeSession({ llm: model, environment });

    await collect(session.run([userText("build it in the background")], { approve: allowAll }));
    await waitFor(() => session.hasPendingBackgroundNotices());
    const notices = session.takeBackgroundNotices();
    expect(notices).toHaveLength(1);
    await collect(session.run(notices, { approve: allowAll }));

    expect(order).toHaveLength(3);
    const usages = replay(order);
    expectHits(order, usages);
    const report = formatCacheReport(order, usages);
    const carried = wireMessage(order[2]!, -1);
    expect(carried.content[0]!.text, report).toContain("[background_task_done]");
    expect(usages[2]!.cache_read_input_tokens, report).toBe(prefixTokens(order[1]!));
  });

  it("a call the user moves to the background still hits the prompt cache", async () => {
    const { environment } = await makeEnvironment(["exec_command", "input_command"]);
    const { order, onRequest } = ordering();
    const { model } = recordingModel(
      modelConfig({ tools: await environment.listTools() }),
      [
        {
          toolCalls: [
            {
              id: "call_detach",
              name: "exec_command",
              // A yield window far longer than the test: the promotion can only be the detach.
              args: { cmd: "printf 'listening\\n'; sleep 30", yield_time_ms: 60000 },
            },
          ],
        },
        { text: "It is still running; I left it in the background." },
      ],
      { label: MAIN, onRequest },
    );
    const session = makeSession({ llm: model, environment });

    let detach: ToolDetachResult | null = null;
    let seen = "";
    for await (const msg of session.run([userText("start the dev server")], {
      approve: allowAll,
    })) {
      const payload = msg.payload as { type?: string; output?: string };
      if (payload.type === "partial_tool_call_output") seen += payload.output ?? "";
      if (detach === null && seen.includes("listening")) {
        detach = session.detachToolCall("call_detach");
      }
    }
    expect(detach).toBe("detached");

    expect(order).toHaveLength(2);
    const usages = replay(order);
    expectHits(order, usages);
    const report = formatCacheReport(order, usages);
    const result = wireMessage(order[1]!, -1);
    expect(blockTypes(result), report).toEqual(["tool_result"]);
    expect(JSON.stringify(result.content), report).toContain(DETACHED_TOOL_NOTE_PREFIX);
    expect(usages[1]!.cache_read_input_tokens, report).toBe(prefixTokens(order[0]!));
  });

  it("a turn that calls three tools at once still hits the prompt cache", async () => {
    const { environment } = await makeEnvironment(["exec_command", "input_command"]);
    const { order, onRequest } = ordering();
    const { model } = recordingModel(
      modelConfig({ tools: await environment.listTools() }),
      [
        {
          toolCalls: [
            { id: "call_a", name: "exec_command", args: { cmd: "printf alpha" } },
            { id: "call_b", name: "exec_command", args: { cmd: "printf beta" } },
            { id: "call_c", name: "exec_command", args: { cmd: "printf gamma" } },
          ],
        },
        { text: "All three came back." },
      ],
      { label: MAIN, onRequest },
    );
    const session = makeSession({ llm: model, environment });

    await collect(session.run([userText("check all three")], { approve: allowAll }));

    expect(order).toHaveLength(2);
    const usages = replay(order);
    expectHits(order, usages);
    const report = formatCacheReport(order, usages);
    // Three tool_use blocks are one position and three tool_result blocks another, so a wide
    // parallel round costs two of the twenty positions the lookback has, not six.
    expect(blockTypes(wireMessage(order[1]!, 1)), report).toEqual([
      "tool_use",
      "tool_use",
      "tool_use",
    ]);
    expect(blockTypes(wireMessage(order[1]!, 2)), report).toEqual([
      "tool_result",
      "tool_result",
      "tool_result",
    ]);
    expect(positionCount(order[1]!) - positionCount(order[0]!), report).toBe(2);
  });

  it("a subagent leaves its parent's prompt cache intact, and reads 0 because it opens its own line", async () => {
    const { order, onRequest } = ordering();
    // The child Session is built from the parent Environment's own toolset, so the runner
    // reads it at spawn time rather than at construction.
    let childSession: Session | null = null;
    const { environment } = await makeEnvironment(["exec_command", "read_file", "run_subagent"], {
      subagentRunner: childRunnerFor(() => childSession),
    });
    const tools = await environment.listTools();
    const child = recordingModel(
      modelConfig({ tools }),
      [
        toolTurn({
          thinking: { text: "Start from the test directory.", signature: "sig-child-1" },
          toolCalls: [{ id: "call_child", name: "read_file", args: { path: "test/README.md" } }],
        }),
        { text: "The tests are grouped by package." },
      ],
      { label: "child", onRequest },
    );
    childSession = makeSession({
      llm: child.model,
      environment: fakeEnvironmentWith(tools),
      sessionId: CHILD_SESSION_ID,
    });
    const parent = recordingModel(
      modelConfig({ tools }),
      [
        {
          toolCalls: [
            {
              id: "call_sub",
              name: "run_subagent",
              args: { prompt: "describe how the tests are laid out" },
            },
          ],
        },
        { text: "The child reports the tests are grouped by package." },
      ],
      { label: "parent", onRequest },
    );
    const session = makeSession({ llm: parent.model, environment });

    await collect(session.run([userText("how are the tests laid out?")], { approve: allowAll }));

    // Parent request, the child's two requests inside its tool call, then the parent again.
    expect(order.map((request) => request.label)).toEqual(["parent", "child", "child", "parent"]);
    const usages = replay(order);
    const reason =
      "the child context opens: it shares the parent's toolset and system prompt, but no " +
      "breakpoint sits after either, so none of that fixed prefix is addressable";
    expectHits(order, usages, new Map([[1, reason]]));
    const report = formatCacheReport(order, usages);
    // A self-spawned child sends the very same tools and system prompt as its parent and still
    // pays for them in full: the only entries in the cache end at whole requests.
    expect(usages[1]!.cache_read_input_tokens, report).toBe(0);
    expect(usages[1]!.cache_creation_input_tokens, report).toBe(prefixTokens(order[1]!));
    // And the parent's own line is untouched by the child having run in between.
    expect(usages[3]!.cache_read_input_tokens, report).toBe(prefixTokens(order[0]!));
  });

  it("a scheduled task's trigger still hits the prompt cache", async () => {
    const { order, onRequest } = ordering();
    const { model } = recordingModel(
      modelConfig(),
      [{ text: "Yesterday's run was clean." }, { text: "Ran the nightly checks; all green." }],
      { label: MAIN, onRequest },
    );
    const session = makeSession({ llm: model, environment: fakeEnvironment });

    await collect(session.run([userText("how did yesterday go?")], { approve: allowAll }));
    const trigger = buildScheduledMessage(
      "nightly-checks",
      "2026-09-14T03:00:00Z",
      "run the nightly checks and report anything red",
    );
    await collect(session.run([userText(trigger, "server")], { approve: allowAll }));

    expect(order).toHaveLength(2);
    const usages = replay(order);
    expectHits(order, usages);
    const report = formatCacheReport(order, usages);
    expect(wireMessage(order[1]!, -1).content[0]!.text, report).toContain("[scheduled_task]");
    expect(usages[1]!.cache_read_input_tokens, report).toBe(prefixTokens(order[0]!));
  });

  it("a session resumed from a Trace still hits the prompt cache, replayed history and all", async () => {
    const { order, onRequest } = ordering();
    await driveResume(onRequest);

    expect(order).toHaveLength(3);
    const usages = replay(order);
    // The resumed Session is the same context to the provider: its cache outlived the process.
    expectHits(order, usages);
    const report = formatCacheReport(order, usages);
    expect(usages[2]!.cache_read_input_tokens, report).toBe(prefixTokens(order[1]!));
    expect(explainMiss(order[1]!, order[2]!), report).toBe("no divergence");
  });

  it("a thinking-level move reads 0 because nothing closed an entry at the system prompt, then hits again", async () => {
    const { order, onRequest } = ordering();
    await driveThinkingMove(onRequest);

    expect(order).toHaveLength(3);
    const usages = replay(order);
    const reason =
      "the thinking level moved and no breakpoint sits after the system prompt, so nothing " +
      "behind the moved parameter is addressable";
    expectHits(order, usages, new Map([[1, reason]]));
    const report = formatCacheReport(order, usages);
    // The effort parameter sits after the system prompt, so the documented hierarchy says the
    // tools and the system prompt survive — but with one breakpoint at the end of the request
    // nothing ever closed an entry there, so the whole prefix is paid for again.
    expect(usages[1]!.cache_read_input_tokens, report).toBe(0);
    expect(usages[1]!.cache_creation_input_tokens, report).toBe(prefixTokens(order[1]!));
    // Once: the request after the move reads the moved level's prefix back in full.
    expect(usages[2]!.cache_read_input_tokens, report).toBe(prefixTokens(order[1]!));
  });

  it("a reopened context reads 0 because it is a new cache line, then hits the prompt cache from there", async () => {
    const { order, onRequest } = ordering();
    await driveCompaction(onRequest);

    expect(order.map((request) => request.label)).toEqual([
      "context 1",
      "context 1",
      "context 1",
      "context 2",
      "context 2",
    ]);
    const usages = replay(order);
    const reason =
      "the context reopened and no breakpoint sits after the system prompt, so the fixed " +
      "prefix the new context resends is not addressable either";
    expectHits(order, usages, new Map([[3, reason]]));
    const report = formatCacheReport(order, usages);
    // The compaction request runs on the same object with the same config: it reads the turn
    // it follows in full, which is the request where the context is largest.
    expect(usages[2]!.cache_read_input_tokens, report).toBe(prefixTokens(order[1]!));
    // What the rotation costs: the whole request, tools and system prompt included, even
    // though the reopened context sends byte-identical ones.
    expect(usages[3]!.cache_read_input_tokens, report).toBe(0);
    expect(usages[3]!.cache_creation_input_tokens, report).toBe(prefixTokens(order[3]!));
    // And the new context hits from its second request onwards.
    expect(usages[4]!.cache_read_input_tokens, report).toBe(prefixTokens(order[3]!));
  });

  it("a model switch reads 0 on the new model — a new cache line — then hits from there", async () => {
    const { order, onRequest } = ordering();
    await driveModelSwitch(onRequest);

    expect(order.map((request) => request.label)).toEqual([
      "model A",
      "model A",
      "model A",
      "model B",
      "model B",
    ]);
    const usages = replay(order);
    const reason =
      "the context reopened on another model: a prompt cache is scoped to one model, so " +
      "nothing the new model's first request sends is addressable";
    expectHits(order, usages, new Map([[3, reason]]));
    const report = formatCacheReport(order, usages);
    // The switch's compaction request runs on the old model with the old config: it reads the
    // turn it follows in full, exactly as a threshold compaction's does.
    expect(usages[2]!.cache_read_input_tokens, report).toBe(prefixTokens(order[1]!));
    // What the switch costs: the new model's first request, read in full and written anew.
    expect(usages[3]!.cache_read_input_tokens, report).toBe(0);
    expect(usages[3]!.cache_creation_input_tokens, report).toBe(prefixTokens(order[3]!));
    // And the new model hits from its second request onwards.
    expect(usages[4]!.cache_read_input_tokens, report).toBe(prefixTokens(order[3]!));
  });
});

// ---------------------------------------------------------------------------
// Scenario helpers
// ---------------------------------------------------------------------------

/** One Session, a thinking-level move between its first and second task. */
async function driveThinkingMove(onRequest: (request: RecordedRequest) => void): Promise<void> {
  const { model } = recordingModel(
    modelConfig(),
    [{ text: "First answer." }, { text: "Second answer." }, { text: "Third answer." }],
    { label: MAIN, onRequest },
  );
  const session = makeSession({ llm: model, environment: fakeEnvironment });
  await collect(session.run([userText("task one")], { approve: allowAll }));
  session.thinkingLevel = "high";
  await collect(session.run([userText("task two")], { approve: allowAll }));
  await collect(session.run([userText("task three")], { approve: allowAll }));
}

/** One Session whose second task crosses the compaction threshold and opens a new context. */
async function driveCompaction(onRequest: (request: RecordedRequest) => void): Promise<void> {
  const first = recordingModel(
    modelConfig(),
    [
      { text: "First answer.", promptTokens: 20 },
      // Over the compaction threshold at the task's wrap-up round.
      { text: "Second answer.", promptTokens: 150 },
      { text: "[summary]the distilled summary[/summary]", promptTokens: 160 },
    ],
    { label: "context 1", onRequest },
  );
  const second = recordingModel(
    modelConfig(),
    [{ text: "Carried on from the summary." }, { text: "And on from there." }],
    { label: "context 2", onRequest },
  );
  const session = makeSession({
    llm: first.model,
    environment: fakeEnvironment,
    compaction: compactionSettings(),
    openNextContext: () => ({ llm: second.model }),
  });
  await collect(session.run([userText("task one")], { approve: allowAll }));
  await collect(session.run([userText("task two")], { approve: allowAll }));
  await collect(session.run([userText("task three")], { approve: allowAll }));
  await collect(session.run([userText("task four")], { approve: allowAll }));
}

/** The model the switch scenario moves to. */
const SWITCH_TARGET = { provider: "anthropic", model_id: "claude-opus-4-7" };

/** One Session, two tasks on one model, an in-session switch, two tasks on the other. */
async function driveModelSwitch(onRequest: (request: RecordedRequest) => void): Promise<void> {
  const first = recordingModel(
    modelConfig(),
    [
      { text: "First answer." },
      { text: "Second answer." },
      { text: "[summary]the distilled summary[/summary]" },
    ],
    { label: "model A", onRequest },
  );
  const second = recordingModel(
    modelConfig({ modelId: SWITCH_TARGET.model_id }),
    [{ text: "Carried on from the summary." }, { text: "And on from there." }],
    { label: "model B", onRequest },
  );
  const session = makeSession({
    llm: first.model,
    environment: fakeEnvironment,
    compaction: compactionSettings(),
    openNextContext: () => ({
      llm: second.model,
      sessionMeta: sessionMeta({ ...META, ...SWITCH_TARGET }),
    }),
    modelSwitch: {
      validate: async () => ({ contextWindow: 200000 }),
      reassembleInitialContext: async () => ({}),
    },
  });
  await collect(session.run([userText("task one")], { approve: allowAll }));
  await collect(session.run([userText("task two")], { approve: allowAll }));
  await collect(
    session.switchModel({ provider: SWITCH_TARGET.provider, modelId: SWITCH_TARGET.model_id }),
  );
  await collect(session.run([userText("task three")], { approve: allowAll }));
  await collect(session.run([userText("task four")], { approve: allowAll }));
}

/**
 * A runner whose every spawn hands back the one prepared child Session, origin-tagged as the
 * contract requires. Enough of the composition layer to put a real child Session's requests on
 * the same provider as its parent's.
 */
function childRunnerFor(get: () => Session | null): SubagentRunner {
  return {
    async spawn(): Promise<SubagentHandle> {
      const childSession = get();
      if (!childSession) throw new Error("the child session was not prepared");
      return {
        sessionId: CHILD_SESSION_ID,
        run: ({ messages, signal, approve }) =>
          tagged(
            childSession.run(messages, {
              ...(signal ? { signal } : {}),
              ...(approve ? { approve } : {}),
            }),
          ),
        dispose() {},
      };
    },
  };
}

async function* tagged(
  gen: AsyncGenerator<OmniMessage, RunCutoff | null>,
): AsyncGenerator<OmniMessage, RunCutoff | null> {
  for (;;) {
    const res = await gen.next();
    if (res.done) return res.value;
    yield { ...res.value, origin: [CHILD_SESSION_ID] };
  }
}

/**
 * One Session writing a Trace, then a fresh Session resuming from that Trace into a new model
 * object — the process restart, with the provider's cache untouched on the other side.
 */
async function driveResume(onRequest: (request: RecordedRequest) => void): Promise<void> {
  const traces = await mkdtemp(path.join(tmpdir(), "penguin-prompt-cache-trace-"));
  cleanups.push(() => rm(traces, { recursive: true, force: true }));

  const live = recordingModel(
    modelConfig(),
    [
      toolTurn({
        thinking: { text: "Read the README first.", signature: "sig-resume-1" },
        toolCalls: [{ id: "call_1", name: "read_file", args: { path: "README.md" } }],
      }),
      { text: "The README explains the layout." },
    ],
    { label: MAIN, onRequest },
  );
  const trace = new Writer({ tracesDir: traces, sessionId: SESSION_ID });
  const session = makeSession({ llm: live.model, environment: fakeEnvironment, trace });
  await collect(session.run([userText("read the README")], { approve: allowAll }));

  const resumed = resumeTrace(await readTrace(trace.currentPath()));
  const next = recordingModel(modelConfig(), [{ text: "Here are the packages." }], {
    label: MAIN,
    onRequest,
  });
  next.model.setHistory(resumed.history);
  const resumedSession = makeSession({
    llm: next.model,
    environment: fakeEnvironment,
    metaAlreadyWritten: true,
    initialEngineState: {
      carryOver: resumed.carryOver,
      sessionTurns: resumed.sessionTurns,
      sessionTokens: resumed.sessionTokens,
      lastRequestTotal: resumed.lastRequestTotal,
    },
  });
  await collect(resumedSession.run([userText("now list the packages")], { approve: allowAll }));
}
