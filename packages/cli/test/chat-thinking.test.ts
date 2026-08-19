/**
 * chat `/thinking` + `--thinking` (per-turn thinking level) and `/verbose` (tool-output
 * collapsing): drives the real REPL over a fake stdin with `createAgent` mocked, the same
 * harness as chat-clear.test.ts. Sessions record the options of every `run` call, proving
 * what the engine would receive (`RunOptions.thinkingLevel`); the verbose test streams a
 * long fake tool output through the real renderer to prove the collapsed/full switch.
 */
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import {
  createAgent,
  partialToolCall,
  partialToolCallOutput,
  type OmniMessage,
} from "@prismshadow/penguin-core";
import { registerChatCommand } from "../src/commands/chat.js";
import { getMessages } from "../src/i18n.js";

vi.mock("@prismshadow/penguin-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@prismshadow/penguin-core")>();
  return { ...actual, createAgent: vi.fn() };
});

const t = getMessages("en");

interface RunCall {
  text: string;
  opts: Record<string, unknown>;
}

interface FakeSession {
  sessionId: string;
  provider: string;
  modelId: string;
  workspaceDir: string;
  runs: RunCall[];
  run(prompt: unknown[], opts: Record<string, unknown>): AsyncGenerator<OmniMessage>;
  compact(opts: unknown): AsyncGenerator<never>;
  steer(): boolean;
  toolPermission(): undefined;
  dispose(): void;
}

/** A Session double recording each run's options; `messages` (if given) stream out of every run. */
function makeFakeSession(sessionId: string, messages: () => OmniMessage[]): FakeSession {
  const session: FakeSession = {
    sessionId,
    provider: "prov",
    modelId: "model",
    workspaceDir: "/ws",
    runs: [],
    async *run(prompt, opts) {
      const text = (prompt[0] as { payload?: { text?: string } }).payload?.text ?? "";
      session.runs.push({ text, opts });
      yield* messages();
    },
    async *compact() {},
    steer: () => false,
    toolPermission: () => undefined,
    dispose() {},
  };
  return session;
}

/**
 * An Agent double with the config slices `/thinking`'s display fallback reads
 * (agent explicit level > project default > "medium").
 */
function makeFakeAgent(opts?: {
  agentLevel?: string;
  projectLevel?: string;
  messages?: () => OmniMessage[];
}) {
  const sessions: FakeSession[] = [];
  const createSession = vi.fn(async (_createOpts: Record<string, unknown> = {}) => {
    const session = makeFakeSession(`sess-${sessions.length + 1}`, opts?.messages ?? (() => []));
    sessions.push(session);
    return session;
  });
  const agent = {
    state: {
      agentId: "test-agent",
      systemConfig: {
        model: opts?.agentLevel ? { thinking_level: opts.agentLevel } : {},
      },
    },
    projectConfig: opts?.projectLevel
      ? { default_chat: { thinking_level: opts.projectLevel } }
      : {},
    createSession,
    resumeSession: vi.fn(),
    latestSessionId: vi.fn(async () => null),
  };
  vi.mocked(createAgent).mockResolvedValue(
    agent as unknown as Awaited<ReturnType<typeof createAgent>>,
  );
  return { agent, sessions };
}

/** Runs `penguin chat <argv>` end to end over a PassThrough stdin, feeding each line at the prompt (same driver as chat-clear.test.ts). */
async function driveChat(lines: string[], argv: string[] = []): Promise<string> {
  const stdin = new PassThrough();
  const realStdin = process.stdin;
  Object.defineProperty(process, "stdin", { value: stdin, configurable: true });
  const chunks: string[] = [];
  let promptCount = 0;
  const waiters: Array<() => void> = [];
  const outSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    const text = String(chunk);
    chunks.push(text);
    if (text === "> ") promptCount++;
    for (const wake of waiters.splice(0)) wake();
    return true;
  });
  const waitForPrompt = (n: number): Promise<void> =>
    new Promise((resolve) => {
      const check = (): void => {
        if (promptCount >= n) resolve();
        else waiters.push(check);
      };
      check();
    });
  try {
    const program = new Command();
    program.exitOverride();
    registerChatCommand(program, t);
    const done = program.parseAsync(["node", "penguin", "chat", ...argv]);
    for (let i = 0; i < lines.length; i++) {
      await Promise.race([waitForPrompt(i + 1), done]);
      stdin.write(`${lines[i]}\n`);
    }
    await done;
    return chunks.join("");
  } finally {
    outSpy.mockRestore();
    Object.defineProperty(process, "stdin", { value: realStdin, configurable: true });
  }
}

