/**
 * Prompt-cache hits across the Session lifecycle.
 *
 * `prefix-cache.test.ts` asks whether the harness assembles each request as an extension of
 * the one before it. This suite asks the question a bill answers: with the provider's own
 * rules applied — the automatic breakpoint, the minimum cacheable prefix, the position
 * lookback, the five-minute TTL — does the conversation keep hitting the cache while it is
 * interrupted, backgrounded, delegated, scheduled, resumed, retuned and compacted?
 *
 * Each scenario drives a real `Session` over a real `GenerativeModel` whose provider stream is
 * scripted, feeds every recorded request to one `PromptCacheSim` in the order it was issued
 * (the simulator IS the provider for the scenario, child sessions and reopened contexts
 * included), and asserts that each request reads back the whole prefix of the previous request
 * of its context. Where that cannot hold by design, the index is named in `allowed` with the
 * reason and the loss is bounded explicitly.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Environment } from "../src/environment/index.js";
import { Session } from "../src/index.js";
import { buildScheduledMessage, toolCallOutput, userText } from "../src/omnimessage/index.js";
import type { OmniMessage, SessionMetaPayload, ToolDefinition } from "../src/omnimessage/index.js";
import { Writer, readTrace, resumeTrace } from "../src/trace/index.js";
import type { CompactionSettings, TraceSink } from "../src/engine/context-engine.js";
import { DETACHED_TOOL_NOTE_PREFIX } from "../src/interfaces/index.js";
import type {
  ApproveFn,
  EnvironmentInterface,
  GenerativeModelConfig,
  LLMInterface,
  RunCutoff,
  SubagentHandle,
  SubagentRunner,
  ToolConfig,
  ToolDefinitionConfig,
  ToolDetachResult,
} from "../src/interfaces/index.js";
import { recordingModel } from "./helpers/prefix-cache.js";
import type { RecordedRequest, ScriptedReply } from "./helpers/prefix-cache.js";
import {
  DEFAULT_MIN_CACHEABLE_TOKENS,
  DEFAULT_TTL_MS,
  PromptCacheSim,
  explainMiss,
  fixedPrefixTokens,
  formatCacheReport,
  positionCount,
  prefixTokens,
  previousInContext,
  toolsAndSystemTokens,
  tokensBeforeLastUserMessage,
} from "./helpers/prompt-cache-sim.js";
import type { CacheUsage } from "./helpers/prompt-cache-sim.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * A system prompt of the size a real agent carries. It has to clear the provider's minimum
 * cacheable prefix on its own, or every result below would be a statement about the minimum
 * rather than about the harness (`expectHits` asserts that it does).
 */
