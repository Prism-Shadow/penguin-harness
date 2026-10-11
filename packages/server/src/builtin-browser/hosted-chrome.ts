/**
 * The hosted backend's Chrome as a process: where it is on this machine, and how it is launched.
 *
 * - Finding it: the path an admin set comes first, then the known names on PATH, then the
 *   standard install locations of the platform. The server never downloads one.
 * - Launching it: `--remote-debugging-pipe` — CDP over the child's fd 3 (in) and fd 4 (out),
 *   one JSON message per NUL — so no debugging port is opened and no other process on the
 *   machine can attach; `--headless=new`, always, even on a machine with a display; its own
 *   profile under the data root; no window at startup, so the only tabs are the ones asked for.
 *   Never `--no-sandbox`: a Chrome that cannot start with its sandbox (running as root, say)
 *   fails to launch, and what it printed is the reason given. On Linux `--password-store=basic`:
 *   without it Chrome asks the desktop's keyring for the key its cookies are encrypted with,
 *   and on a server, where a session bus exists but no keyring answers, every navigation waits
 *   on that for good. The profile's cookies are then protected by the directory's permissions
 *   alone (it is created for the server's user only).
 *
 * - Speaking to it: CdpConnection, request/reply and events over that pipe.
 *
 * Chrome exits when the pipe closes, so a server that dies takes its Chrome with it.
 */
import { spawn } from "node:child_process";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Readable, Writable } from "node:stream";
import { BrowserLinkError } from "./link.js";

/** The CDP pipe of one launched Chrome. */
export interface CdpPipe {
  /** One CDP message as JSON text. Throws when the pipe cannot take it. */
  send(text: string): void;
  onMessage(listener: (text: string) => void): void;
  /** The process ended, or never started. */
  onClose(listener: (exit: { code: number | null; signal: string | null }) => void): void;
  /** The end of what Chrome printed to stderr so far. */
  stderr(): string;
  /** Ends Chrome: closes the pipe, then signals the process. */
  kill(): void;
}

/** This machine's Chrome, as the hosted backend reaches it; a test supplies a fake one. */
export interface ChromeHost {
  /** The Chrome to launch, `configured` (the admin's path) first; null when none is installed. */
  find(configured: string | null): string | null;
  launch(chromePath: string, profileDir: string): CdpPipe;
}

export function hostedProfileDir(root: string): string {
  return path.join(root, "builtin-browser", "hosted-profile");
}

/** The names a Chrome goes by on PATH. */
const PATH_NAMES = [
  "google-chrome",
  "google-chrome-stable",
  "chromium",
  "chromium-browser",
  "chrome",
];

export interface FindChromeOptions {
  /** The path an admin set; tried first. */
  configured?: string | null;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  home?: string;
  /** Whether `file` is a program this process may run. */
  isExecutable?: (file: string) => boolean;
}

