/**
 * One terminal session: a pty plus the daemon's authoritative view of its screen.
 *
 * The important idea is that the *server* owns the emulator: every pty byte is fed into a
 * headless xterm here, so the daemon always knows the full screen, cursor and title.
 * Clients are then just views that can come and go — which is what makes reload/reattach,
 * plain-text capture and multi-device viewing possible at all. A client-only emulator
 * would lose all of that the moment the tab closes.
 *
 * Sessions deliberately run in-process rather than in a forked terminal worker. A worker
 * would keep pty parsing off the daemon's event loop under heavy build output, but costs
 * an IPC protocol and a second process to supervise. Worth doing when this is under load,
 * not on day one — the seam (this module is the only thing that touches node-pty) is where
 * that split would go.
 */
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import xterm, { type Terminal } from "@xterm/headless";
import pty, { type IPty } from "node-pty";
import { TerminalInputModeTracker } from "./input-mode.js";
import { ensureSpawnHelperExecutable } from "./spawn-helper.js";
import {
  captureLines,
  renderRestoreAnsi,
  type CaptureLinesOptions,
  type CaptureLinesResult,
} from "./snapshot.js";
import {
  applyTerminalSize,
  releaseTerminalSize,
  type TerminalSizeState,
} from "./size-ownership.js";

const { Terminal: HeadlessTerminal } = xterm;

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const SCROLLBACK_LINES = 5000;
const TITLE_DEBOUNCE_MS = 150;
const EXIT_OUTPUT_LINE_LIMIT = 12;

/**
 * Answers to capability queries. A headless emulator has no display to ask, so the daemon
 * answers on its behalf — without this, anything that probes the terminal (nvim, less,
 * fzf, some prompts) waits for a reply that never comes and appears to hang on startup.
 */
const OSC_COLOR_QUERY_RESPONSES = new Map<number, string>([
  [10, "rgb:e6e6/e6e6/e6e6"], // foreground
  [11, "rgb:1414/1717/1a1a"], // background
  [12, "rgb:e6e6/e6e6/e6e6"], // cursor
]);

export interface TerminalExitInfo {
  exitCode: number;
  signal: number | null;
  lastOutputLines: string[];
}

export interface CreateTerminalSessionOptions {
  id?: string;
  /** Absolute working directory (already resolved and validated by the manager). */
  cwd: string;
  /** Owning user id — a shell is the most privileged thing this server hands out. */
  ownerUserId: string;
  /**
   * Stable per-user display number (tmux-style), assigned by the manager at creation. It
   * travels with the terminal for its whole life — UI numbering must never depend on list
   * position, which changes under user-reordered tabs.
   */
  seq?: number;
  name?: string;
  shell?: string;
  cols?: number;
  rows?: number;
  env?: Record<string, string>;
}

export interface TerminalSessionInfo {
  id: string;
  seq: number;
  name: string;
  cwd: string;
  ownerUserId: string;
  title: string | null;
  cols: number;
  rows: number;
  pid: number;
  createdAt: string;
  alive: boolean;
  exit: TerminalExitInfo | null;
}

export type TerminalOutputListener = (data: string) => void;
export type TerminalExitListener = (info: TerminalExitInfo) => void;
export type TerminalTitleListener = (title: string | null) => void;

/** Default login shell, mirroring what the user would get from a real terminal emulator. */
export function resolveDefaultShell(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === "win32") return env.ComSpec || env.COMSPEC || "C:\\Windows\\System32\\cmd.exe";
  return env.SHELL || "/bin/sh";
}

/**
 * Environment for the pty. `TERM`/`COLORTERM` are what make colour and 256-colour output
 * work at all; the rest of the parent environment is inherited so the shell behaves like the
 * user's own (PATH, proxies, language).
 */
function buildTerminalEnv(
  extra: Record<string, string> | undefined,
  cwd: string,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") env[key] = value;
  }
  Object.assign(env, extra ?? {});
  env.TERM = "xterm-256color";
  env.COLORTERM = "truecolor";
  env.PENGUIN_TERMINAL = "1";
  env.PWD = cwd;
  // Inherited from the server process; a pty is not that server and these would point the
  // shell (and anything it starts) at the wrong runtime.
  delete env.NODE_OPTIONS;
  return env;
}

export class TerminalSession {
  readonly id: string;
  readonly seq: number;
  readonly cwd: string;
  readonly ownerUserId: string;
  readonly createdAt = new Date();

  private name: string;
  private readonly terminal: Terminal;
  private readonly ptyProcess: IPty;
  private readonly inputMode = new TerminalInputModeTracker();
  private readonly outputListeners = new Set<TerminalOutputListener>();
  private readonly exitListeners = new Set<TerminalExitListener>();
  private readonly titleListeners = new Set<TerminalTitleListener>();

  private title: string | null = null;
  private pendingTitle: string | null = null;
  private titleTimer: ReturnType<typeof setTimeout> | null = null;
  private sizeState: TerminalSizeState;
  private exitInfo: TerminalExitInfo | null = null;
  private disposed = false;

