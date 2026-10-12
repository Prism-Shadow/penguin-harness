/**
 * chat: a bracketed paste on a terminal while a Task runs. Drives the real REPL over a fake
 * TTY stdin (raw mode, bracketed paste) against the in-process fake server, whose Tasks run
 * until the test settles them.
 *
 * - Given a Task running, when a multi-line text is pasted and Enter pressed, then the whole
 *   text is sent as one steering message and no new Task starts.
 * - Given a paste made while a Task runs, when the Task ends before Enter, then the next Enter
 *   sends the pasted text as the next prompt: a paste landing as a Task ends is not lost.
 * - Given a Task running, when Enter alone is pressed (nothing pasted or typed), then nothing
 *   is steered.
 * - Given a paste waiting for Enter when an approval question comes and is answered, then the
 *   output that queued meanwhile stays off the screen until the paste is sent.
 */
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import { partialText, toolCall } from "@prismshadow/penguin-core";
import { registerChatCommand } from "../src/commands/chat.js";
import { getMessages } from "../src/i18n.js";
import { FakeServer, type FakeSessionState } from "./fake-server.js";

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";
const ENTER = "\r";

let server: FakeServer;
let uninstall: () => void;

beforeEach(() => {
  server = new FakeServer();
  server.hangTasks = true;
  uninstall = server.install();
});
afterEach(() => {
  uninstall();
  vi.restoreAllMocks();
});

interface Tty {
  type(text: string): void;
  paste(text: string): void;
  /** Resolves once the chat draws `prompt` after everything it had printed when called. */
  nextPrompt(prompt: string): () => Promise<void>;
  /** Everything the chat has written to the terminal so far. */
  printed(): string;
  /** The one Session the chat created. */
  session(): FakeSessionState;
  /** Ends the running Task the way the server does: the Session's stream reports idle. */
  settle(): void;
  /** Resolves when the chat has exited. */
  done: Promise<unknown>;
}

/** Starts `penguin chat` on a fake terminal: stdin claims a TTY, so raw mode and bracketed paste are on. */
function startChat(): Tty {
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
  registerChatCommand(program, getMessages("en"));
  const done = program.parseAsync(["node", "penguin", "chat"]).finally(() => {
    Object.defineProperty(process, "stdin", { value: realStdin, configurable: true });
  });
  const session = (): FakeSessionState => {
    const [only] = [...server.sessions.values()];
    if (!only) throw new Error("no Session yet");
    return only;
  };
  return {
    type: (text) => stdin.write(text),
    paste: (text) => stdin.write(`${PASTE_START}${text}${PASTE_END}`),
    nextPrompt: (prompt) => {
      const from = printed.length;
      return () => vi.waitFor(() => expect(printed.slice(from)).toContain(prompt));
    },
    printed: () => printed,
    session,
    settle: () => {
      const s = session();
      s.status = "idle";
      server.emitServerEvent(s.sessionId, { type: "task_state", state: "idle" });
    },
    done,
  };
}

const taskTexts = (s: FakeSessionState): string[] =>
  s.tasks.map((b) => (b.input as Array<{ text: string }>)[0]!.text);
const steerTexts = (s: FakeSessionState): string[] => s.steers.map((b) => String(b.text));

/** Starts the chat and its first Task; returns once that Task runs on the server. */
async function chatWithRunningTask(): Promise<Tty> {
  const tty = startChat();
  await vi.waitFor(() => expect(tty.session()).toBeDefined());
  tty.type(`first task${ENTER}`);
  await vi.waitFor(() => expect(tty.session().status).toBe("running"));
  return tty;
}

/** Ends the running Task, waits for the main prompt, and quits. */
async function settleAndExit(tty: Tty): Promise<void> {
  const prompt = tty.nextPrompt("> ");
  tty.settle();
  await prompt();
  tty.type(`/exit${ENTER}`);
  await tty.done;
}

describe("chat: a paste while a Task runs", () => {
  it("a multi-line paste and Enter steer the running Task with the whole text", async () => {
    const tty = await chatWithRunningTask();
    tty.paste("look at\nboth lines");
    tty.type(ENTER);
    await vi.waitFor(() => expect(steerTexts(tty.session())).toEqual(["look at\nboth lines"]));
    await settleAndExit(tty);
    expect(taskTexts(tty.session())).toEqual(["first task"]);
  });

  it("a paste the Task ends before is sent as the next prompt by the next Enter", async () => {
    const tty = await chatWithRunningTask();
    tty.paste("the next prompt");
    // The Task ends before Enter: the chat comes back with the paste still waiting.
    const continuation = tty.nextPrompt("… ");
    tty.settle();
    await continuation();
    tty.type(ENTER);
    await vi.waitFor(() =>
      expect(taskTexts(tty.session())).toEqual(["first task", "the next prompt"]),
    );
    await settleAndExit(tty);
    expect(steerTexts(tty.session())).toEqual([]);
  });

  it("output queued during an approval question stays held while a paste waits for Enter", async () => {
    const tty = await chatWithRunningTask();
    const sessionId = tty.session().sessionId;
    tty.paste("after the approval");
    // A reply streams while the paste waits (held), then the Task asks for an approval.
    server.emit(sessionId, partialText("start"));
    server.emit(sessionId, partialText("delta", "reply held behind the paste"));
    server.emit(sessionId, partialText("stop"));
    const question = tty.nextPrompt("Approve this tool call?");
    server.emitServerEvent(sessionId, {
      type: "approval_request",
      toolCall: toolCall({ name: "exec_command", arguments: '{"cmd":"ls"}', toolCallId: "c1" }),
    });
    await question();
    // `y` and Enter arrive as two keystrokes, as a person types them.
    tty.type("y");
    await new Promise((resolve) => setImmediate(resolve));
    tty.type(ENTER);
    await vi.waitFor(() => expect(tty.printed()).toContain("[approved]"));
    expect(tty.printed()).not.toContain("reply held behind the paste");

    tty.type(ENTER);
    await vi.waitFor(() => expect(steerTexts(tty.session())).toEqual(["after the approval"]));
    await vi.waitFor(() => expect(tty.printed()).toContain("reply held behind the paste"));
    await settleAndExit(tty);
  });

  it("Enter alone while a Task runs steers nothing", async () => {
    const tty = await chatWithRunningTask();
    tty.type(ENTER);
    await settleAndExit(tty);
    expect(steerTexts(tty.session())).toEqual([]);
    expect(taskTexts(tty.session())).toEqual(["first task"]);
  });
});