function isExecutableFile(file: string): boolean {
  try {
    if (!fs.statSync(file).isFile()) return false;
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Where each platform's installers put Chrome. */
function standardLocations(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, home: string) {
  if (platform === "darwin") {
    const apps = [
      "Google Chrome.app/Contents/MacOS/Google Chrome",
      "Chromium.app/Contents/MacOS/Chromium",
    ];
    return ["/Applications", path.posix.join(home, "Applications")].flatMap((dir) =>
      apps.map((app) => path.posix.join(dir, app)),
    );
  }
  if (platform === "win32") {
    return [env.PROGRAMFILES, env["PROGRAMFILES(X86)"], env.LOCALAPPDATA]
      .filter((dir): dir is string => typeof dir === "string" && dir !== "")
      .flatMap((dir) => [
        path.win32.join(dir, "Google", "Chrome", "Application", "chrome.exe"),
        path.win32.join(dir, "Chromium", "Application", "chrome.exe"),
      ]);
  }
  return ["/opt/google/chrome/chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"];
}

/** The Chrome to launch on this machine, or null when there is none; see the module doc. */
export function findChrome(opts: FindChromeOptions = {}): string | null {
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;
  const isExecutable = opts.isExecutable ?? isExecutableFile;
  const lib = platform === "win32" ? path.win32 : path.posix;
  const candidates: string[] = [];
  if (typeof opts.configured === "string" && opts.configured !== "") {
    candidates.push(opts.configured);
  }
  const dirs = (env.PATH ?? env.Path ?? "").split(lib.delimiter).filter((dir) => dir !== "");
  for (const name of PATH_NAMES) {
    const file = platform === "win32" ? `${name}.exe` : name;
    for (const dir of dirs) candidates.push(lib.join(dir, file));
  }
  candidates.push(...standardLocations(platform, env, opts.home ?? os.homedir()));
  return candidates.find((file) => isExecutable(file)) ?? null;
}

/** The whole command line of a hosted Chrome. */
export function chromeArgs(
  profileDir: string,
  platform: NodeJS.Platform = process.platform,
): string[] {
  return [
    "--remote-debugging-pipe",
    "--headless=new",
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--no-startup-window",
    ...(platform === "linux" ? ["--password-store=basic"] : []),
  ];
}

/** How much of Chrome's stderr is kept: the end of it, where a failure says why. */
const STDERR_KEPT = 8 * 1024;
/** After the pipe is closed and the process signalled, how long until it is killed outright. */
const KILL_GRACE_MS = 3_000;

type Spawn = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

/**
 * Launches Chrome on `profileDir` (created when missing) and returns its CDP pipe. A program
 * that cannot be started at all closes the pipe with the system's error as its stderr.
 */
export function launchChrome(
  chromePath: string,
  profileDir: string,
  spawnProcess: Spawn = spawn,
): CdpPipe {
  fs.mkdirSync(profileDir, { recursive: true, mode: 0o700 });
  const child = spawnProcess(chromePath, chromeArgs(profileDir), {
    stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const toChrome = child.stdio[3] as Writable;
  const fromChrome = child.stdio[4] as Readable;
  let stderr = "";
  let closed = false;
  let killTimer: NodeJS.Timeout | null = null;
  let messageListener: ((text: string) => void) | null = null;
  const closeListeners = new Set<(exit: { code: number | null; signal: string | null }) => void>();
  const close = (code: number | null, signal: string | null) => {
    if (closed) return;
    closed = true;
    if (killTimer !== null) clearTimeout(killTimer);
    for (const listener of closeListeners) listener({ code, signal });
  };

  // A message may span chunks, and a chunk may hold several: split on the NUL bytes, decoding
  // only whole messages (a chunk boundary can fall inside a multi-byte character).
  let partial: Buffer[] = [];
  fromChrome.on("data", (chunk: Buffer) => {
    let start = 0;
    for (;;) {
      const end = chunk.indexOf(0, start);
      if (end === -1) break;
      const text = Buffer.concat([...partial, chunk.subarray(start, end)]).toString("utf8");
      partial = [];
      start = end + 1;
      messageListener?.(text);
    }
    if (start < chunk.length) partial.push(chunk.subarray(start));
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString("utf8")).slice(-STDERR_KEPT);
  });
  // A write to a Chrome that is going away fails here; the exit says the rest.
  toChrome.on("error", () => {});
  fromChrome.on("error", () => {});
  child.on("error", (err) => {
    stderr = `${stderr}${err.message}\n`;
    close(null, null);
  });
  child.on("exit", (code, signal) => close(code, signal));

  return {
    send(text) {
      if (closed) throw new Error("Chrome has exited.");
      toChrome.write(`${text}\0`);
    },
    onMessage(listener) {
      messageListener = listener;
    },
    onClose(listener) {
      closeListeners.add(listener);
    },
    stderr: () => stderr,
    kill() {
      if (closed || killTimer !== null) return;
      toChrome.end();
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS);
      killTimer.unref?.();
    },
  };
}

/**
 * Chrome's own error line out of what it printed: the last line it logged as an error (its
 * `[pid:tid:time:ERROR:file:line]` prefix removed), else its last line; `fallback` when it
 * printed nothing.
 */
export function launchFailureLine(stderr: string, fallback: string): string {
  const lines = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const logged = /^\[[^\]]*:(?:ERROR|FATAL):[^\]]*\]\s*/;
  const line = lines.findLast((candidate) => logged.test(candidate)) ?? lines.at(-1);
  if (line === undefined) return fallback;
  return line.replace(logged, "").slice(0, 500);
}

