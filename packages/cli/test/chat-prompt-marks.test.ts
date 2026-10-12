/**
 * chat: semantic prompt marks (OSC 133) on a terminal. Drives the real REPL over a fake
 * terminal (stdin in raw mode, stdout claiming a TTY) against the in-process fake server and
 * reads the marks out of what it printed.
 *
 * - Given a chat on a terminal, when it is ready for input, its main prompt is enclosed by
 *   `A` (prompt start) and `B` (input start).
 * - Given a submitted prompt, its turn is enclosed by `C` and `D;0`, and the next prompt is
 *   marked again.
 * - Given a turn that ends in an error, it ends with `D;1`.
 * - Given stdin that is a pipe, stdout redirected to a file or a pipe, or `TERM=dumb`, nothing
 *   is marked and the chat still runs the prompt.
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
  vi.stubEnv("TERM", "xterm-256color");
});
afterEach(() => {
  uninstall();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/** Which ends of the chat are a terminal; the other is a pipe (stdin) or a redirect (stdout). */
interface Ends {
  stdin: boolean;
  stdout: boolean;
}
const TERMINAL: Ends = { stdin: true, stdout: true };

/**
 * Runs `penguin chat` with the given input lines and returns what it printed. A terminal
 * stdin runs in raw mode and gets keys; a piped one gets lines. Each line goes in once the
 * REPL has printed its next `> ` prompt.
 */
async function runChat(lines: string[], ends: Ends): Promise<string> {
  const stdin = new PassThrough() as PassThrough & {
    isTTY?: boolean;
    setRawMode?: (mode: boolean) => unknown;
  };
  if (ends.stdin) {
    stdin.isTTY = true;
    stdin.setRawMode = () => stdin;
  }
  const realStdin = process.stdin;
  const stdoutTty = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  Object.defineProperty(process, "stdin", { value: stdin, configurable: true });
  Object.defineProperty(process.stdout, "isTTY", { value: ends.stdout, configurable: true });
  let printed = "";
  let ready = 0;
  const waiters: Array<() => void> = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    const text = String(chunk);
    printed += text;
    if (text === "> ") ready++;
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
      stdin.write(`${lines[i]}${ends.stdin ? ENTER : "\n"}`);
    }
    await done;
    return printed;
  } finally {
    Object.defineProperty(process, "stdin", { value: realStdin, configurable: true });
    if (stdoutTty) Object.defineProperty(process.stdout, "isTTY", stdoutTty);
    else delete (process.stdout as { isTTY?: boolean }).isTTY;
  }
}

const marks = (printed: string): string[] => [...printed.matchAll(OSC_133)].map((m) => m[1]!);

describe("chat: semantic prompt marks on a terminal", () => {
  it("encloses the main prompt in A and B, and each turn in C and D;0", async () => {
    const printed = await runChat(["hello", "/exit"], TERMINAL);
    expect(marks(printed)).toEqual(["A", "B", "C", "D;0", "A", "B"]);
    // A precedes the prompt itself; B follows it.
    expect(printed).toMatch(/\x1b\]133;A\x07[^\x07]*> [^\x07]*\x1b\]133;B\x07/);
    expect([...server.sessions.values()][0]!.tasks).toHaveLength(1);
  });

  it("ends a turn that failed with D;1", async () => {
    server.switchModel = { refuse: "something_new" };
    const printed = await runChat(
      ["/switch-model openrouter anthropic/claude-opus-5", "/exit"],
      TERMINAL,
    );
    expect(marks(printed)).toEqual(["A", "B", "C", "D;1", "A", "B"]);
  });

  it.each([
    { when: "stdin is a pipe", ends: { stdin: false, stdout: true }, term: "xterm-256color" },
    { when: "stdout is redirected", ends: { stdin: true, stdout: false }, term: "xterm-256color" },
    { when: "the terminal is dumb", ends: TERMINAL, term: "dumb" },
  ])("marks nothing when $when", async ({ ends, term }) => {
    vi.stubEnv("TERM", term);
    const printed = await runChat(["hello", "/exit"], ends);
    expect(marks(printed)).toEqual([]);
    expect([...server.sessions.values()][0]!.tasks).toHaveLength(1);
  });
});
