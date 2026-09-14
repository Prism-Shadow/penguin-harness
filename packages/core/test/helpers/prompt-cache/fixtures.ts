/**
 * The scenery the Session suites stand on: one agent, fake collaborators, and the assertion the
 * lifecycle scenarios share.
 *
 * `prompt-cache-invariants.test.ts` and `prompt-cache-lifecycle.test.ts` drive the same agent —
 * same tools, same system prompt, same model id — so the fixtures live here and each suite keeps
 * only what is its own. The system prompt is the size a real one is, because a fixed prefix under
 * the provider's minimum would turn every number the lifecycle suite reports into a statement
 * about the minimum instead of about the harness.
 *
 * The requests come from `recording.ts`, the numbers from `simulator.ts`, and the reason behind a
 * miss from `diagnostics.ts`. `expectHits` is where those meet: every request reads back the whole
 * prefix of its context's previous request, unless the scenario names the index and bounds the
 * loss itself.
 */
import { expect } from "vitest";
import { toolCallOutput } from "../../../src/omnimessage/index.js";
import type {
  OmniMessage,
  SessionMetaPayload,
  ToolDefinition,
} from "../../../src/omnimessage/index.js";
import type {
  ApproveFn,
  EnvironmentInterface,
  GenerativeModelConfig,
} from "../../../src/interfaces/index.js";
import type { CompactionSettings } from "../../../src/engine/context-engine.js";
import type { RecordedRequest, ScriptedReply } from "./recording.js";
import {
  DEFAULT_MIN_CACHEABLE_TOKENS,
  PromptCacheSim,
  formatCacheReport,
  prefixTokens,
  previousInContext,
  toolsAndSystemTokens,
} from "./simulator.js";
import type { CacheUsage } from "./simulator.js";

// ---- The agent both suites drive ------------------------------------------

/**
 * A system prompt of the size a real agent carries. It has to clear the provider's minimum
 * cacheable prefix on its own, or every number the lifecycle suite reports would be a statement
 * about the minimum rather than about the harness (`expectHits` asserts that it does).
 */
export const SYSTEM_PROMPT = [
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

export const TOOLS: ToolDefinition[] = [
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

// ---- Session identity and configuration -----------------------------------

export const SESSION_ID = "sess-prompt-cache";
export const CHILD_SESSION_ID = "sess-prompt-cache-child";
/** The one context label a single-context scenario uses. */
export const MAIN = "main";

export const META: SessionMetaPayload = {
  session_id: SESSION_ID,
  provider: "anthropic",
  model_id: "claude-sonnet-4-6",
  model_context_window: 200000,
  system_prompt: SYSTEM_PROMPT,
  agent_state: "/tmp/penguin-prompt-cache/state",
  workspace: "/tmp/penguin-prompt-cache/workspace",
};

export const modelConfig = (over: Partial<GenerativeModelConfig> = {}): GenerativeModelConfig => ({
  modelId: "claude-sonnet-4-6",
  tools: TOOLS,
  systemPrompt: SYSTEM_PROMPT,
  ...over,
});

/** The compaction prompt, named so a suite can assert on the turn it is appended to. */
export const COMPACTION_PROMPT = "Summarize this conversation so the next context can carry on.";

export const compactionSettings = (over: Partial<CompactionSettings> = {}): CompactionSettings => ({
  maxContextLength: 100,
  maxSessionTurns: -1,
  mode: "summarize",
  prompt: COMPACTION_PROMPT,
  ...over,
});

// ---- Fake collaborators ---------------------------------------------------

export const allowAll: ApproveFn = async () => "allow";

/** Fake Environment that never runs a real command: any tool call answers with fixed output. */
export const fakeEnvironmentWith = (tools: ToolDefinition[]): EnvironmentInterface => ({
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

export const fakeEnvironment = fakeEnvironmentWith(TOOLS);

/** Drains a run to its end and keeps the messages it streamed. */
export async function collect<T>(gen: AsyncGenerator<OmniMessage, T>): Promise<OmniMessage[]> {
  const all: OmniMessage[] = [];
  for (;;) {
    const res = await gen.next();
    if (res.done) return all;
    all.push(res.value);
  }
}

// ---- Scripted replies -----------------------------------------------------

/** A tool-calling first reply, reused by the cases that need a two-turn task. */
export const toolTurn = (over: Partial<ScriptedReply> = {}): ScriptedReply => ({
  thinking: { text: "The entry point is the place to start.", signature: "sig-turn-1" },
  toolCalls: [{ id: "call_1", name: "read_file", args: { path: "src/index.ts" } }],
  ...over,
});

// ---- Reading a recorded request -------------------------------------------

/** One message of a request's wire form, as the suites read it back. */
export interface WireMessage {
  role: string;
  content: { type: string; text?: string; signature?: string }[];
}

export const wireMessage = (request: RecordedRequest, index: number): WireMessage =>
  request.wire.at(index) as WireMessage;

export const blockTypes = (message: WireMessage): string[] =>
  message.content.map((block) => block.type);

// ---- Running a scenario through one simulated provider --------------------

/** Collects the issue order across every model of a scenario (see RecordingOptions.onRequest). */
export function ordering(): { order: RecordedRequest[]; onRequest: (r: RecordedRequest) => void } {
  const order: RecordedRequest[] = [];
  return { order, onRequest: (request) => order.push(request) };
}

/** Runs every recorded request through one provider-side cache, in issue order. */
export function replay(order: RecordedRequest[], sim = new PromptCacheSim()): CacheUsage[] {
  return order.map((request) => sim.request(request));
}

// ---- The assertion every lifecycle scenario shares -------------------------

/**
 * Every request after the first of its context must read back the whole prefix of that
 * context's previous request. An index named in `allowed` is exempted with a stated reason —
 * the scenario then bounds its loss itself — and a context opening anywhere but at the very
 * first request must be named too, so a fresh cache line can never appear unremarked.
 *
 * An exemption has to earn itself: the named request must actually fall short of the prefix it
 * would otherwise be held to, so a reason left behind by a flow that has since started hitting
 * fails here rather than quietly weakening the suite.
 */
export function expectHits(
  requests: RecordedRequest[],
  usages: CacheUsage[],
  allowed: Map<number, string> = new Map(),
): void {
  const report = formatCacheReport(requests, usages);
  expect(usages, report).toHaveLength(requests.length);
  expect(requests.length, report).toBeGreaterThan(0);
  // A fixture whose fixed prefix is under the provider's minimum would make every number the
  // scenarios report a statement about the minimum instead of about the harness.
  expect(toolsAndSystemTokens(requests[0]!), report).toBeGreaterThanOrEqual(
    DEFAULT_MIN_CACHEABLE_TOKENS,
  );
  for (const [index, reason] of allowed) {
    expect(index, `allowed miss #${index} names no request\n${report}`).toBeLessThan(
      requests.length,
    );
    // A request that opens a context is held to its own prefix: it may not arrive fully read.
    const before = previousInContext(requests, index);
    const whole = prefixTokens(requests[before < 0 ? index : before]!);
    expect(
      usages[index]!.cache_read_input_tokens,
      `#${index} is exempted as "${reason}", but it reads that whole prefix back — ` +
        `drop the exemption\n${report}`,
    ).toBeLessThan(whole);
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
