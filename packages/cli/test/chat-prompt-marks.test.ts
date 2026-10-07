/**
 * chat: semantic prompt marks (OSC 133) on a terminal. Drives the real REPL over a fake TTY
 * stdin against the in-process fake server and reads the marks out of what it printed.
 *
 * - Given a chat on a terminal, when it is ready for input, its main prompt is enclosed by
 *   `A` (prompt start) and `B` (input start).
 * - Given a submitted prompt, its turn is enclosed by `C` and `D;0`, and the next prompt is
 *   marked again.
 * - Given a turn that ends in an error, it ends with `D;1`.
 * - Given stdin that is not a terminal (a pipe), nothing is marked.
 */
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import { registerChatCommand } from "../src/commands/chat.js";
import { getMessages } from "../src/i18n.js";
import { FakeServer } from "./fake-server.js";

const ENTER = "\r";
const OSC_133 = /\x1b\]133;([A-D](?:;\d+)?)\x07/g;

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
 * Runs `penguin chat` with the given input lines and returns what it printed. With `tty`,
 * stdin claims a terminal (raw mode) and each line goes in once the previous prompt's input
 * mark `B` was printed; without it, stdin is a pipe and each line follows the printed `> `.
 */
async function runChat(lines: string[], tty: boolean): Promise<string> {
  const stdin = new PassThrough() as PassThrough & {
    isTTY?: boolean;
    setRawMode?: (mode: boolean) => unknown;
  };
  if (tty) {
    stdin.isTTY = true;
    stdin.setRawMode = () => stdin;
  }
  const realStdin = process.stdin;
  Object.defineProperty(process, "stdin", { value: stdin, configurable: true });
  let printed = "";
  let ready = 0;
  const waiters: Array<() => void> = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    const text = String(chunk);
    printed += text;
    if (tty ? text.includes("\x1b]133;B\x07") : text === "> ") ready++;
    for (const wake of waiters.splice(0)) wake();
    return true;
  });
  const readyFor = (n: number): Promise<void> =>
    new Promise((resolve) => {
      const check = (): void => (ready >= n ? resolve() : void waiters.push(check));
      check();
    });
  try {
    const program = new Command();
    program.exitOverride();
    registerChatCommand(program, getMessages("en"));
    const done = program.parseAsync(["node", "penguin", "chat"]);
    for (let i = 0; i < lines.length; i++) {
      await Promise.race([readyFor(i + 1), done]);
      stdin.write(`${lines[i]}${tty ? ENTER : "\n"}`);
    }
    await done;
    return printed;
  } finally {
    Object.defineProperty(process, "stdin", { value: realStdin, configurable: true });
  }
}

const marks = (printed: string): string[] => [...printed.matchAll(OSC_133)].map((m) => m[1]!);

describe("chat: semantic prompt marks on a terminal", () => {
  it("encloses the main prompt in A and B, and each turn in C and D;0", async () => {
    const printed = await runChat(["hello", "/exit"], true);
    expect(marks(printed)).toEqual(["A", "B", "C", "D;0", "A", "B"]);
    // A precedes the prompt itself; B follows it.
    expect(printed).toMatch(/\x1b\]133;A\x07[^\x07]*> [^\x07]*\x1b\]133;B\x07/);
    expect([...server.sessions.values()][0]!.tasks).toHaveLength(1);
  });

  it("ends a turn that failed with D;1", async () => {
    server.switchModel = { refuse: "something_new" };
    const printed = await runChat(
      ["/switch-model openrouter anthropic/claude-opus-5", "/exit"],
      true,
    );
    expect(marks(printed)).toEqual(["A", "B", "C", "D;1", "A", "B"]);
  });

  it("marks nothing when stdin is not a terminal", async () => {
    const printed = await runChat(["hello", "/exit"], false);
    expect(marks(printed)).toEqual([]);
    expect([...server.sessions.values()][0]!.tasks).toHaveLength(1);
  });
});
