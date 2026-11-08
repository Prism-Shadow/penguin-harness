/**
 * chat: runs the chat did not start. Drives the real REPL against the in-process fake server,
 * whose running Session stays running until the test ends its run.
 *
 * - Given a Session whose Task is still running (the terminal that started it was closed), when
 *   `chat --resume` comes to it, then the chat shows the history, the run so far and the rest of
 *   it, and gives the prompt back once the run ends; nothing is refused.
 * - Given a resumed running Task, when a line is typed, then it steers the Task.
 * - Given a resumed running Task, when Ctrl-C is pressed, then the Task is stopped.
 * - Given a resumed running Task, when `/exit` is typed, then the chat leaves and the Task goes
 *   on.
 * - Given a resumed Task waiting on an approval, then the question is asked in the chat and the
 *   answer goes back to the server.
 * - Given the stream published part of the run before the history was read, then each piece is
 *   shown once.
 * - Given a resumed Session in the middle of a compaction, then the summary being written stays
 *   off the screen.
 * - Given the server holds only the run's newest records, then the chat says how many it does
 *   not show.
 * - Given an older server, then the chat says to upgrade it and still follows the run.
 * - Given the chat waits at its prompt, when another surface starts a run, then the chat shows
 *   it, its input included, and prompts again once it ends.
 * - Given another surface's run under way, when a message is sent, then it steers that run.
 * - Given the Session compacts, when a message is sent, then it waits for the compaction.
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

/** The conversation before the run: one question answered. */
const EARLIER = [taskBegin(), userText("first question"), assistantText("first answer"), taskEnd()];

/**
 * A Session left running by a terminal that is gone: the server holds the run so far (its
 * Task opened, its input, `run`), and its history ends before it.
 */
function runningSession(
  run: unknown[] = [],
  status: "running" | "compacting" = "running",
): FakeSessionState {
  server.history = EARLIER;
  server.liveRun =
    status === "running" ? [taskBegin(), userText("fix the failing test"), ...run] : run;
  return server.addSession({ sessionId: SESSION_ID, status });
}

/** Ends the Session's run the way the server does: the stream reports idle. */
function endRun(session: FakeSessionState): void {
  session.status = "idle";
  server.emitServerEvent(session.sessionId, { type: "task_state", state: "idle" });
}

/** Ends the run, waits for the prompt the chat gives back, and quits. */
async function endAndExit(chat: Chat, session: FakeSessionState, enter = "\n"): Promise<void> {
  const prompt = chat.next("> ");
  endRun(session);
  await prompt();
  chat.type(`/exit${enter}`);
  await chat.done;
}

/** Resumes `SESSION_ID` (by its fragment) and waits until the chat says it follows the run under way. */
async function resumeRunning(tty = false): Promise<Chat> {
  const chat = startChat(["--resume", "cec67b17"], tty);
  await vi.waitFor(() => expect(chat.printed()).toContain(t.chatFollowingResumed()));
  return chat;
}

const steerTexts = (s: FakeSessionState): string[] => s.steers.map((b) => String(b.text));
const taskTexts = (s: FakeSessionState): string[] =>
  s.tasks.map((b) => (b.input as Array<{ text: string }>)[0]!.text);
const occurrences = (text: string, part: string): number => text.split(part).length - 1;