describe("chat /thinking (per-turn thinking level)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("bare /thinking shows the configured chain (agent explicit > project default > medium)", async () => {
    makeFakeAgent({ projectLevel: "high" });
    const out = await driveChat(["/thinking", "/exit"]);
    expect(out).toContain(t.thinkingCurrent("high"));
  });

  it("/thinking <level> overrides subsequent turns; invalid values change nothing", async () => {
    const { sessions } = makeFakeAgent();
    const out = await driveChat([
      "/thinking",
      "first",
      "/thinking high",
      "second",
      "/thinking none",
      "third",
      "/exit",
    ]);
    // Display before any override: the built-in medium (no agent/project level configured).
    expect(out).toContain(t.thinkingCurrent("medium"));
    expect(out).toContain(t.thinkingSet("high"));
    // "none" is not selectable (mirrors the web picker): error + the override stays "high".
    expect(out).toContain(t.error(t.thinkingInvalid("none")));
    const runs = sessions[0]!.runs;
    expect(runs.map((r) => r.text)).toEqual(["first", "second", "third"]);
    expect(runs[0]!.opts["thinkingLevel"]).toBeUndefined(); // untouched -> core's default applies
    expect(runs[1]!.opts["thinkingLevel"]).toBe("high");
    expect(runs[2]!.opts["thinkingLevel"]).toBe("high");
  });

  it("--thinking pins the Session default at creation (runs carry no per-turn override) and /thinking shows it", async () => {
    const { agent, sessions } = makeFakeAgent({ agentLevel: "low" });
    const out = await driveChat(["/thinking", "go", "/exit"], ["--thinking", "xhigh"]);
    expect(agent.createSession.mock.calls[0]![0]).toMatchObject({ thinkingLevel: "xhigh" });
    expect(out).toContain(t.thinkingCurrent("xhigh"));
    expect(sessions[0]!.runs[0]!.opts["thinkingLevel"]).toBeUndefined();
  });

  it("/clear keeps the --thinking session default and the /thinking override", async () => {
    const { agent, sessions } = makeFakeAgent();
    await driveChat(["/thinking high", "/clear", "after", "/exit"], ["--thinking", "low"]);
    expect(agent.createSession.mock.calls[1]![0]).toMatchObject({ thinkingLevel: "low" });
    expect(sessions[1]!.runs[0]!.opts["thinkingLevel"]).toBe("high");
  });
});

describe("chat /verbose (tool-output collapsing)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  /** One exec_command call whose output streams 12 lines (l1..l12). */
  function longToolOutput(): OmniMessage[] {
    const id = "call_c9";
    return [
      partialToolCall({ eventType: "start", name: "exec_command", toolCallId: id }),
      partialToolCall({ eventType: "delta", name: "", arguments: '{"cmd":"x"}', toolCallId: id }),
      partialToolCall({ eventType: "stop", name: "", toolCallId: id }),
      partialToolCallOutput({ eventType: "start", toolCallId: id }),
      ...Array.from({ length: 12 }, (_, i) =>
        partialToolCallOutput({ eventType: "delta", output: `l${i + 1}\n`, toolCallId: id }),
      ),
      partialToolCallOutput({ eventType: "stop", toolCallId: id }),
    ];
  }

  it("collapses long tool output by default; /verbose switches to full output", async () => {
    makeFakeAgent({ messages: longToolOutput });
    const out = await driveChat(["go", "/verbose", "again", "/exit"]);
    const [collapsed, full] = out.split(t.verboseOn()) as [string, string];
    // Before the toggle: head + marker + tail, the middle hidden.
    expect(collapsed).toContain("exec_command -> l4\n");
    expect(collapsed).toContain(t.toolOutputElided(4));
    expect(collapsed).toContain("exec_command -> l12\n");
    expect(collapsed).not.toContain("-> l5\n");
    // After /verbose: every line renders.
    expect(full).toContain("-> l5\n");
    expect(full).not.toContain(t.toolOutputElided(4));
  });

  it("--verbose starts with full output; /verbose collapses from the next output on", async () => {
    makeFakeAgent({ messages: longToolOutput });
    const out = await driveChat(["go", "/verbose", "again", "/exit"], ["--verbose"]);
    const [full, collapsed] = out.split(t.verboseOff()) as [string, string];
    expect(full).toContain("-> l5\n");
    expect(collapsed).toContain(t.toolOutputElided(4));
    expect(collapsed).not.toContain("-> l5\n");
  });
});
