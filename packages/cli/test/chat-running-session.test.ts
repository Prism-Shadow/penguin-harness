/**
 * chat: coming to a Session that is already running. Drives the real REPL against the
 * in-process fake server, whose running Session stays running until the test ends its Task.
 *
 * - Given a Session whose Task is still running (the terminal that started it was closed), when
 *   `chat --resume` comes to it, then the chat shows the history and the reply streamed so far,
 *   follows the rest, and gives the prompt back once the Task ends; nothing is refused.
 * - Given a resumed running Task, when a line is typed, then it steers the Task.
 * - Given a resumed running Task, when Ctrl-C is pressed, then the Task is stopped.
 * - Given a resumed Task waiting on an approval, then the question is asked in the chat and the
 *   answer goes back to the server.
 * - Given the stream repeats what the history and the live tail already hold, then each piece
 *   is shown once.
 * - Given a resumed Session in the middle of a compaction, then the summary being written stays
 *   off the screen.
 * - Given a chat whose Session runs a Task started elsewhere, when a message is sent, then it
 *   steers that Task, whose records so far are printed, and the chat follows it to its end.
 * - Given a Task from elsewhere that ends just as a message is sent, then the message runs as a
 *   Task of its own.
 */
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import {
  assistantText,
  compactionBegin,
  compactionEnd,
  partialText,
  taskBegin,
  taskEnd,
  toolCall,
  userSteeringText,
  userText,
} from "@prismshadow/penguin-core";
import { registerChatCommand } from "../src/commands/chat.js";
import { getMessages } from "../src/i18n.js";
import { FakeServer, type FakeSessionState } from "./fake-server.js";

const t = getMessages("en");
const SESSION_ID = "session-2026-11-06-13-09-04-cec67b17";

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

interface Chat {
  /** Writes to the chat's stdin. */
  type(text: string): void;
  /** Everything the chat has printed so far. */
  printed(): string;
  /** Resolves once the chat has printed `text` after everything it had printed when called. */
  next(text: string): () => Promise<void>;
  /** Resolves when the chat has exited. */
  done: Promise<unknown>;
}

/** Starts `penguin chat` with `argv`; on a terminal (raw mode, keystrokes) when `tty` is set, else over a pipe. */
function startChat(argv: string[], tty = false): Chat {
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
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    printed += String(chunk);
    return true;
  });
  const program = new Command();
  program.exitOverride();
  registerChatCommand(program, t);
  const done = program.parseAsync(["node", "penguin", "chat", ...argv]).finally(() => {
    Object.defineProperty(process, "stdin", { value: realStdin, configurable: true });
  });
  return {
    type: (text) => stdin.write(text),
    printed: () => printed,
    next: (text) => {
      const from = printed.length;
      return () => vi.waitFor(() => expect(printed.slice(from)).toContain(text));
    },
    done,
  };
}

/** A Session left running by a terminal that is gone: its Task opened, its prompt in the Trace. */
function runningSession(status: "running" | "compacting" = "running"): FakeSessionState {
  server.history = [taskBegin(), userText("fix the failing test")];
  return server.addSession({ sessionId: SESSION_ID, status });
}

/** Ends the Session's Task the way the server does: the stream reports idle. */
function endTask(session: FakeSessionState): void {
  session.status = "idle";
  server.emitServerEvent(session.sessionId, { type: "task_state", state: "idle" });
}

/** Ends the running Task, waits for the prompt the chat gives back, and quits. */
async function endAndExit(chat: Chat, session: FakeSessionState, enter = "\n"): Promise<void> {
  const prompt = chat.next("> ");
  endTask(session);
  await prompt();
  chat.type(`/exit${enter}`);
  await chat.done;
}

/** Resumes `SESSION_ID` and waits until the chat says it follows the running Task. */
async function resumeRunning(tty = false): Promise<Chat> {
  const chat = startChat(["--resume", "cec67b17"], tty);
  await vi.waitFor(() => expect(chat.printed()).toContain(t.chatFollowingResumed()));
  return chat;
}

const steerTexts = (s: FakeSessionState): string[] => s.steers.map((b) => String(b.text));