describe("chat --resume on a Session that is still running", () => {
  it("shows the history, the run so far and the rest of it, and prompts once the run ends", async () => {
    const session = runningSession([partialText("start", "The test fails because")]);
    const chat = await resumeRunning();
    await vi.waitFor(() => expect(chat.printed()).toContain("The test fails because"));
    expect(chat.printed()).toContain("first answer");
    expect(chat.printed()).toContain("> fix the failing test");

    server.emit(SESSION_ID, partialText("delta", " the fixture is stale."));
    server.emit(SESSION_ID, partialText("stop"));
    server.emit(SESSION_ID, assistantText("The test fails because the fixture is stale."));
    await vi.waitFor(() =>
      expect(chat.printed()).toContain("The test fails because the fixture is stale."),
    );
    expect(chat.printed().endsWith("> ")).toBe(false); // no prompt while the run goes on
    await endAndExit(chat, session);

    expect(occurrences(chat.printed(), "the fixture is stale.")).toBe(1);
    expect(session.tasks).toEqual([]);
    expect(chat.printed()).not.toContain("task_in_progress");
    expect(chat.printed()).toContain(`penguin chat --resume ${SESSION_ID}`);
  });

  it("sends a line typed meanwhile to the Task as steering", async () => {
    const session = runningSession();
    const chat = await resumeRunning();
    chat.type("also check the docs\n");
    await vi.waitFor(() => expect(steerTexts(session)).toEqual(["also check the docs"]));
    await vi.waitFor(() => expect(chat.printed()).toContain(t.steerQueued("also check the docs")));
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

  it("leaves on /exit and the Task goes on", async () => {
    const session = runningSession();
    const chat = await resumeRunning();
    chat.type("/exit\n");
    await chat.done;

    expect(session.status).toBe("running");
    expect(session.aborts).toBe(0);
    expect(session.steers).toEqual([]);
    expect(chat.printed()).toContain(`penguin chat --resume ${SESSION_ID}`);
  });

  it("asks the approval the Task waits on and sends the answer back", async () => {
    const call = toolCall({
      name: "exec_command",
      arguments: '{"cmd":"rm -rf dist"}',
      toolCallId: "c1",
    });
    const session = runningSession([call]);
    server.pendingApprovals = [{ type: "approval_request", toolCall: call }];
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

  it("shows once what the stream published before the history was read", async () => {
    const steering = userText(userSteeringText("keep the old API"));
    // Published between the chat's subscription and its history read: the server's run form
    // holds both, the delta folded into its fragment's start.
    const session = runningSession([partialText("start", "Renaming the helper"), steering]);
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
    expect(occurrences(chat.printed(), "keep the old API")).toBe(1);
  });

  it("keeps the summary a running compaction writes off the screen", async () => {
    const session = runningSession(
      [
        compactionBegin({ reason: "context", mode: "summarize", context: 150, turns: 3 }),
        partialText("start", "SUMMARY SO FAR"),
      ],
      "compacting",
    );
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

  it("says how many of the run's older records it does not show", async () => {
    const session = runningSession([partialText("start", "Still going")]);
    server.liveRunOmitted = 12;
    const chat = await resumeRunning();
    await vi.waitFor(() => expect(chat.printed()).toContain(t.chatRunOmitted(12)));
    await endAndExit(chat, session);
  });

  it("on an older server, says to upgrade it and still follows the run", async () => {
    server.legacyServer = true;
    // Such a server's history holds the run so far, and its live tail the open fragment.
    server.history = [...EARLIER, taskBegin(), userText("fix the failing test")];
    server.liveRun = [partialText("start", "Half")];
    const session = server.addSession({ sessionId: SESSION_ID, status: "running" });
    const chat = await resumeRunning();
    expect(chat.printed()).toContain(t.chatServerTooOld());
    expect(chat.printed()).toContain("> fix the failing test");
    server.emit(SESSION_ID, partialText("delta", " done."));
    server.emit(SESSION_ID, partialText("stop"));
    await vi.waitFor(() => expect(chat.printed()).toContain("Half done."));
    await endAndExit(chat, session);
  });
});

describe("chat: a run another surface starts", () => {
  /** Resumes the idle `SESSION_ID` and waits for its prompt. */
  async function resumeIdle(): Promise<{ chat: Chat; session: FakeSessionState }> {
    server.history = EARLIER;
    const session = server.addSession({ sessionId: SESSION_ID });
    const chat = startChat(["--resume", "cec67b17"]);
    await vi.waitFor(() => expect(chat.printed()).toContain("> "));
    return { chat, session };
  }

  /** The Web App starts a Task on the Session and streams its first words. */
  function startElsewhere(session: FakeSessionState): void {
    session.status = "running";
    server.emitServerEvent(SESSION_ID, { type: "task_state", state: "running" });
    server.emit(SESSION_ID, taskBegin());
    server.emit(SESSION_ID, userText("started in the browser"));
    server.emit(SESSION_ID, partialText("start", "Working"));
  }

  it("shows it, its input included, and prompts again once it ends", async () => {
    const { chat, session } = await resumeIdle();
    startElsewhere(session);
    server.emit(SESSION_ID, partialText("delta", " on it."));
    server.emit(SESSION_ID, partialText("stop"));
    await vi.waitFor(() => expect(chat.printed()).toContain("Working on it."));
    expect(chat.printed()).toContain("> started in the browser");

    // The chat's own message then runs as a Task of its own; its input, echoed by the run,
    // is the line typed, so it is not printed again.
    server.onTask = (_s, body) => [
      taskBegin(),
      userText((body.input as Array<{ text: string }>)[0]!.text),
      partialText("start", "the next answer"),
      partialText("stop"),
      assistantText("the next answer"),
    ];
    const prompt = chat.next("> ");
    endRun(session);
    await prompt();
    chat.type("next question\n");
    await vi.waitFor(() => expect(chat.printed()).toContain("the next answer"));
    chat.type("/exit\n");
    await chat.done;
    expect(taskTexts(session)).toEqual(["next question"]);
    expect(chat.printed()).not.toContain("> next question");
  });

  it("steers that run with a message sent while it is under way", async () => {
    const { chat, session } = await resumeIdle();
    startElsewhere(session);
    await vi.waitFor(() => expect(chat.printed()).toContain("Working"));
    chat.type("and add a test\n");
    await vi.waitFor(() => expect(steerTexts(session)).toEqual(["and add a test"]));
    await endAndExit(chat, session);

    expect(session.tasks).toEqual([]);
    expect(chat.printed()).not.toContain("task_in_progress");
  });

  it("queues a message sent while the Session compacts behind the compaction", async () => {
    const session = runningSession(
      [compactionBegin({ reason: "context", mode: "summarize", context: 150, turns: 3 })],
      "compacting",
    );
    const chat = await resumeRunning();
    chat.type("next question\n");
    await vi.waitFor(() =>
      expect(session.followUps.map((b) => (b.input as Array<{ text: string }>)[0]!.text)).toEqual([
        "next question",
      ]),
    );
    await vi.waitFor(() => expect(chat.printed()).toContain(t.messageQueued("next question")));
    await endAndExit(chat, session);
    expect(session.tasks).toEqual([]);
  });
});
