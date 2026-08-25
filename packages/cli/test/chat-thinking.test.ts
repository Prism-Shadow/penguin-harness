/**
 * chat `/thinking` + `--thinking` (per-turn thinking level) and `/verbose` (tool-output
 * collapsing), over the server transport: drives the real REPL over a fake stdin against
 * the in-process fake server (same harness as chat-clear.test.ts). Task bodies record
 * what the server would receive (`thinkingLevel` on POST /tasks; a sticky pin is a PATCH
 * on the Session); the verbose test streams a long fake tool output through the real
 * renderer to prove the collapsed/full switch.
 */
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import {
  partialToolCall,
  partialToolCallOutput,
  type OmniMessage,
} from "@prismshadow/penguin-core";
import { registerChatCommand } from "../src/commands/chat.js";
import { getMessages } from "../src/i18n.js";
import { FakeServer } from "./fake-server.js";

const t = getMessages("en");

let server: FakeServer;
let uninstall: () => void;

beforeEach(() => {
  server = new FakeServer();
  uninstall = server.install();
});
afterEach(() => {
  uninstall();
  vi.restoreAllMocks();
});

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

/** Task bodies' thinkingLevel in POST order for one session. */
function taskLevels(sessionOrdinal: number): Array<string | undefined> {
  const sessions = [...server.sessions.values()];
  return sessions[sessionOrdinal]!.tasks.map((b) => b.thinkingLevel as string | undefined);
}

describe("chat /thinking (per-turn thinking level, server-backed)", () => {
  it("bare /thinking shows the Session default (unpinned = the Agent's configured level applies server-side)", async () => {
    const out = await driveChat(["/thinking", "/exit"]);
    expect(out).toContain(t.thinkingCurrentDefault(t.chatThinkingConfigured()));
  });

  it("/thinking <level> overrides subsequent turns; invalid values change nothing", async () => {
    const out = await driveChat([
      "/thinking",
      "first",
      "/thinking high",
      "second",
      "/thinking none",
      "third",
      "/thinking",
      "/exit",
    ]);
    expect(out).toContain(t.thinkingSet("high"));
    // Once overridden, the display says so and still names the Session default it overrides.
    expect(out).toContain(t.thinkingCurrentOverride("high", t.chatThinkingConfigured()));
    // "none" is not selectable (mirrors the web picker): error + the override stays "high".
    expect(out).toContain(t.error(t.thinkingInvalid("none")));
    const session = [...server.sessions.values()][0]!;
    expect(session.tasks.map((b) => (b.input as Array<{ text: string }>)[0]!.text)).toEqual([
      "first",
      "second",
      "third",
    ]);
    expect(taskLevels(0)).toEqual([undefined, "high", "high"]);
  });

  it("--thinking pins the Session default (a PATCH — sticky, so subagents follow) and runs carry no per-turn override", async () => {
    const out = await driveChat(["/thinking", "go", "/exit"], ["--thinking", "xhigh"]);
    const session = [...server.sessions.values()][0]!;
    expect(session.patches).toContainEqual({ thinkingLevel: "xhigh" });
    expect(session.thinkingLevel).toBe("xhigh");
    expect(out).toContain(t.thinkingCurrentDefault("xhigh"));
    expect(taskLevels(0)).toEqual([undefined]);
  });

  it("--resume turns --thinking into the initial per-turn override (the Session already exists)", async () => {
    const existing = server.addSession({ thinkingLevel: "low" });
    const out = await driveChat(
      ["/thinking", "go", "/exit"],
      ["--resume", existing.sessionId, "--thinking", "high"],
    );
    // No pin is written on resume; the flag rides each task instead.
    expect(existing.patches).toEqual([]);
    expect(out).toContain(t.thinkingCurrentOverride("high", "low"));
    expect(existing.tasks.map((b) => b.thinkingLevel)).toEqual(["high"]);
  });

  it("--resume without --thinking runs on the resumed Session's own pinned level (no override)", async () => {
    const existing = server.addSession({ thinkingLevel: "xhigh" });
    const out = await driveChat(["/thinking", "go", "/exit"], ["--resume", existing.sessionId]);
    expect(out).toContain(t.thinkingCurrentDefault("xhigh"));
    expect(existing.tasks.map((b) => b.thinkingLevel)).toEqual([undefined]);
  });

  it("/clear keeps the --thinking session default and the /thinking override", async () => {
    await driveChat(["/thinking high", "/clear", "after", "/exit"], ["--thinking", "low"]);
    const sessions = [...server.sessions.values()];
    expect(sessions).toHaveLength(2);
    // The replacement Session gets the same sticky pin…
    expect(sessions[1]!.patches).toContainEqual({ thinkingLevel: "low" });
    // …and the per-turn override still rides the next task.
    expect(sessions[1]!.tasks.map((b) => b.thinkingLevel)).toEqual(["high"]);
  });
});

describe("chat /verbose (tool-output collapsing)", () => {
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
    server.onTask = () => longToolOutput();
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
    server.onTask = () => longToolOutput();
    const out = await driveChat(["go", "/verbose", "again", "/exit"], ["--verbose"]);
    const [full, collapsed] = out.split(t.verboseOff()) as [string, string];
    expect(full).toContain("-> l5\n");
    expect(collapsed).toContain(t.toolOutputElided(4));
    expect(collapsed).not.toContain("-> l5\n");
  });
});