interface PendingCall {
  resolve(result: unknown): void;
  reject(err: BrowserLinkError): void;
  timer: NodeJS.Timeout;
  sessionId: string | undefined;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** What a command fails with once its Chrome is gone. */
const EXITED = "The Chrome on this machine exited.";

/**
 * CDP over one Chrome's pipe: commands with their replies, on the browser or on a target's flat
 * session, and the events in between. A failure is a BrowserLinkError — `refused` with Chrome's
 * own message, `timeout`, or `closed` once the pipe is gone.
 */
export class CdpConnection {
  private readonly pending = new Map<number, PendingCall>();
  private seq = 0;
  private closed = false;

  constructor(
    private readonly pipe: CdpPipe,
    /** Every event, in order; `sessionId` is absent for the browser's own. */
    private readonly onEvent: (
      method: string,
      params: Record<string, unknown>,
      sessionId: string | undefined,
    ) => void,
    private readonly log: (line: string) => void,
  ) {
    pipe.onMessage((text) => this.receive(text));
  }

  /** How many commands wait for their reply. */
  get waiting(): number {
    return this.pending.size;
  }

  /** One CDP command, on the browser or (with `sessionId`) on a target's session. */
  call(
    method: string,
    params: Record<string, unknown>,
    sessionId: string | undefined,
    timeoutMs: number,
  ): Promise<unknown> {
    if (this.closed) return Promise.reject(new BrowserLinkError("closed", EXITED));
    this.seq += 1;
    const id = this.seq;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new BrowserLinkError(
            "timeout",
            `Chrome did not answer '${method}' within ${Math.round(timeoutMs / 1000)}s.`,
          ),
        );
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, sessionId });
      try {
        this.pipe.send(
          JSON.stringify({ id, method, params, ...(sessionId !== undefined ? { sessionId } : {}) }),
        );
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new BrowserLinkError("closed", messageOf(err)));
      }
    });
  }

  /** Fails what waits on one session as refused with `error` (its target closed or crashed). */
  refuseSession(sessionId: string, error: string): void {
    for (const [id, pending] of this.pending) {
      if (pending.sessionId !== sessionId) continue;
      clearTimeout(pending.timer);
      this.pending.delete(id);
      pending.reject(new BrowserLinkError("refused", error));
    }
  }

  /** Chrome is gone: whatever waits fails `closed`, and nothing more is sent or heard. */
  close(): void {
    this.closed = true;
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      this.pending.delete(id);
      pending.reject(new BrowserLinkError("closed", EXITED));
    }
  }

  /** One message off the pipe. Never throws: what fails here is logged, and the message dropped. */
  private receive(text: string): void {
    if (this.closed) return;
    try {
      const message: unknown = JSON.parse(text);
      if (!isRecord(message)) return;
      if (typeof message.id === "number") {
        this.settle(message.id, message);
      } else if (typeof message.method === "string") {
        this.onEvent(
          message.method,
          isRecord(message.params) ? message.params : {},
          typeof message.sessionId === "string" ? message.sessionId : undefined,
        );
      }
    } catch (err) {
      this.log(`hosted browser: dropped a message from Chrome: ${messageOf(err)}`);
    }
  }

  private settle(id: number, message: Record<string, unknown>): void {
    const pending = this.pending.get(id);
    if (pending === undefined) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    if (isRecord(message.error)) {
      const said = message.error.message;
      pending.reject(
        new BrowserLinkError(
          "refused",
          typeof said === "string" ? said : "Chrome refused the command.",
        ),
      );
    } else {
      pending.resolve(message.result ?? {});
    }
  }
}

/** The real machine: its file system, and Chrome as a child process. */
export const systemChromeHost: ChromeHost = {
  find: (configured) => findChrome({ configured }),
  launch: (chromePath, profileDir) => launchChrome(chromePath, profileDir),
};