const SYSTEM_PROMPT = [
  "You are a coding agent working inside a sandboxed workspace on behalf of one user.",
  "You have a shell, a file reader and a file writer, and nothing else runs on your behalf.",
  "",
  "# Working rules",
  "",
  "Read a file before you change it. A patch written from memory is a guess, and a guess that",
  "compiles is worse than one that does not, because nobody notices it.",
  "Keep every change as small as the task allows. When a task needs three unrelated edits, make",
  "them as three changes, not as one that happens to touch three places.",
  "Never call a tool that is not on the list you were given, and never invent a path you have",
  "not seen in output. If you need to know whether something exists, look.",
  "When a command fails, read the whole error before you react to it. The first line of a stack",
  "trace is rarely the line that matters, and the exit code is never the whole story.",
  "Prefer the workspace's own scripts to hand-rolled equivalents: if there is a build script,",
  "run the build script, because it encodes decisions you cannot see from the file tree.",
  "",
  "# Tool use",
  "",
  "Every tool call names the file or the command it touches, in the words the user would use.",
  "Long output is summarized rather than pasted back in full; keep the part that carries the",
  "decision and drop the part that only proves you ran something.",
  "A command that may run for more than a few seconds goes to the background, and you report",
  "its identifier so the user can follow it. Do not sit on a foreground shell waiting.",
  "When several files must be read to answer one question, ask for them together rather than",
  "one at a time: a round trip costs the user more than a longer answer does.",
  "Do not retry a failing command unchanged. Either change something about it, or say plainly",
  "that it fails and what the failure looks like.",
  "",
  "# Answering",
  "",
  "Say what you changed and why, in that order, and keep it to what the user did not already",
  "know. Repeating the request back to the user is not a summary of the work.",
  "State uncertainty where it exists. 'This should work but I could not run the tests' is a",
  "useful sentence; 'this works' when you did not check is not.",
  "If the task turns out to be a different task than the one described, say so before doing the",
  "different task. The user may have meant what they said.",
  "Never claim a test passed, a build succeeded or a file changed unless the output you were",
  "given says so. An unverified claim costs more to undo than an admitted gap costs to fill.",
  "",
  "# Output",
  "",
  "Write plain sentences. No headings for a two-line answer, no bullet list of three words, no",
  "restatement of these rules back to the user.",
  "Use the user's own vocabulary for files, commands and concepts once they have used it.",
  "When you cannot finish, end with what remains and what you would try next, not with an",
  "apology. The next step is the useful part.",
  "",
  "# Reading a codebase",
  "",
  "Start from the entry point the build declares, not from the file whose name looks closest to",
  "the task. Names drift; build configuration does not.",
  "Follow a symbol to its definition before you reason about it. Two functions with the same",
  "name in one repository is the normal case, not the surprising one.",
  "Read the tests around a behaviour before you change the behaviour. A test is the only place",
  "the previous author wrote down what they meant, and it is usually shorter than the code.",
  "When a file is longer than you can hold, read its top and its exports first, then the one",
  "region the task touches. Reading the middle of a file you have no map of teaches you little.",
  "Configuration counts as code. A value that reaches the running program from a TOML file is",
  "no less part of the behaviour than a value written in a source literal.",
  "",
  "# Editing",
  "",
  "Match the surrounding style rather than the style you prefer. A patch that reads as though",
  "the file's author wrote it costs the reviewer nothing; one that does not costs an argument.",
  "Change one thing per edit and keep the edit adjacent to what it changes. A rename spread",
  "across twenty files and a behaviour change in one of them is a review nobody can do.",
  "Do not delete code you do not understand. Find out what it is for, or leave it and say that",
  "you left it; silently removing a guard is how an incident starts.",
  "Leave the workspace buildable at every point where you stop. If you cannot, say so in the",
  "same breath as the change, and say which command reproduces the breakage.",
  "Comments explain why, not what. If a line needs a comment to say what it does, rewrite the",
  "line instead of annotating it.",
  "",
  "# Safety",
  "",
  "Never run a command that reaches outside the workspace unless the user asked for it in those",
  "words. The workspace boundary is the whole of your permission, not a default you may widen.",
  "Never write a credential, a token or a private key into a file, a log line or an answer, even",
  "one you were given in this conversation.",
  "A destructive command — a recursive delete, a force push, a database drop — is announced",
  "before it runs and named for what it destroys. If you cannot name it, do not run it.",
  "When a command would take longer than the user is likely to wait, say so before starting it",
  "rather than after. An unexplained silence reads as a hang.",
  "",
  "# When you are stuck",
  "",
  "Say what you tried, what you expected and what happened instead. Those three sentences are",
  "worth more than another round of guessing.",
  "Reduce the problem before you widen the search. A failing case you can run in one second",
  "beats a theory you can only test by rebuilding everything.",
  "Ask the user for the one fact that would settle it, rather than for guidance in general. A",
  "question that can be answered in a word gets answered; an open one gets ignored.",
].join("\n");

const TOOLS: ToolDefinition[] = [
  {
    name: "exec_command",
    description:
      "Run a shell command in the workspace and return its output. Use run_in_background " +
      "for anything that outlives a few seconds; the completion arrives as a user message.",
    parameters: {
      type: "object",
      properties: {
        cmd: { type: "string", description: "The command line to run." },
        run_in_background: { type: "boolean", description: "Detach and report on completion." },
        yield_time_ms: { type: "number", description: "How long to wait before yielding." },
      },
      required: ["cmd"],
    },
  },
  {
    name: "read_file",
    description: "Read a UTF-8 text file from the workspace, optionally a line range of it.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative path." },
        offset: { type: "number", description: "First line to read (1-based)." },
        limit: { type: "number", description: "How many lines to read." },
      },
      required: ["path"],
    },
  },
];

const SESSION_ID = "sess-prompt-cache";
const CHILD_SESSION_ID = "sess-prompt-cache-child";
/** The one context label a single-context scenario uses. */
const MAIN = "main";

const META: SessionMetaPayload = {
  session_id: SESSION_ID,
  provider: "anthropic",
  model_id: "claude-sonnet-4-6",
  model_context_window: 200000,
  system_prompt: SYSTEM_PROMPT,
  agent_state: "/tmp/penguin-prompt-cache/state",
  workspace: "/tmp/penguin-prompt-cache/workspace",
};

const modelConfig = (over: Partial<GenerativeModelConfig> = {}): GenerativeModelConfig => ({
  modelId: "claude-sonnet-4-6",
  tools: TOOLS,
  systemPrompt: SYSTEM_PROMPT,
  ...over,
});

const compactionSettings = (over: Partial<CompactionSettings> = {}): CompactionSettings => ({
  maxContextLength: 100,
  maxSessionTurns: -1,
  mode: "summarize",
  prompt: "Summarize this conversation so the next context can carry on.",
  ...over,
});

const allowAll: ApproveFn = async () => "allow";