describe("chat --resume on a Session that is still running", () => {
  it("shows the history and the reply so far, follows the rest, and prompts once the Task ends", async () => {
    const session = runningSession();
    server.liveFragments = [partialText("start", "The test fails because")];
    const chat = await resumeRunning();
    expect(chat.printed()).toContain("> fix the failing test");
    expect(chat.printed().endsWith("> ")).toBe(false); // no prompt while the Task runs

    server.emit(SESSION_ID, partialText("delta", " the fixture is stale."));
    server.emit(SESSION_ID, partialText("stop"));
    server.emit(SESSION_ID, assistantText("The test fails because the fixture is stale."));
    await vi.waitFor(() =>
      expect(chat.printed()).toContain("The test fails because the fixture is stale."),
    );
    await endAndExit(chat, session);

    expect(session.tasks).toEqual([]);
    expect(chat.printed()).not.toContain("task_in_progress");
    expect(chat.printed()).toContain(`penguin chat --resume ${SESSION_ID}`);
  });

  it("sends a line typed meanwhile to the Task as steering", async () => {
    const session = runningSession();
    const chat = await resumeRunning();
    chat.type("also check the docs\n");
    await vi.waitFor(() => expect(steerTexts(session)).toEqual(["also check the docs"]));
    await endAndExit(chat, session);
    expect(session.tasks).toEqual([]);
  });

  it("stops the Task on Ctrl-C", async () => {
    const session = runningSession();
    const chat = await resumeRunning(true);
    chat.type("\x03");
    await vi.waitFor(() => expect(session.aborts).toBe(1));
    expect(chat.printed()).toContain(t.taskInterrupted());
    await endAndExit(chat, session, "\r");
  });

  it("asks the approval the Task waits on and sends the answer back", async () => {
    const session = runningSession();
    server.pendingApprovals = [
      {
        type: "approval_request",
        toolCall: toolCall({
          name: "exec_command",
          arguments: '{"cmd":"rm -rf dist"}',
          toolCallId: "c1",
        }),
      },
    ];
    const chat = startChat(["--resume", "cec67b17"]);
    await vi.waitFor(() => expect(chat.printed()).toContain(t.approvePrompt()));
    chat.type("n\n");
    await vi.waitFor(() =>
      expect(
        server.requests.find((r) => r.method === "POST" && r.path.endsWith("/approvals/c1"))?.body,
      ).toEqual({ decision: "deny" }),
    );
    await endAndExit(chat, session);
  });

  it("shows once what the stream repeats from the history and the live tail", async () => {
    const steering = userText(userSteeringText("keep the old API"));
    const session = runningSession();
    server.history = [...server.history, steering];
    // Published between the chat's subscription and its history read: the delta is inside the
    // fragment, the steering message inside the history.
    server.liveFragments = [partialText("start", "Renaming the helper")];
    server.beforeHistoryRead = () => {
      server.emit(SESSION_ID, partialText("delta", " the helper"));
      server.emit(SESSION_ID, steering);
    };
    const chat = await resumeRunning();
    server.emit(SESSION_ID, partialText("delta", " now."));
    server.emit(SESSION_ID, partialText("stop"));
    await vi.waitFor(() => expect(chat.printed()).toContain("Renaming the helper now."));
    await endAndExit(chat, session);

    expect(chat.printed()).not.toContain("the helper the helper");
    expect(chat.printed().split("keep the old API")).toHaveLength(2);
  });

  it("keeps the summary a running compaction writes off the screen", async () => {
    const session = runningSession("compacting");
    server.history = [
      ...server.history,
      compactionBegin({ reason: "context", mode: "summarize", context: 150, turns: 3 }),
    ];
    server.liveFragments = [partialText("start", "SUMMARY SO FAR")];
    const chat = await resumeRunning();
    server.emit(SESSION_ID, partialText("delta", " AND MORE"));
    server.emit(SESSION_ID, partialText("stop"));
    server.emit(
      SESSION_ID,
      compactionEnd({ reason: "context", mode: "summarize", status: "completed" }),
    );
    await endAndExit(chat, session);

    expect(chat.printed()).not.toContain("SUMMARY SO FAR");
    expect(chat.printed()).not.toContain("AND MORE");
  });
});

describe("chat: a message sent while a Task from elsewhere runs", () => {
  it("steers that Task, prints its records so far, and follows it to its end", async () => {
    server.history = [
      taskBegin(),
      userText("first question"),
      assistantText("first answer"),
      taskEnd(),
    ];
    const session = server.addSession({ sessionId: SESSION_ID });
    const chat = startChat(["--resume", "cec67b17"]);
    await vi.waitFor(() => expect(chat.printed()).toContain("> "));

    // The Web App starts a Task on the same Session.
    session.status = "running";
    server.history = [...server.history, taskBegin(), userText("started in the browser")];
    server.liveFragments = [partialText("start", "Working on the browser task")];
    chat.type("and add a test\n");
    await vi.waitFor(() => expect(chat.printed()).toContain(t.chatFollowingBusy()));
    await vi.waitFor(() => expect(steerTexts(session)).toEqual(["and add a test"]));
    expect(chat.printed()).toContain("> started in the browser");
    expect(chat.printed()).toContain("Working on the browser task");

    server.emit(SESSION_ID, partialText("delta", ", done."));
    server.emit(SESSION_ID, partialText("stop"));
    await vi.waitFor(() => expect(chat.printed()).toContain("Working on the browser task, done."));
    await endAndExit(chat, session);

    expect(session.tasks).toEqual([]);
    expect(chat.printed()).not.toContain("task_in_progress");
  });

  it("runs the message as a Task of its own when that Task ends as it is sent", async () => {
    const session = server.addSession({ sessionId: SESSION_ID });
    server.history = [taskBegin(), userText("first question")];
    // The POST meets a Task from elsewhere that has ended by the time the history is read.
    server.refuseTasks = ["task_in_progress"];
    const chat = startChat(["--resume", "cec67b17"]);
    await vi.waitFor(() => expect(chat.printed()).toContain("> "));
    const prompt = chat.next("> ");
    chat.type("next question\n");
    await prompt();
    chat.type("/exit\n");
    await chat.done;

    expect(session.tasks.map((b) => (b.input as Array<{ text: string }>)[0]!.text)).toEqual([
      "next question",
    ]);
    expect(session.steers).toEqual([]);
    expect(chat.printed()).not.toContain("task_in_progress");
  });
});
