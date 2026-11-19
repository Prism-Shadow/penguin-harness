/**
 * `penguin chat` started from a console waits for what is typed there. Runs the built CLI under
 * a real pseudo-terminal (node-pty; ConPTY on Windows) against a server that knows nothing:
 * everything here happens before a first message, the only thing that would need one.
 *
 * - Given `penguin chat` started in a terminal, when a local command is typed, the chat answers
 *   it, and `/exit` then ends it with status 0.
 * - Given Windows, and the CLI started the way the installed `penguin.cmd` starts it (a cmd
 *   script running Node), the same holds.
 * - Given Windows, and the CLI started the way the desktop app's `penguin.cmd` starts it (a cmd
 *   script running the app's GUI-subsystem executable as Node), the same holds: the chat reads
 *   the console, not the empty stdin that executable is given (#1629).
 */
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { IPty } from "node-pty";
import { getMessages } from "@prismshadow/penguin-server/cli";

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
  /** Resolves once the screen shows `text`; rejects if the program exits first. */
  shows(text: string): Promise<void>;
  exited: Promise<number>;
  pid: number;
  running(): boolean;
}

function startInTerminal(file: string, args: string[], cwd: string, home: string): Terminal {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  // Nothing inherited may point the chat at another server, Session or runtime mode.
  for (const key of [
    "PENGUIN_API_URL",
    "PENGUIN_API_TOKEN",
    "PENGUIN_SESSION_ID",
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
  let screen = "";
  let code: number | null = null;
  const wake = new Set<() => void>();
  term.onData((data) => {
    screen += data;
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
    type: (text) => term.write(text),
    shows: (text) =>
      new Promise<void>((resolve, reject) => {
        const check = (): void => {
          if (screen.replace(ESCAPES, "").includes(text)) {
            wake.delete(check);
            resolve();
          } else if (code !== null) {
            wake.delete(check);
            reject(
              new Error(
                `exited with status ${code} before showing ${JSON.stringify(text)}; it showed:\n` +
                  screen.replace(ESCAPES, ""),
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
  start(dir: string, chatArgs: string[]): [string, string[]];
}

const comspec = process.env.ComSpec ?? "cmd.exe";
const launches: Launch[] = windows
  ? [
      {
        name: "the installed penguin.cmd (Node)",
        start: (dir, chatArgs) => [
          comspec,
          ["/d", "/c", cmdLauncher(dir, process.execPath, false), ...chatArgs],
        ],
      },
      {
        name: "the desktop app's penguin.cmd (Electron run as Node)",
        start: (dir, chatArgs) => [
          comspec,
          ["/d", "/c", cmdLauncher(dir, resolveHere("electron") as string, true), ...chatArgs],
        ],
      },
    ]
  : [{ name: "Node", start: (_dir, chatArgs) => [process.execPath, [entry, ...chatArgs]] }];

describe("penguin chat in a terminal", () => {
  // A server that knows no route: the chat asks it for the Project's default model, is told
  // nothing, and shows its prompt.
  const server = http.createServer((_req, res) => {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { code: "not_found", message: "not found" } }));
  });
  let url = "";
  let dir = "";
  let running: Terminal | null = null;

  beforeAll(async () => {
    if (!fs.existsSync(entry)) {
      throw new Error(
        `${entry} is missing: build the CLI first (pnpm --filter @prismshadow/penguin-cli build)`,
      );
    }
    repairSpawnHelper();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  afterEach(async () => {
    if (running?.running()) {
      if (windows) spawnSync("taskkill", ["/pid", String(running.pid), "/T", "/F"]);
      else process.kill(running.pid, "SIGKILL");
      await running.exited;
    }
    running = null;
    if (dir !== "") {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      dir = "";
    }
  });

  it.each(launches)(
    "started through $name, the chat answers what is typed and /exit ends it",
    async (launch) => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-chat-console-"));
      const home = path.join(dir, "home");
      fs.mkdirSync(home);
      const [file, args] = launch.start(dir, ["chat", "--server", url]);
      const chat = startInTerminal(file, args, dir, home);
      running = chat;

      // Typed once the banner is up, as a person would; the chat reads it from the terminal.
      await chat.shows(t.chatNewConversation());
      chat.type("/verbose\r");
      await chat.shows(t.verboseOn());
      chat.type("/exit\r");
      expect(await chat.exited).toBe(0);
    },
    // A runtime started cold in a terminal answers in a few seconds; on Windows the first
    // Electron case also fetches the Electron binary the lockfile pins (its package does that on
    // first use).
    30_000,
  );
});
