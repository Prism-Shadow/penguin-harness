/**
 * `penguin chat` creates its Session at the first message, never at startup: a chat opened and
 * left writes nothing on the server. Drives the real REPL over a fake stdin against the
 * in-process fake server — the one fake, at the HTTP boundary — feeding each line once the REPL
 * has drawn its prompt.
 *
 * - Starting and leaving — /exit, /quit, the end of the input, Ctrl-C twice on a terminal —
 *   makes no write request at all: no Session, no PATCH, no Task.
 * - The banner names the agent, the Workspace and the model the Session will have (the
 *   Project's default when the chat names none) and says it starts with the first message.
 * - The first message creates exactly one Session, carrying the flags and the thinking level
 *   held before it; later messages go to the same Session. (A model switched before it: see
 *   chat-switch-model.test.ts.)
 * - /compact and /clear before then say there is no conversation yet; a malformed /goal
 *   creates nothing either.
 * - When creating the Session fails, the message is kept and the next Enter sends it again:
 *   from a pipe as an empty line, on a terminal from the input line it is put back into.
 * - When the server refuses the first message (a goal without its plugin), the Session just
 *   created for it is deleted and the message kept; the next Enter creates a new one with the
 *   same flags and level and sends it there. A refused later message deletes nothing.
 */
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import { registerChatCommand } from "../src/commands/chat.js";
import { getMessages } from "../src/i18n.js";
import { FakeServer, type FakeSessionState } from "./fake-server.js";

const t = getMessages("en");

let server: FakeServer;
let uninstall: () => void;

beforeEach(() => {
  vi.stubEnv("FORCE_COLOR", "0");
  vi.stubEnv("TERM", "dumb");
  server = new FakeServer();
  uninstall = server.install();
});
afterEach(() => {
  uninstall();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/** Every request that could write: anything but a GET. */
const writes = () => server.requests.filter((r) => r.method !== "GET");
const creates = () =>
  server.requests.filter((r) => r.method === "POST" && r.path.endsWith("/sessions"));
const taskTexts = (s: FakeSessionState): string[] =>
  s.tasks.map((b) => (b.input as Array<{ text: string }>)[0]!.text);

/**
 * Runs `penguin chat <argv>` over a piped stdin, writing each line once the REPL has drawn its
 * next `> ` prompt; `end` closes the input after the last one, as a pipe that runs dry does.
 */
async function driveChat(
  lines: string[],
  argv: string[] = [],
  opts: { end?: boolean } = {},
): Promise<string> {
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
    if (opts.end) {
      await Promise.race([waitForPrompt(lines.length + 1), done]);
      stdin.end();
    }
    await done;
    return chunks.join("");
  } finally {
    outSpy.mockRestore();
    Object.defineProperty(process, "stdin", { value: realStdin, configurable: true });
  }
}

/** `penguin chat` on a fake terminal: stdin claims a TTY, so it reads keys in raw mode. */
function startTerminalChat() {
  const stdin = new PassThrough() as PassThrough & {
    isTTY: boolean;
    setRawMode: (mode: boolean) => unknown;
  };
  stdin.isTTY = true;
  stdin.setRawMode = () => stdin;
  const realStdin = process.stdin;
  Object.defineProperty(process, "stdin", { value: stdin, configurable: true });
  let printed = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    printed += String(chunk);
    return true;
  });
  const program = new Command();
  program.exitOverride();
  registerChatCommand(program, t);
  const done = program.parseAsync(["node", "penguin", "chat"]).finally(() => {
    Object.defineProperty(process, "stdin", { value: realStdin, configurable: true });
  });
  return {
    type: (keys: string): void => void stdin.write(keys),
    printed: (): string => printed,
    /** Resolves once `text` is printed after everything printed when this was called. */
    nextPrinted: (text: string): (() => Promise<void>) => {
      const from = printed.length;
      return () => vi.waitFor(() => expect(printed.slice(from)).toContain(text));
    },
    done,
  };
}

describe("starting penguin chat and leaving it", () => {
  const leavings: Array<[string, string[], boolean]> = [
    ["/exit", ["/exit"], false],
    ["/quit", ["/quit"], false],
    ["the end of its input", [], true],
  ];
  for (const [how, lines, end] of leavings) {
    it(`writes nothing on the server when left with ${how}`, async () => {
      await driveChat(lines, [], { end });
      expect(server.sessions.size).toBe(0);
      expect(writes()).toEqual([]);
    });
  }

  it("writes nothing when left with Ctrl-C twice on a terminal", async () => {
    const tty = startTerminalChat();
    await vi.waitFor(() => expect(tty.printed()).toContain("> "));
    const question = tty.nextPrinted(t.confirmExit());
    tty.type("\x03");
    await question();
    tty.type("\x03");
    await tty.done;
    expect(server.sessions.size).toBe(0);
    expect(writes()).toEqual([]);
  });

  it("shows the agent, the Workspace and the model the conversation will have, and that it starts with the first message", async () => {
    const out = await driveChat(["/exit"]);
    expect(out).toContain("Agent: default_agent");
    expect(out).toContain(`Workspace: ${process.cwd()}`);
    // The Project's default model, read from the server, not created there.
    expect(out).toContain("Model: model-default");
    expect(out).toContain(t.chatNewConversation());
  });

  it("names the model it is given, without reading the Project's default", async () => {
    const out = await driveChat(["/exit"], ["--model-id", "m-given", "--provider", "p-given"]);
    expect(out).toContain("Model: m-given");
    expect(server.requests.some((r) => r.path.endsWith("/models"))).toBe(false);
  });
});

