/**
 * chat `/clear`: starts a brand-new blank Session in place, over the server API. The old
 * Session stays on the server (its resume command is printed so it remains reachable via
 * `--resume`), the replacement is created with the same Workspace and model, and
 * subsequent input runs on the new Session. Drives the real REPL over a fake stdin
 * against the in-process fake server; each line is fed only after the REPL prints its
 * input prompt, so no line lands mid-run.
 */
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import { registerChatCommand } from "../src/commands/chat.js";
import { getMessages } from "../src/i18n.js";
import { FakeServer } from "./fake-server.js";

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

/**
 * Runs `penguin chat` end to end over a PassThrough stdin, capturing stdout. Each input
 * line is written only once the REPL has printed the matching `> ` prompt (the non-TTY
 * REPL writes the prompt when — and only when — it is ready for the next line).
 */
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
    registerChatCommand(program, getMessages("en"));
    const done = program.parseAsync(["node", "penguin", "chat", ...argv]);
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

describe("chat /clear (fresh Session in place, server-backed)", () => {
  it("swaps in a new Session with the same Workspace/model; input routes to the new one; both stay resumable", async () => {
    const out = await driveChat(["hello", "/clear", "second", "/exit"]);

    const created = [...server.sessions.values()];
    expect(created).toHaveLength(2);
    const [first, second] = created;
    // The replacement pinned the first one's Workspace and model reference.
    expect(second!.workspace).toBe(first!.workspace);
    expect(second!.modelId).toBe(first!.modelId);
    expect(second!.provider).toBe(first!.provider);
    // Input routing: "hello" ran on the old Session, "second" on the new one.
    expect(first!.tasks.map((b) => (b.input as Array<{ text: string }>)[0]!.text)).toEqual([
      "hello",
    ]);
    expect(second!.tasks.map((b) => (b.input as Array<{ text: string }>)[0]!.text)).toEqual([
      "second",
    ]);
    // Both were created through the API with the CLI's client hint.
    const creates = server.requests.filter(
      (r) => r.method === "POST" && r.path.endsWith("/sessions"),
    );
    expect(creates).toHaveLength(2);
    expect(creates.every((r) => r.body?.client === "cli")).toBe(true);
    // /clear advertised the old Session's resume command before switching over, and the
    // exit hint names the new one.
    expect(out).toContain(`penguin chat --resume ${first!.sessionId}`);
    expect(out).toContain(getMessages("en").clearDone());
    expect(out).toContain(`penguin chat --resume ${second!.sessionId}`);
    // No DELETE / dispose call exists for a server Session — nothing was deleted.
    expect(server.requests.some((r) => r.method === "DELETE")).toBe(false);
  });

  it("/clear before any Task prints no resume hint (neither Session has history yet)", async () => {
    const out = await driveChat(["/clear", "/exit"]);
    expect(server.sessions.size).toBe(2);
    expect(out).toContain(getMessages("en").clearDone());
    expect(out).not.toContain("--resume");
  });
});
