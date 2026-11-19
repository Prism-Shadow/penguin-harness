/**
 * The CLI's prompts, answered from a real terminal. Runs the built CLI under a pseudo-terminal
 * (node-pty; ConPTY on Windows) against the fake server, served over HTTP.
 *
 * - Given `penguin chat`, when a local command is typed, the chat answers it, and `/exit` then
 *   ends it with status 0.
 * - Given `penguin run --approve always-ask` and a tool call waiting for approval, when `y` is
 *   typed at the prompt, the server is told `allow` and the run ends with status 0.
 * - Given `penguin auth login`, when Enter takes the suggested account and the password is
 *   typed, the password reaches the server and never shows on the screen, and the sign-in ends
 *   with status 0.
 *
 * Each starts the CLI the way a person does there: Node itself on Linux and macOS. On Windows,
 * cmd launchers shaped like the shipped ones run it: the installed `penguin.cmd` (Node) for the
 * chat, and the desktop app's `penguin.cmd` (the app's GUI-subsystem executable run as Node) for
 * all three. That runtime is given no stdin, and every prompt reads the console instead (#1629).
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { IPty } from "node-pty";
import { toolCall } from "@prismshadow/penguin-core";
import { getMessages } from "@prismshadow/penguin-server/cli";
import { FakeServer } from "./fake-server.js";

const resolveHere = createRequire(import.meta.url);
const pty = resolveHere("node-pty") as typeof import("node-pty");

const cliDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = path.join(cliDir, "dist", "penguin.js");
const t = getMessages("en");
const windows = process.platform === "win32";

/**
 * node-pty's macOS prebuild ships its `spawn-helper` without the exec bit, and every spawn then
 * fails with "posix_spawnp failed.". The server restores the bit before its first terminal
 * (server terminal/spawn-helper.ts); this test spawns before any server has.
 */
function repairSpawnHelper(): void {
  if (process.platform !== "darwin") return;
  const dir = path.dirname(resolveHere.resolve("node-pty/package.json"));
  for (const rel of ["build/Release", "build/Debug", `prebuilds/darwin-${process.arch}`]) {
    const helper = path.join(dir, ...rel.split("/"), "spawn-helper");
    try {
      const { mode } = fs.statSync(helper);
      if ((mode & 0o111) === 0) fs.chmodSync(helper, mode | 0o111);
    } catch {
      // This copy of node-pty neither ships nor built that variant.
    }
  }
}

/** CSI, OSC and two-character escapes: what a terminal draws with, not what it shows. */
const ESCAPES = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;

/** A program running in a pseudo-terminal: what it has shown so far, and how it ended. */
interface Terminal {
  type(text: string): void;
  /**
   * Resolves once the screen shows `text` (its trailing blanks aside: a terminal draws none);
   * rejects if the program exits first.
   */
  shows(text: string): Promise<void>;
  /** Everything shown so far, as text. */
  screen(): string;
  exited: Promise<number>;
  pid: number;
  running(): boolean;
}

function startInTerminal(file: string, args: string[], cwd: string, home: string): Terminal {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  // Nothing inherited may point the CLI at another server, Session, account or runtime mode.
  for (const key of [
    "PENGUIN_API_URL",
    "PENGUIN_API_TOKEN",
    "PENGUIN_SESSION_ID",
    "PENGUIN_PROJECT_ID",
    "PENGUIN_AGENT_ID",
    "PENGUIN_ORG_ID",
    "PENGUIN_PASSWORD",
    "ELECTRON_RUN_AS_NODE",
  ]) {
    delete env[key];
  }
  Object.assign(env, { PENGUIN_HOME: home, PENGUIN_LANG: "en", TERM: "xterm-256color" });
  const term: IPty = pty.spawn(file, args, {
    name: "xterm-256color",
    cols: 200,
    rows: 50,
    cwd,
    env,
  });
  let raw = "";
  let code: number | null = null;
  const wake = new Set<() => void>();
  const screen = (): string => raw.replace(ESCAPES, "");
  term.onData((data) => {
    raw += data;
    for (const check of [...wake]) check();
  });
  const exited = new Promise<number>((resolve) => {
    term.onExit(({ exitCode }) => {
      code = exitCode;
      resolve(exitCode);
      for (const check of [...wake]) check();
    });
  });
  return {
    pid: term.pid,
    exited,
    running: () => code === null,
    screen,
    type: (text) => term.write(text),
    shows: (text) =>
      new Promise<void>((resolve, reject) => {
        const wanted = text.trimEnd();
        const check = (): void => {
          if (screen().includes(wanted)) {
            wake.delete(check);
            resolve();
          } else if (code !== null) {
            wake.delete(check);
            reject(
              new Error(
                `exited with status ${code} before showing ${JSON.stringify(wanted)}; it showed:\n` +
                  screen(),
              ),
            );
          }
        };
        wake.add(check);
        check();
      }),
  };
}

/** A cmd script of the shape the shipped launchers have: `exe` runs `entry` with the arguments. */
function cmdLauncher(dir: string, exe: string, asNode: boolean): string {
  const file = path.join(dir, "penguin.cmd");
  fs.writeFileSync(
    file,
    [
      "@echo off",
      "setlocal",
      ...(asNode ? ['set "ELECTRON_RUN_AS_NODE=1"'] : []),
      `"${exe}" "${entry}" %*`,
      "exit /b %errorlevel%",
      "",
    ].join("\r\n"),
  );
  return file;
}