  constructor(options: CreateTerminalSessionOptions) {
    this.id = options.id ?? randomUUID();
    this.seq = options.seq ?? 1;
    this.cwd = options.cwd;
    this.ownerUserId = options.ownerUserId;
    this.name = options.name ?? (path.basename(options.cwd) || "terminal");

    const cols = clampDimension(options.cols, DEFAULT_COLS, 1000);
    const rows = clampDimension(options.rows, DEFAULT_ROWS, 500);
    this.sizeState = { ownerId: null, cols, rows };

    this.terminal = new HeadlessTerminal({
      cols,
      rows,
      scrollback: SCROLLBACK_LINES,
      allowProposedApi: true,
    });

    const shell = options.shell ?? resolveDefaultShell();
    // Before the first spawn on macOS: node-pty's prebuilt spawn-helper ships without an
    // exec bit, and posix_spawnp refuses it (see spawn-helper.ts).
    ensureSpawnHelperExecutable();
    this.ptyProcess = pty.spawn(shell, shellArgs(shell), {
      name: "xterm-256color",
      cols,
      rows,
      cwd: options.cwd,
      env: buildTerminalEnv(options.env, options.cwd),
    });

    this.registerCapabilityResponders();

    this.terminal.onTitleChange((next) => {
      this.pendingTitle = next.trim() || null;
      if (this.titleTimer) return;
      // A shell that writes the title on every prompt would otherwise fan out an event per
      // keystroke to every attached client.
      this.titleTimer = setTimeout(() => {
        this.titleTimer = null;
        if (this.pendingTitle === this.title) return;
        this.title = this.pendingTitle;
        for (const listener of [...this.titleListeners]) safely(() => listener(this.title));
      }, TITLE_DEBOUNCE_MS);
    });

    this.ptyProcess.onData((chunk) => {
      this.inputMode.feed(chunk);
      // Publish only once the emulator has consumed the chunk (`write` parses async).
      // Publishing eagerly opens a gap where a client attaches after the publication but
      // before the parse: the snapshot it restores from lacks the bytes AND its output
      // subscription started too late — the chunk is simply lost to that client. Ordering
      // behind the write callback makes every byte either part of the snapshot or
      // delivered through the subscription, never neither.
      this.terminal.write(chunk, () => {
        for (const listener of [...this.outputListeners]) safely(() => listener(chunk));
      });
    });

    this.ptyProcess.onExit(({ exitCode, signal }) => {
      // The screen is still readable after the shell exits, so the tail is captured and the
      // session is kept (briefly) by the manager — a reload right after `exit` shows what
      // happened instead of an empty box. Capture must wait for the emulator to drain its
      // async write queue, or the final burst of output is missing from the tail.
      const finalize = (): void => {
        if (this.exitInfo) return;
        this.exitInfo = {
          exitCode,
          signal: signal ?? null,
          lastOutputLines: this.disposed
            ? []
            : lastNonEmptyLines(this.terminal, EXIT_OUTPUT_LINE_LIMIT),
        };
        for (const listener of [...this.exitListeners]) safely(() => listener(this.exitInfo!));
      };
      if (this.disposed) return finalize(); // a disposed emulator accepts no more writes
      this.terminal.write("", finalize);
    });
  }

  /** DA1 / DSR / OSC colour queries — see OSC_COLOR_QUERY_RESPONSES. */
  private registerCapabilityResponders(): void {
    this.terminal.parser.registerCsiHandler({ final: "c" }, (params) => {
      if (params.length === 0 || (params.length === 1 && params[0] === 0)) {
        this.ptyProcess.write("\x1b[?62;4;22c"); // VT220 + sixel-less, matching a modern xterm
        return true;
      }
      return false;
    });
    this.terminal.parser.registerCsiHandler({ final: "n" }, (params) => {
      if (params.length !== 1) return false;
      if (params[0] === 5) {
        this.ptyProcess.write("\x1b[0n"); // device OK
        return true;
      }
      if (params[0] === 6) {
        const buffer = this.terminal.buffer.active;
        this.ptyProcess.write(`\x1b[${buffer.cursorY + 1};${buffer.cursorX + 1}R`);
        return true;
      }
      return false;
    });
    this.terminal.parser.registerCsiHandler({ prefix: "?", final: "n" }, (params) => {
      if (params.length !== 1 || params[0] !== 6) return false;
      const buffer = this.terminal.buffer.active;
      this.ptyProcess.write(`\x1b[?${buffer.cursorY + 1};${buffer.cursorX + 1}R`);
      return true;
    });
    for (const [code, response] of OSC_COLOR_QUERY_RESPONSES) {
      this.terminal.parser.registerOscHandler(code, (data) => {
        if (data.trim() !== "?") return false;
        this.ptyProcess.write(`\x1b]${code};${response}\x1b\\`);
        return true;
      });
    }
  }

