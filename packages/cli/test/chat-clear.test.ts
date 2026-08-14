/**
 * chat `/clear`: starts a brand-new blank Session in place. The old Session is only
 * disposed (runtime teardown — Session/Agent expose no deletion API, and /clear must not
 * grow one), its resume command is printed so it stays reachable via `--resume`, the
 * replacement is created with the same Workspace and model, and subsequent input runs on
 * the new Session. Drives the real REPL over a fake stdin with `createAgent` mocked; each
 * line is fed only after the REPL prints its input prompt, so no line lands mid-run.
 */
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import { createAgent } from "@prismshadow/penguin-core";
import { registerChatCommand } from "../src/commands/chat.js";
import { getMessages } from "../src/i18n.js";

vi.mock("@prismshadow/penguin-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@prismshadow/penguin-core")>();
  return { ...actual, createAgent: vi.fn() };
});

interface FakeSession {
  sessionId: string;
  provider: string;
  modelId: string;
  workspaceDir: string;
  /** User text of each run() prompt: proves which Session an input line was routed to. */
  runs: string[];
  disposeCalls: number;
  run(prompt: unknown[], opts: unknown): AsyncGenerator<never>;
  compact(opts: unknown): AsyncGenerator<never>;
  steer(): boolean;
  toolPermission(): undefined;
  dispose(): void;
}

/** A Session double covering exactly what the chat REPL touches; run() yields nothing (a task with no output or usage). */
function makeFakeSession(
  sessionId: string,
  opts: { workspaceDir?: string; modelId?: string; provider?: string },
): FakeSession {
  const session: FakeSession = {
    sessionId,
    provider: opts.provider ?? "prov-default",
    modelId: opts.modelId ?? "model-default",
    workspaceDir: opts.workspaceDir ?? "/ws",
    runs: [],
    disposeCalls: 0,
    async *run(prompt) {
      const text = (prompt[0] as { payload?: { text?: string } }).payload?.text ?? "";
      session.runs.push(text);
    },
    async *compact() {},
    steer: () => false,
    toolPermission: () => undefined,
    dispose() {
      session.disposeCalls++;
    },
  };
  return session;
}

/** An Agent double whose createSession records every Session it hands out. */
function makeFakeAgent() {
  const sessions: FakeSession[] = [];
  const createSession = vi.fn(
    async (opts: { workspaceDir?: string; modelId?: string; provider?: string } = {}) => {
      const session = makeFakeSession(`sess-${sessions.length + 1}`, opts);
      sessions.push(session);
      return session;
    },
  );
  const agent = {
    state: { agentId: "test-agent" },
    createSession,
    resumeSession: vi.fn(),
    latestSessionId: vi.fn(async () => null),
  };
  vi.mocked(createAgent).mockResolvedValue(
    agent as unknown as Awaited<ReturnType<typeof createAgent>>,
  );
  return { agent, sessions };
}

/**
 * Runs `penguin chat` end to end over a PassThrough stdin, capturing stdout. Each input
 * line is written only once the REPL has printed the matching `> ` prompt (the non-TTY
 * REPL writes the prompt when — and only when — it is ready for the next line).
 */
async function driveChat(lines: string[]): Promise<string> {
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
    registerChatCommand(program, getMessages("en"));
    const done = program.parseAsync(["node", "penguin", "chat"]);
    for (let i = 0; i < lines.length; i++) {
      // Racing against `done` keeps a REPL that errors out early from hanging the test.
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

describe("chat /clear (fresh Session in place)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("swaps in a new Session with the same Workspace/model; the old one is disposed (not deleted) and stays resumable; later input runs on the new Session", async () => {
    const { agent, sessions } = makeFakeAgent();
    const out = await driveChat(["hello", "/clear", "second", "/exit"]);

    // A second Session was created, pinning the first one's Workspace and model reference.
    expect(agent.createSession).toHaveBeenCalledTimes(2);
    expect(agent.createSession.mock.calls[1]![0]).toEqual({
      workspaceDir: sessions[0]!.workspaceDir,
      modelId: sessions[0]!.modelId,
      provider: sessions[0]!.provider,
    });
    // Input routing: "hello" ran on the old Session, "second" on the new one.
    expect(sessions[0]!.runs).toEqual(["hello"]);
    expect(sessions[1]!.runs).toEqual(["second"]);
    // The old Session got runtime teardown only (dispose once, never resumed/recreated
    // here), and /clear advertised its resume command before switching over.
    expect(sessions[0]!.disposeCalls).toBe(1);
    expect(agent.resumeSession).not.toHaveBeenCalled();
    expect(out).toContain("penguin chat --resume sess-1");
    expect(out).toContain(getMessages("en").clearDone());
    // The exit hint names the new Session (it ran "second", so it is resumable).
    expect(out).toContain("penguin chat --resume sess-2");
    expect(sessions[1]!.disposeCalls).toBe(1); // disposed by the exit path
  });

  it("/clear before any Task prints no resume hint (neither Session has a Trace record yet)", async () => {
    const { agent } = makeFakeAgent();
    const out = await driveChat(["/clear", "/exit"]);

    expect(agent.createSession).toHaveBeenCalledTimes(2);
    expect(out).toContain(getMessages("en").clearDone());
    expect(out).not.toContain("--resume");
  });
});