/** Fake Environment that never runs a real command: any tool call answers with fixed output. */
const fakeEnvironmentWith = (tools: ToolDefinition[]): EnvironmentInterface => ({
  async listTools() {
    return tools;
  },
  async *executeTool({ toolCall: call }) {
    yield toolCallOutput({ output: "tool ran", toolCallId: call.payload.tool_call_id });
  },
  toolPermission() {
    return "rw";
  },
});

const fakeEnvironment = fakeEnvironmentWith(TOOLS);

interface SessionSpec {
  llm: LLMInterface;
  environment: EnvironmentInterface;
  sessionId?: string;
  trace?: TraceSink;
  compaction?: CompactionSettings;
  openNextContext?: ConstructorParameters<typeof Session>[0]["openNextContext"];
  initialEngineState?: ConstructorParameters<typeof Session>[0]["initialEngineState"];
  metaAlreadyWritten?: boolean;
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

/** Waits until the predicate holds (real process exits, real background reports). */
async function waitFor(predicate: () => boolean, timeoutMs = 8000): Promise<void> {
  await vi.waitFor(
    () => {
      if (!predicate()) throw new Error("condition not met yet");
    },
    { timeout: timeoutMs, interval: 20 },
  );
}

async function collect(gen: AsyncGenerator<OmniMessage, unknown>): Promise<OmniMessage[]> {
  const all: OmniMessage[] = [];
  for (;;) {
    const res = await gen.next();
    if (res.done) return all;
    all.push(res.value);
  }
}

/** Collects the issue order across every model of a scenario (see RecordingOptions.onRequest). */
function ordering(): { order: RecordedRequest[]; onRequest: (r: RecordedRequest) => void } {
  const order: RecordedRequest[] = [];
  return { order, onRequest: (request) => order.push(request) };
}

/** Runs every recorded request through one provider-side cache, in issue order. */
function replay(order: RecordedRequest[], sim = new PromptCacheSim()): CacheUsage[] {
  return order.map((request) => sim.request(request));
}

interface WireMessage {
  role: string;
  content: { type: string; text?: string }[];
}

const wireMessage = (request: RecordedRequest, index: number): WireMessage =>
  request.wire.at(index) as WireMessage;

const blockTypes = (message: WireMessage): string[] => message.content.map((block) => block.type);

/** A tool-calling first reply, reused by the cases that need a two-turn task. */
const toolTurn = (over: Partial<ScriptedReply> = {}): ScriptedReply => ({
  thinking: { text: "The entry point is the place to start.", signature: "sig-turn-1" },
  toolCalls: [{ id: "call_1", name: "read_file", args: { path: "src/index.ts" } }],
  ...over,
});

// ---------------------------------------------------------------------------
// The assertion every scenario shares
// ---------------------------------------------------------------------------

/**
 * Every request after the first of its context must read back the whole prefix of that
 * context's previous request. An index named in `allowed` is exempted with a stated reason —
 * the scenario then bounds its loss itself — and a context opening anywhere but at the very
 * first request must be named too, so a fresh cache line can never appear unremarked.
 */
function expectHits(
  requests: RecordedRequest[],
  usages: CacheUsage[],
  allowed: Map<number, string> = new Map(),
): void {
  const report = formatCacheReport(requests, usages);
  expect(usages, report).toHaveLength(requests.length);
  expect(requests.length, report).toBeGreaterThan(0);
  // A fixture whose fixed prefix is under the provider's minimum would make every number
  // below a statement about the minimum instead of about the harness.
  expect(toolsAndSystemTokens(requests[0]!), report).toBeGreaterThanOrEqual(
    DEFAULT_MIN_CACHEABLE_TOKENS,
  );
  for (const index of allowed.keys()) {
    expect(index, `allowed miss #${index} names no request\n${report}`).toBeLessThan(
      requests.length,
    );
  }
  for (let i = 0; i < requests.length; i += 1) {
    const previous = previousInContext(requests, i);
    if (allowed.has(i)) continue;
    if (previous < 0) {
      expect(i, `#${i} opens a context with no reason given\n${report}`).toBe(0);
      continue;
    }
    expect(
      usages[i]!.cache_read_input_tokens,
      `#${i} should read back all of #${previous}\n${report}`,
    ).toBeGreaterThanOrEqual(prefixTokens(requests[previous]!));
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("prompt-cache hits across the session lifecycle", () => {
  it("hits the whole previous prefix on every request of an ordinary conversation", async () => {
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
    const usages = replay(order);
    expectHits(order, usages);
    const report = formatCacheReport(order, usages);
    // The opening request pays for the whole prefix and caches it; the two that follow read it.
    expect(usages[0]!.cache_read_input_tokens, report).toBe(0);
    expect(usages[0]!.wrote, report).toBe(true);
    expect(usages[2]!.hitRatio, report).toBeGreaterThan(0.9);
  });

  it("confines an interruption's loss to the last user message", async () => {
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

  it("hits across the completion notice of a run_in_background command", async () => {
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

  it("hits after the user moves a running call to the background", async () => {
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

  it("hits across a turn that calls three tools at once", async () => {
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

  it("keeps the parent and the child cache lines healthy across a subagent's run", async () => {
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

  it("hits when a scheduled task opens the next run", async () => {
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

  it("reads the whole replayed history from cache when a session resumes", async () => {
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

  it("reads nothing when a resume lands after the cache TTL, which is an expiry", async () => {
    const { order, onRequest } = ordering();
    await driveResume(onRequest);

    let clock = 1_700_000_000_000;
    const sim = new PromptCacheSim({ now: () => clock });
    const usages = order.map((request, i) => {
      // The user closed the client and came back after lunch.
      if (i === order.length - 1) clock += DEFAULT_TTL_MS + 1;
      return sim.request(request);
    });
    const report = formatCacheReport(order, usages);
    expect(usages[2]!.cache_read_input_tokens, report).toBe(0);
    expect(usages[2]!.input_tokens, report).toBe(0);
    expect(usages[2]!.cache_creation_input_tokens, report).toBe(prefixTokens(order[2]!));
    // Nothing the harness assembled moved: the request is a clean extension of the last live
    // one, and the miss is the five-minute lifetime running out.
    expect(explainMiss(order[1]!, order[2]!), report).toBe("no divergence");
  });

  it("gives up the whole prefix once on a thinking-level move and then holds", async () => {
    const { order, onRequest } = ordering();
    await driveThinkingMove(onRequest);

    expect(order).toHaveLength(3);
    const usages = replay(order);
    expectHits(order, usages, new Map([[1, THINKING_MOVE_REASON]]));
    const report = formatCacheReport(order, usages);
    // The effort parameter sits after the system prompt, so the documented hierarchy says the
    // tools and the system prompt survive — but with one breakpoint at the end of the request
    // nothing ever closed an entry there, so the whole prefix is paid for again.
    expect(usages[1]!.cache_read_input_tokens, report).toBe(0);
    expect(usages[1]!.cache_creation_input_tokens, report).toBe(prefixTokens(order[1]!));
    // Once: the request after the move reads the moved level's prefix back in full.
    expect(usages[2]!.cache_read_input_tokens, report).toBe(prefixTokens(order[1]!));
  });

  it("reopens a compacted context with nothing cached, and hits again from there", async () => {
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
    expectHits(order, usages, new Map([[3, CONTEXT_REOPENED_REASON]]));
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

  it("recovers the fixed prefix once a breakpoint is set after the system prompt", async () => {
    const wider = (): PromptCacheSim =>
      new PromptCacheSim({ breakpoints: "tools-system-automatic" });

    const thinking = ordering();
    await driveThinkingMove(thinking.onRequest);
    const thinkingUsages = replay(thinking.order, wider());
    expectHits(thinking.order, thinkingUsages, new Map([[1, THINKING_MOVE_REASON]]));
    const thinkingReport = formatCacheReport(thinking.order, thinkingUsages);
    // The breakpoint on the system block is what the documented hierarchy assumes: the move
    // now costs the messages instead of the whole request.
    expect(thinkingUsages[1]!.cache_read_input_tokens, thinkingReport).toBe(
      toolsAndSystemTokens(thinking.order[1]!),
    );

    const compaction = ordering();
    await driveCompaction(compaction.onRequest);
    const compactionUsages = replay(compaction.order, wider());
    expectHits(compaction.order, compactionUsages, new Map([[3, CONTEXT_REOPENED_REASON]]));
    const compactionReport = formatCacheReport(compaction.order, compactionUsages);
    const reopened = compactionUsages[3]!.cache_read_input_tokens;
    expect(reopened, compactionReport).toBeGreaterThanOrEqual(
      toolsAndSystemTokens(compaction.order[3]!),
    );
    // Exactly tools plus system prompt, not the parameters block behind them: the reopened
    // context sends the same parameters, but no breakpoint closes that block either.
    expect(reopened, compactionReport).toBe(toolsAndSystemTokens(compaction.order[3]!));
    expect(reopened, compactionReport).toBeLessThan(fixedPrefixTokens(compaction.order[3]!));
  });
});

// ---------------------------------------------------------------------------
// Scenario helpers
// ---------------------------------------------------------------------------

/** Named once: the two flows below are measured under both breakpoint policies. */
const THINKING_MOVE_REASON =
  "the thinking level moved and no breakpoint sits after the system prompt, so nothing " +
  "behind the moved parameter is addressable";
const CONTEXT_REOPENED_REASON =
  "the context reopened and no breakpoint sits after the system prompt, so the fixed prefix " +
  "the new context resends is not addressable either";

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