  get alive(): boolean {
    return this.exitInfo === null && !this.disposed;
  }

  get exit(): TerminalExitInfo | null {
    return this.exitInfo;
  }

  info(): TerminalSessionInfo {
    return {
      id: this.id,
      seq: this.seq,
      name: this.name,
      cwd: this.cwd,
      ownerUserId: this.ownerUserId,
      title: this.title,
      cols: this.sizeState.cols,
      rows: this.sizeState.rows,
      pid: this.ptyProcess.pid,
      createdAt: this.createdAt.toISOString(),
      alive: this.alive,
      exit: this.exitInfo,
    };
  }

  rename(name: string): void {
    const trimmed = name.trim();
    if (trimmed) this.name = trimmed;
  }

  write(data: string): void {
    if (!this.alive) return;
    this.ptyProcess.write(data);
  }

  /**
   * Applies a size request under the claim/update ownership rule, resizing both the pty and
   * the daemon's emulator so snapshots keep matching what the shell laid out.
   */
  resize(request: {
    connectionId: string;
    cols: number;
    rows: number;
    intent: "claim" | "update";
  }): boolean {
    const cols = clampDimension(request.cols, DEFAULT_COLS, 1000);
    const rows = clampDimension(request.rows, DEFAULT_ROWS, 500);
    const decision = applyTerminalSize(this.sizeState, { ...request, cols, rows });
    this.sizeState = decision.state;
    if (!decision.apply || !this.alive) return false;
    this.terminal.resize(cols, rows);
    try {
      this.ptyProcess.resize(cols, rows);
    } catch {
      // The pty can exit between the alive check and here; the exit path handles teardown.
    }
    return true;
  }

  releaseSize(connectionId: string): void {
    this.sizeState = releaseTerminalSize(this.sizeState, connectionId);
  }

  get size(): { cols: number; rows: number } {
    return { cols: this.sizeState.cols, rows: this.sizeState.rows };
  }

  /** The attach payload: the whole screen as an ANSI stream (see snapshot.ts). */
  restoreStream(options: { scrollbackLines?: number } = {}): string {
    return renderRestoreAnsi(this.terminal, {
      ...options,
      inputModePreamble: this.inputMode.preamble(),
    });
  }

  capture(options: CaptureLinesOptions = {}): CaptureLinesResult {
    return captureLines(this.terminal, options);
  }

  onOutput(listener: TerminalOutputListener): () => void {
    this.outputListeners.add(listener);
    return () => this.outputListeners.delete(listener);
  }

  onExit(listener: TerminalExitListener): () => void {
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  onTitleChange(listener: TerminalTitleListener): () => void {
    this.titleListeners.add(listener);
    return () => this.titleListeners.delete(listener);
  }

  kill(signal?: string): void {
    if (!this.alive) return;
    try {
      this.ptyProcess.kill(signal);
    } catch {
      // Already gone.
    }
  }

  dispose(): void {
    if (this.disposed) return;
    if (this.titleTimer) clearTimeout(this.titleTimer);
    // Order matters: kill() no-ops once `disposed` flips `alive` to false, so the polite
    // SIGHUP has to go out first (that ordering bug once left every shell running after
    // server shutdown — only the test process exiting hid it).
    this.kill();
    this.disposed = true;
    // SIGHUP is also advisory: a server started under `nohup` has HUP ignored, children
    // inherit that, and the hangup silently does nothing. Disposal is final — escalate.
    if (process.platform !== "win32" && this.exitInfo === null) {
      try {
        this.ptyProcess.kill("SIGKILL");
      } catch {
        // Already gone.
      }
    }
    this.outputListeners.clear();
    this.exitListeners.clear();
    this.titleListeners.clear();
    this.terminal.dispose();
  }
}

function shellArgs(shell: string): string[] {
  // Login shell so the user's normal profile (PATH, aliases, prompt) is in effect, exactly
  // like opening a terminal app. cmd.exe has no equivalent flag.
  return path.basename(shell).toLowerCase().startsWith("cmd") ? [] : ["-l"];
}

function clampDimension(value: number | undefined, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), 1), max);
}

function lastNonEmptyLines(terminal: Terminal, limit: number): string[] {
  const buffer = terminal.buffer.active;
  const total = buffer.baseY + terminal.rows;
  const lines: string[] = [];
  for (let y = total - 1; y >= 0 && lines.length < limit; y -= 1) {
    const text = buffer.getLine(y)?.translateToString(true) ?? "";
    if (text.trim() === "" && lines.length === 0) continue; // skip the blank tail
    lines.push(text);
  }
  return lines.reverse();
}

function safely(fn: () => void): void {
  try {
    fn();
  } catch {
    // One bad listener must not take down the pty pump.
  }
}

/** Home-directory expansion for the API's `cwd` (the UI sends `~`). */
export function expandHomePath(input: string): string {
  if (input === "~") return os.homedir();
  if (input.startsWith("~/")) return path.join(os.homedir(), input.slice(2));
  return input;
}
