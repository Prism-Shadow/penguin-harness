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
import type { IPty } from "node-pty";
import { loadNodePty, loadedNodePtyDir } from "./pty-module.js";
import { defaultTerminalShell } from "./shell.js";
import { shellLaunch, type ShellNotice, type TerminalPathFirst } from "./shell-startup.js";
import { TerminalInputModeTracker } from "./input-mode.js";
import { ensureSpawnHelperExecutable } from "../terminal/spawn-helper.js";
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
   * The conversation (PenguinHarness Session) this shell was opened for — not this object's own
   * id. A label the Web App files the shell under, so each conversation lists only its own; null
   * for a shell no conversation asked for (the API, the CLI, the standalone /terminal page).
   */
  sessionId?: string | null;
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
  /**
   * Where a pushed bundle's node-pty assets live (the hmr capability's assetsDir);
   * absent falls back to the packaged require (see pty-module.ts).
   */
  assets?: () => string | null;
  /**
   * What leads PATH once the shell's own startup files have run: the server's CLI shim
   * directory, so `penguin` here is the one the Agent's commands get (see shell-startup.ts).
   * Absent or null, the shell starts with the inherited PATH as it is.
   */
  pathFirst?: TerminalPathFirst | null;
  /**
   * One line shown above everything the shell prints — on a development instance, which
   * `penguin` this terminal runs, or why it is not this instance's (cli-notice.ts). Written to
   * the screen, never to the shell: nothing runs, and the user's prompt follows it. A line with
   * a `target` the shell prints itself instead, at its first prompt, where it can
   * (shell-startup.ts ShellNotice): only then is it known what the user's own startup files left
   * `penguin` pointing at.
   */
  notice?: TerminalNotice | null;
  /**
   * Whether the shell keeps the server process's `PENGUIN_HOME` and `PENGUIN_WEB_DB`. Only
   * where no shim names this server's data root for `penguin` — a server with no CLI to offer,
   * or a runtime older than the shim's root default — so that `penguin` there still finds this
   * server the way it did before. Default false: every `PENGUIN_*` stays out.
   */
  inheritDataRoot?: boolean;
}

/** A line the server shows at the top of a new terminal; `warning` when something is wrong. */
export interface TerminalNotice {
  text: string;
  tone: "info" | "warning";
  /**
   * What `text` takes for granted: that `penguin` here targets this data root. On a development
   * instance's line, which then says otherwise — `elsewhere`'s two halves around `VAR=value` —
   * when the shell's own startup files set PENGUIN_API_URL, or a PENGUIN_HOME that is not `root`.
   */
  target?: { root: string; elsewhere: readonly [before: string, after: string] };
}

/** The notice as terminal output: dim when informational, yellow when a warning. */
function renderNotice(notice: TerminalNotice): string {
  const style = notice.tone === "warning" ? "\x1b[33m" : "\x1b[2m";
  return `${style}${notice.text}\x1b[0m\r\n`;
}

/** The notice as the shell prints it at its first prompt, for one that names its target. */
function shellNotice(notice: TerminalNotice | null): ShellNotice | null {
  if (notice?.target === undefined) return null;
  return { text: notice.text, root: notice.target.root, elsewhere: notice.target.elsewhere };
}