describe("the first message", () => {
  it("creates exactly one Session, with the flags and the level held before it; later messages go to it", async () => {
    const out = await driveChat(
      ["/thinking high", "/thinking", "first", "second", "/exit"],
      ["--workspace", "/srv/ws", "--approve", "read-only"],
    );
    expect(out).toContain(t.thinkingHeld("high"));
    expect(out).toContain(t.thinkingCurrent("high"));
    expect(creates()).toHaveLength(1);
    expect(creates()[0]!.body).toMatchObject({
      workspace: path.resolve("/srv/ws"),
      approvalMode: "read-only",
      client: "cli",
    });
    const [only] = [...server.sessions.values()];
    expect(only!.patches).toEqual([{ thinkingLevel: "high" }]);
    expect(taskTexts(only!)).toEqual(["first", "second"]);
  });
});

describe("commands before the first message", () => {
  it("/compact and /clear say there is no conversation yet, and a malformed /goal creates nothing", async () => {
    const out = await driveChat(["/compact", "/clear", "/goal:abc fix it", "/exit"]);
    expect(out.split(t.chatNoConversation()).length - 1).toBe(2);
    expect(out).toContain(t.goalBudgetInvalid("abc"));
    expect(server.sessions.size).toBe(0);
    expect(writes()).toEqual([]);
  });
});

describe("a first message whose Session cannot be created", () => {
  it("is kept: from a pipe, an empty line sends it again", async () => {
    server.failSessionCreates = 1;
    const out = await driveChat(["hello", "", "/exit"]);
    expect(out).toContain("The server is restarting.");
    expect(out).toContain(t.chatMessageKept());
    expect(server.sessions.size).toBe(1);
    expect(taskTexts([...server.sessions.values()][0]!)).toEqual(["hello"]);
  });

  it("is dropped for a line typed instead, which is sent in its place", async () => {
    server.failSessionCreates = 1;
    await driveChat(["hello", "something else", "/exit"]);
    expect(taskTexts([...server.sessions.values()][0]!)).toEqual(["something else"]);
  });

  it("is put back in the input line on a terminal, and Enter sends it", async () => {
    server.failSessionCreates = 1;
    const tty = startTerminalChat();
    await vi.waitFor(() => expect(tty.printed()).toContain("> "));
    const kept = tty.nextPrinted(t.chatMessageKept());
    tty.type("hello\r");
    await kept();
    // The message is printed again after the notice: back in the input line, not yet sent.
    await vi.waitFor(() => {
      const printed = tty.printed();
      expect(printed.slice(printed.lastIndexOf(t.chatMessageKept()))).toContain("hello");
    });
    expect(server.sessions.size).toBe(0);
    const afterTurn = tty.nextPrinted("> ");
    tty.type("\r");
    await vi.waitFor(() => expect(server.sessions.size).toBe(1));
    const [only] = [...server.sessions.values()];
    await vi.waitFor(() => expect(taskTexts(only!)).toEqual(["hello"]));
    await afterTurn();
    tty.type("/exit\r");
    await tty.done;
  });
});

describe("a first message the server refuses", () => {
  const deletes = () => server.requests.filter((r) => r.method === "DELETE");

  it("deletes the Session it created and keeps the message; the next Enter starts over with the same settings", async () => {
    server.refuseTasks = ["goal_plugin_not_installed"];
    const out = await driveChat(
      ["/thinking high", "/goal fix it", "", "/exit"],
      ["--workspace", "/srv/ws", "--approve", "read-only"],
    );
    expect(out).toContain("Refused: goal_plugin_not_installed.");
    expect(out).toContain(t.chatMessageKept());
    // The refused Session is gone, not left as an empty conversation.
    const [first, second] = creates();
    expect(deletes()).toHaveLength(1);
    expect(server.sessions.size).toBe(1);
    // The second create carries what the first did, and its own level pin.
    expect(second!.body).toEqual(first!.body);
    const [only] = [...server.sessions.values()];
    expect(only!.patches).toEqual([{ thinkingLevel: "high" }]);
    expect(only!.tasks).toEqual([
      { input: [{ type: "text", text: "fix it" }], goal: { budget: -1 } },
    ]);
  });

  it("deletes nothing when a later message is refused", async () => {
    // The first task goes through and arms a refusal for the next: by then the Session ran.
    server.onTask = () => {
      server.refuseTasks = ["goal_plugin_not_installed"];
      return [];
    };
    const out = await driveChat(["first", "/goal fix it", "/exit"]);
    expect(out).toContain("Refused: goal_plugin_not_installed.");
    expect(deletes()).toEqual([]);
    expect(server.sessions.size).toBe(1);
    expect(out).not.toContain(t.chatMessageKept());
  });
});
