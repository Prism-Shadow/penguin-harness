/**
 * chat `/thinking` + `--thinking` (the Session's pinned thinking level) and `/verbose`
 * (tool-output collapsing), over the server transport: drives the real REPL over a fake
 * stdin against the in-process fake server (same harness as chat-clear.test.ts). The fake
 * records what the server would receive (a pin is a PATCH on the Session; task bodies
 * carry no level); the verbose test streams a long fake tool output through the real
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

/** The thinking levels PATCHed onto one session, in order. */
function pinnedLevels(sessionOrdinal: number): string[] {
  const sessions = [...server.sessions.values()];
  return sessions[sessionOrdinal]!.patches.map(
    (p) => (p as { thinkingLevel?: unknown }).thinkingLevel,
  ).filter((l): l is string => typeof l === "string");
}

/** Whether any task body of one session carried a thinking level (none may). */
function anyTaskCarriesLevel(sessionOrdinal: number): boolean {
  const sessions = [...server.sessions.values()];
  return sessions[sessionOrdinal]!.tasks.some((b) => "thinkingLevel" in (b as object));
}

describe("chat /thinking (the Session's pinned thinking level, applied per model context)", () => {
  it("bare /thinking shows the Session's level (unpinned = the Agent's configured level applies server-side)", async () => {
    const out = await driveChat(["/thinking", "/exit"]);
    expect(out).toContain(t.thinkingCurrent(t.chatThinkingConfigured()));
  });

  it("/thinking <level> pins the Session (a PATCH) and tasks carry no level; invalid values change nothing", async () => {
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
    // Once pinned, the display shows the Session's level.
    expect(out).toContain(t.thinkingCurrent("high"));
    // "none" is not selectable (mirrors the web picker): error + the pin stays "high".
    expect(out).toContain(t.error(t.thinkingInvalid("none")));
    const session = [...server.sessions.values()][0]!;
    expect(session.tasks.map((b) => (b.input as Array<{ text: string }>)[0]!.text)).toEqual([
      "first",
      "second",
      "third",
    ]);
    expect(pinnedLevels(0)).toEqual(["high"]);
    expect(session.thinkingLevel).toBe("high");
    expect(anyTaskCarriesLevel(0)).toBe(false);
  });

  it("--thinking pins the Session (a PATCH — sticky across tasks); tasks carry no level", async () => {
    const out = await driveChat(["/thinking", "go", "/exit"], ["--thinking", "xhigh"]);
    const session = [...server.sessions.values()][0]!;
    expect(session.patches).toContainEqual({ thinkingLevel: "xhigh" });
    expect(session.thinkingLevel).toBe("xhigh");
    expect(out).toContain(t.thinkingCurrent("xhigh"));
    expect(anyTaskCarriesLevel(0)).toBe(false);
  });

  it("--resume with --thinking re-pins the existing Session (its context in flight keeps its level until the next compaction)", async () => {
    const existing = server.addSession({ thinkingLevel: "low" });
    const out = await driveChat(
      ["/thinking", "go", "/exit"],
      ["--resume", existing.sessionId, "--thinking", "high"],
    );
    expect(existing.patches).toContainEqual({ thinkingLevel: "high" });
    expect(existing.thinkingLevel).toBe("high");
    expect(out).toContain(t.thinkingCurrent("high"));
    expect(existing.tasks.some((b) => "thinkingLevel" in (b as object))).toBe(false);
  });

  it("--resume without --thinking runs on the resumed Session's own pinned level (no PATCH)", async () => {
    const existing = server.addSession({ thinkingLevel: "xhigh" });
    const out = await driveChat(["/thinking", "go", "/exit"], ["--resume", existing.sessionId]);
    expect(out).toContain(t.thinkingCurrent("xhigh"));
    expect(existing.patches.some((p) => "thinkingLevel" in (p as object))).toBe(false);
  });

  it("/clear carries the Session's latest pin to the replacement Session", async () => {
    await driveChat(["/thinking high", "/clear", "after", "/exit"], ["--thinking", "low"]);
    const sessions = [...server.sessions.values()];
    expect(sessions).toHaveLength(2);
    // Pinned low at creation, re-pinned high by /thinking; the replacement inherits the
    // latest pin and its tasks carry none.
    expect(pinnedLevels(0)).toEqual(["low", "high"]);
    expect(sessions[1]!.patches).toContainEqual({ thinkingLevel: "high" });
    expect(anyTaskCarriesLevel(1)).toBe(false);
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

describe("chat caller-context defaults (PENGUIN_SESSION_ID inheritance)", () => {
  it("a new chat inside an agent inherits workspace/model/approve and pins the caller's thinking", async () => {
    const caller = server.addSession({
      sessionId: "session-2026-08-25-10-00-00-ca11c0de",
      workspace: "/callers/dir",
      modelId: "caller-model",
      provider: "caller-prov",
      approvalMode: "read-only",
      thinkingLevel: "xhigh",
    });
    process.env.PENGUIN_SESSION_ID = caller.sessionId;
    const out = await driveChat(["/thinking", "/exit"]);
    const created = [...server.sessions.values()].find((x) => x.sessionId !== caller.sessionId)!;
    expect(created.workspace).toBe("/callers/dir");
    expect(created.modelId).toBe("caller-model");
    expect(created.provider).toBe("caller-prov");
    expect(created.approvalMode).toBe("read-only");
    // The caller's level pins the new Session (sticky, so subagents follow), and the
    // display shows it as the Session's level.
    expect(created.patches).toContainEqual({ thinkingLevel: "xhigh" });
    expect(out).toContain(t.thinkingCurrent("xhigh"));
  });
});