export interface TerminalSessionInfo {
  id: string;
  seq: number;
  name: string;
  cwd: string;
  ownerUserId: string;
  /** The conversation the shell belongs to, or null (see CreateTerminalSessionOptions.sessionId). */
  sessionId: string | null;
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

/**
 * Whether a variable of the server's own environment is the user's to inherit. Not the
 * harness's: every `PENGUIN_*` is this installation's own wiring (its data root, its CLI entry,
 * the desktop shell's token) or context the server process inherited from whoever started it —
 * a server started by an Agent command of ANOTHER harness carries that harness's
 * `PENGUIN_API_URL`, token and Session id — and `PORT` / `HOST` are this server's listener.
 * None of it describes the user's shell, and all of it misdirects what runs there: `penguin`
 * would talk to whatever server those name, and `pnpm dev` or `npm run dev` would take this
 * server's data root and port over their own defaults. Core strips these from an Agent's
 * commands too (see its command session manager), matched the same case-insensitive way; it
 * also strips FORCE_COLOR and CLICOLOR_FORCE there, which a terminal, being a real one, keeps.
 *
 * The user's startup files still set any of them they export, and `penguin` needs none of
 * them: the shim names this server's data root itself (services/cli-shim.ts). Where no shim
 * does, `keepDataRoot` keeps `PENGUIN_HOME` and `PENGUIN_WEB_DB`, as every terminal had them
 * before (see CreateTerminalSessionOptions.inheritDataRoot). The user's own settings among
 * them stay as well ({@link USER_SETTINGS}).
 */
function inheritedByTerminal(key: string, keepDataRoot: boolean): boolean {
  const name = key.toUpperCase();
  if (keepDataRoot && (name === "PENGUIN_HOME" || name === "PENGUIN_WEB_DB")) return true;
  if (USER_SETTINGS.has(name)) return true;
  return !(name.startsWith("PENGUIN_") || name === "PORT" || name === "HOST");
}

/**
 * The `PENGUIN_*` variables that are the user's own settings rather than any instance's wiring:
 * how PenguinHarness should behave for this person wherever it runs. None names a data root, a
 * server, a session or the code that runs, so none can point what runs in the terminal at the
 * wrong instance. They stay in the terminal because they are not always set by a startup file
 * the shell reads again: on Windows a user variable set with `setx` (what `penguin config lang`
 * itself suggests there) reaches the desktop app, and from it the terminal, by inheritance only.
 */
const USER_SETTINGS = new Set([
  // The CLI's language.
  "PENGUIN_LANG",
  // `off`: no automatic release check.
  "PENGUIN_UPDATE_CHECK",
  // The desktop app does not import the login shell's environment.
  "PENGUIN_NO_LOGIN_SHELL_ENV",
  // The shell Agent commands run in.
  "PENGUIN_SHELL",
  // Where the installer and `penguin update` put a tarball install, and where they download from.
  "PENGUIN_INSTALL_DIR",
  "PENGUIN_DOWNLOAD_SOURCE",
  "PENGUIN_DOWNLOAD_SPEED_PROBE",
  "PENGUIN_DOWNLOAD_BASE_URL",
  "PENGUIN_DOWNLOAD_FALLBACK_BASE_URL",
  // The same choice for the desktop app's updater.
  "PENGUIN_UPDATE_SOURCE",
  "PENGUIN_UPDATE_SPEED_PROBE",
  // The Penguin Go provider's key and endpoint, as OPENAI_API_KEY is OpenAI's (which stays too).
  "PENGUIN_GO_API_KEY",
  "PENGUIN_GO_BASE_URL",
]);

/**
 * Environment for the pty. `TERM`/`COLORTERM` are what make colour and 256-colour output
 * work at all; the rest of the parent environment is inherited so the shell behaves like the
 * user's own (PATH, proxies, language) — less the harness's own variables (inheritedByTerminal).
 */
function buildTerminalEnv(
  extra: Record<string, string> | undefined,
  cwd: string,
  keepDataRoot: boolean,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string" && inheritedByTerminal(key, keepDataRoot)) env[key] = value;
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
  /** The conversation this shell belongs to; changes only when that conversation's id does. */
  private owningSession: string | null;
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
    this.owningSession = options.sessionId ?? null;
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

    const shell = options.shell ?? defaultTerminalShell();
    const notice = options.notice ?? null;
    const pathFirst = options.pathFirst ?? null;
    const launch = shellLaunch(
      shell,
      buildTerminalEnv(options.env, options.cwd, options.inheritDataRoot === true),
      pathFirst === null ? null : { ...pathFirst, notice: shellNotice(notice) },
    );
    // Loaded first, so the repair below reaches the copy that will spawn — which on a
    // machine running a pushed platform is the installed program's (pty-module.ts).
    const pty = loadNodePty(options.assets);
    // Before the shell's first byte, into the emulator every viewer restores from: the notice
    // is the screen's first line, and no client can attach before it is there — unless the shell
    // prints it itself, at its first prompt.
    if (notice !== null && !launch.printsNotice) this.terminal.write(renderNotice(notice));
    // Before the first spawn on macOS: node-pty's prebuilt spawn-helper ships without an
    // exec bit, and posix_spawnp refuses it (see spawn-helper.ts).
    ensureSpawnHelperExecutable(loadedNodePtyDir());
    this.ptyProcess = pty.spawn(shell, launch.args, {
      name: "xterm-256color",
      cols,
      rows,
      cwd: options.cwd,
      env: launch.env,
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
      sessionId: this.owningSession,
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

  /** Files the shell under another conversation — the same one, once its id has self-healed. */
  setSession(sessionId: string | null): void {
    this.owningSession = sessionId;
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