interface Launch {
  name: string;
  /** The program the pseudo-terminal runs, and its arguments, given a scratch directory. */
  start(dir: string, cliArgs: string[]): [string, string[]];
}

const comspec = process.env.ComSpec ?? "cmd.exe";
const NODE: Launch = {
  name: "Node",
  start: (_dir, cliArgs) => [process.execPath, [entry, ...cliArgs]],
};
const INSTALLED: Launch = {
  name: "the installed penguin.cmd (Node)",
  start: (dir, cliArgs) => [
    comspec,
    ["/d", "/c", cmdLauncher(dir, process.execPath, false), ...cliArgs],
  ],
};
const DESKTOP: Launch = {
  name: "the desktop app's penguin.cmd (Electron run as Node)",
  start: (dir, cliArgs) => [
    comspec,
    ["/d", "/c", cmdLauncher(dir, resolveHere("electron") as string, true), ...cliArgs],
  ],
};
/** Where the chat is checked, and where every other prompt is. */
const chatLaunches = windows ? [INSTALLED, DESKTOP] : [NODE];
const promptLaunches = windows ? [DESKTOP] : [NODE];

// A runtime started cold in a terminal answers in a few seconds; on Windows the first Electron
// case also fetches the Electron binary the lockfile pins (its package does that on first use).
const PROCESS_TIMEOUT = 30_000;

describe("the CLI's prompts in a terminal", () => {
  let server: FakeServer;
  let url = "";
  let closeServer: () => Promise<void> = async () => {};
  let dir = "";
  let home = "";
  let running: Terminal | null = null;

  beforeAll(() => {
    if (!fs.existsSync(entry)) {
      throw new Error(
        `${entry} is missing: build the CLI first (pnpm --filter @prismshadow/penguin-cli build)`,
      );
    }
    repairSpawnHelper();
  });
  beforeEach(async () => {
    server = new FakeServer();
    ({ url, close: closeServer } = await server.listen());
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-terminal-prompts-"));
    home = path.join(dir, "home");
    fs.mkdirSync(home);
  });
  afterEach(async () => {
    if (running?.running()) {
      if (windows) spawnSync("taskkill", ["/pid", String(running.pid), "/T", "/F"]);
      else process.kill(running.pid, "SIGKILL");
      await running.exited;
    }
    running = null;
    await closeServer();
    server.uninstall();
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  /** The CLI with `cliArgs`, started through `launch` in a fresh terminal. */
  const start = (launch: Launch, cliArgs: string[]): Terminal => {
    const [file, args] = launch.start(dir, cliArgs);
    running = startInTerminal(file, args, dir, home);
    return running;
  };

  it.each(chatLaunches)(
    "chat, started through $name, answers what is typed and /exit ends it",
    async (launch) => {
      const chat = start(launch, ["chat", "--server", url]);
      // Typed once the banner is up, as a person would; the chat reads it from the terminal.
      await chat.shows(t.chatNewConversation());
      chat.type("/verbose\r");
      await chat.shows(t.verboseOn());
      chat.type("/exit\r");
      expect(await chat.exited).toBe(0);
    },
    PROCESS_TIMEOUT,
  );

  it.each(promptLaunches)(
    "run --approve always-ask, started through $name, sends the approval typed at its prompt",
    async (launch) => {
      // The task waits on one tool call's approval, and ends once it is answered.
      server.hangTasks = true;
      server.onTask = (session) => {
        server.emitServerEvent(session.sessionId, {
          type: "approval_request",
          toolCall: toolCall({ name: "exec_command", arguments: '{"cmd":"ls"}', toolCallId: "c1" }),
        });
        return [];
      };
      server.onApproval = (session) => {
        session.status = "idle";
        server.emitServerEvent(session.sessionId, { type: "task_state", state: "idle" });
      };
      const run = start(launch, [
        "run",
        "--approve",
        "always-ask",
        "-m",
        "list it",
        "--server",
        url,
      ]);
      await run.shows(t.approvePrompt());
      run.type("y\r");
      expect(await run.exited).toBe(0);
      const answer = server.requests.find(
        (r) => r.method === "POST" && r.path.endsWith("/approvals/c1"),
      );
      expect(answer?.body).toEqual({ decision: "allow" });
    },
    PROCESS_TIMEOUT,
  );

  it.each(promptLaunches)(
    "auth login, started through $name, sends the password typed at its prompt and never shows it",
    async (launch) => {
      const login = start(launch, ["auth", "login", "--server", url]);
      await login.shows(t.auth.accountPrompt("admin"));
      login.type("\r");
      await login.shows(t.auth.prompt("admin"));
      login.type(`${server.password}\r`);
      expect(await login.exited).toBe(0);
      const signIn = server.requests.find((r) => r.path === "/api/auth/login");
      expect(signIn?.body).toEqual({ userId: "admin", password: server.password });
      expect(login.screen()).not.toContain(server.password);
    },
    PROCESS_TIMEOUT,
  );
});
