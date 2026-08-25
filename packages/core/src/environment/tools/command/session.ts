/**
 * ManagedSession — runtime state and collection logic for a single command session.
 *
 * Spawns the process with `bash -lc <cmd>` (on Windows, the shell picked by `sessionShell()`
 * — see shell.ts), with stdout/stderr going through plain pipes (no
 * native dependency, clean output; an interactive program that detects no TTY falls back to
 * non-interactive mode, which parses more cleanly for the Agent anyway). `detached` makes the
 * child process the process-group leader, so both Ctrl-C and killing the whole group rely on
 * **process-group signals** (sending a signal to `-pid` also reaches background child processes).
 * Windows has neither process groups nor real signals: every "signal" degrades to a hard
 * TerminateProcess, and tree-wide cleanup goes through `taskkill /t` instead (see signalGroup).
 *
 * Key semantics:
 * - **Termination is determined by the foreground process exiting (the exit event, waitpid
 *   semantics), not by waiting for stream EOF**: background child processes that inherit the
 *   pipe don't hold things up;
 * - `collect(yieldMs)` **streams** output deltas within the budget: data is yielded as soon as it
 *   arrives, without waiting for the window to end; if the command exits mid-window, the trailing
 *   output is yielded along with it (with a capped drain window); if it's still running once the
 *   window expires, whatever output exists is yielded and collection ends, with the process
 *   switching to background; if `signal` aborts, whatever output exists is yielded and collection
 *   ends immediately;
 * - Unread output has a cap (memory safety); when exceeded, the oldest part is dropped and
 *   counted, with a marker shown on read;
 * - `kill()` sends SIGTERM to the process group, then SIGKILL after a grace period, reaping any
 *   leftover background child processes; idempotent.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import type { ToolResult } from "../types.js";
import { CappedTextBuffer, WakeSignal } from "../background/index.js";
import { sessionShell } from "./shell.js";
import { ServiceUrlScanner } from "./service-url.js";
import { probeGroupListenPorts } from "./port-probe.js";

/** Process-group semantics are available on POSIX; Windows falls back to signaling the child process directly. */
const SUPPORTS_PROCESS_GROUP = process.platform !== "win32";

/**
 * Extra wait cap (ms) after the command exits to collect trailing output: enough to drain the
 * last flush, without hanging.
 *
 * Windows gets a far larger budget. `exit` fires on process termination without waiting for
 * pipe EOF (see the listener below), so this window is the only thing standing between a
 * fast-exiting command and losing its output — and Git-Bash pipe delivery on Windows routinely
 * misses a 50ms window that POSIX pipes never come close to. Symptom when it is too tight: a
 * command that ran fine reports empty or truncated output, intermittently and under load. The
 * cost of the larger cap is bounded and only paid on Windows, and only when a command exits
 * with its pipe still draining: the loop breaks as soon as the buffer goes quiet.
 */
const POST_EXIT_DRAIN_MS = process.platform === "win32" ? 500 : 50;
/** Capacity cap (characters) for a single session's unread output: prevents a chatty background process from blowing up memory. */
const OUTPUT_BUFFER_CAP = 1024 * 1024; // 1 MiB
/**
 * Grace period (ms) before escalating from SIGTERM to SIGKILL: gives a process that needs to
 * clean up (flush data, remove temp files) some time. The timer is unref'd, so it won't hold up
 * the host process from exiting; the process-exit path sends SIGKILL directly as a fallback.
 */
const SIGKILL_GRACE_MS = 1_000;

/** Foreground process exit info. At most one of `code`/`signal` is set (consistent with Node child's exit event). */
export interface ProcessExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

/** Arguments required to start a command. */
export interface SpawnOptions {
  /** Command string handed to the session shell (`bash -lc` on POSIX; see shell.ts for Windows). */
  cmd: string;
  /** Working directory (absolute path). */
  cwd: string;
  /** Child process environment variables (the caller has already injected hardening entries like PAGER/TERM). */
  env: NodeJS.ProcessEnv;
}

export class ManagedSession {
  /** Timestamp of the last access (used for LRU / idle reaping). */
  lastUsed: number = Date.now();

  /** The command string as handed to the session shell (list display for the host UI). */
  readonly cmd: string;
  /** Working directory the command was spawned in. */
  readonly cwd: string;
  /** Spawn timestamp (epoch ms). */
  readonly startedAt: number = Date.now();

  private readonly child: ChildProcess;
  private readonly buffer = new CappedTextBuffer(OUTPUT_BUFFER_CAP, "earlier output");
  private exited = false;
  private exitInfo: ProcessExit | null = null;
  private spawnError: Error | null = null;
  private killed = false;
  private killTimer: ReturnType<typeof setTimeout> | null = null;
  // Single wake point: data arrival / process exit / spawn error all wake a waiting collect through it.
  private readonly wakeSignal = new WakeSignal();

  constructor(opts: SpawnOptions) {
    this.cmd = opts.cmd;
    this.cwd = opts.cwd;
    const shell = sessionShell();
    this.child = spawn(shell.command, [...shell.args, opts.cmd], {
      cwd: opts.cwd,
      env: opts.env,
      detached: SUPPORTS_PROCESS_GROUP, // Become the process-group leader, so the whole group can be signaled
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true, // No flashing console window on Windows (ignored elsewhere)
    });
    this.child.stdout?.setEncoding("utf8");
    this.child.stderr?.setEncoding("utf8");
    // stdin may already be closed by the command before input_command writes to it;
    // EPIPE/ERR_STREAM_DESTROYED are an expected race and must not bubble up to the host process
    // as an unhandled error.
    this.child.stdin?.on("error", () => {});
    this.child.stdout?.on("data", (c: string) => this.handleData(c));
    this.child.stderr?.on("data", (c: string) => this.handleData(c));
    // exit follows waitpid semantics: it fires as soon as bash exits, without waiting for
    // stdout/stderr pipe EOF — background child processes that inherit and hold the pipe open
    // won't hold up termination.
    this.child.on("exit", (code, signal) => this.handleExit({ code, signal }));
    this.child.on("error", (err) => this.handleError(err));
  }

  /**
   * Signals the process group; ignores the case where the process/group has already exited (ESRCH).
   *
   * Windows has no signals: `child.kill()` is an unconditional TerminateProcess of the direct
   * child only, which would orphan grandchildren (a `node server.js` started by the shell).
   * Every signal therefore becomes a hard kill of the whole tree via `taskkill /t /f` — including
   * SIGINT: without a shared console there is no way to deliver a real Ctrl-C to a piped child,
   * so input_command's Ctrl-C degrades to this hard kill on Windows. `sync` uses spawnSync for
   * the process-'exit' fallback, where the event loop is no longer running.
   */
  private signalGroup(sig: NodeJS.Signals, sync = false): void {
    try {
      if (SUPPORTS_PROCESS_GROUP && typeof this.child.pid === "number" && this.child.pid > 0) {
        process.kill(-this.child.pid, sig); // Negative pid = the whole process group
      } else if (
        process.platform === "win32" &&
        typeof this.child.pid === "number" &&
        this.child.pid > 0
      ) {
        this.killTreeWindows(this.child.pid, sync);
      } else {
        this.child.kill(sig);
      }
    } catch {
      // ESRCH etc., ignored.
    }
  }

  /** Hard-kills the whole process tree on Windows; falls back to child.kill() if taskkill itself fails. */
  private killTreeWindows(pid: number, sync: boolean): void {
    const args = ["/pid", String(pid), "/t", "/f"];
    if (sync) {
      const res = spawnSync("taskkill", args, { stdio: "ignore", windowsHide: true });
      if (res.error || res.status !== 0) this.child.kill();
      return;
    }
    try {
      const killer = spawn("taskkill", args, { stdio: "ignore", windowsHide: true });
      // taskkill missing or failing (e.g. restricted environment): still terminate the direct child.
      killer.on("error", () => this.child.kill());
      killer.on("exit", (code) => {
        if (code !== 0 && !this.exited) this.child.kill();
      });
    } catch {
      this.child.kill();
    }
  }

  private handleData(chunk: string): void {
    this.urlScanner.push(chunk);
    this.buffer.append(chunk);
    this.wakeSignal.notify();
  }
  private handleExit(exit: ProcessExit): void {
    if (this.exited) return;
    this.exited = true;
    this.exitInfo = exit;
    this.wakeSignal.notify();
    this.fireExitWatchers();
  }
  private handleError(err: Error): void {
    if (this.exited) return;
    this.spawnError = err;
    this.exited = true; // A spawn failure is also treated as a terminal state
    this.wakeSignal.notify();
    this.fireExitWatchers();
  }

  // One-shot exit watchers (run_in_background completion reports). Consumed on fire; a
  // watcher armed after exit fires on a microtask, so the caller never misses a fast command.
  private exitWatchers: Array<() => void> = [];
  private fireExitWatchers(): void {
    const watchers = this.exitWatchers;
    this.exitWatchers = [];
    for (const cb of watchers) cb();
  }

  /** Registers a one-shot callback for the foreground process's terminal state (exit or spawn failure); fires immediately (microtask) when already terminal. */
  onceExited(cb: () => void): void {
    if (this.exited) {
      queueMicrotask(cb);
      return;
    }
    this.exitWatchers.push(cb);
  }

  /** Clears armed exit watchers (a deliberate kill already reports its outcome synchronously, so the completion report is disarmed first). */
  clearExitWatchers(): void {
    this.exitWatchers = [];
  }

  /** Synchronously drains the yet-undelivered output (the same buffer `collect` serves) — used to build completion reports without an async window. */
  drainPending(): string {
    return this.buffer.drain();
  }

  // Service-URL detection, two sources with a fixed priority: the URL the process itself
  // printed (incremental output scan — carries a path, always fresher in meaning) wins over
  // the listen-port probe's synthesized origin (see port-probe.ts).
  private readonly urlScanner = new ServiceUrlScanner();
  private probedUrl: string | null = null;
  private probedAt = 0;
  private probeInFlight: Promise<void> | null = null;

  /** The session's detected service URL: the last one its output printed, else the probed listen-port origin; null when neither source has one. */
  get serviceUrl(): string | null {
    return this.urlScanner.url ?? this.probedUrl;
  }

  /**
   * Refreshes the listen-port probe when it could matter: only while running, only when the
   * output scan has no hit, at most once per TTL, one probe in flight. Multiple listening
   * ports collapse to the smallest — dev servers own one meaningful low port, while helper
   * processes open ephemeral high ones, and the choice stays stable across probes. A failed
   * probe ("don't know") keeps the previous result; a successful empty one clears it.
   */
  refreshServiceProbe(): Promise<void> {
    if (!this.running || this.urlScanner.url !== null || this.pid === null) {
      return Promise.resolve();
    }
    if (this.probeInFlight) return this.probeInFlight;
    if (Date.now() - this.probedAt < ManagedSession.PROBE_TTL_MS) return Promise.resolve();
    this.probeInFlight = probeGroupListenPorts(this.pid)
      .then((ports) => {
        this.probedAt = Date.now();
        if (ports === null) return;
        this.probedUrl = ports.length > 0 ? `http://localhost:${ports[0]}` : null;
      })
      .catch(() => undefined)
      .finally(() => {
        this.probeInFlight = null;
      });
    return this.probeInFlight;
  }

  /** Probe cache TTL (ms): a fraction of the process panel's poll interval, so each poll refreshes at most one probe per session. */
  private static readonly PROBE_TTL_MS = 5_000;

  /** Whether the command is still running (hasn't exited, spawn hasn't failed). */
  get running(): boolean {
    return !this.exited;
  }
  /**
   * Whether a stop was asked of this session (`kill`/`killHard`) — the host's stop button, a
   * capacity eviction, an idle reap. The exit that follows is a deliberate stop, never a
   * crash, and the background completion report says so instead of calling it a failure.
   */
  get stopRequested(): boolean {
    return this.killed;
  }
  /** OS pid of the shell leading the process group; null when the spawn itself failed. */
  get pid(): number | null {
    return typeof this.child.pid === "number" ? this.child.pid : null;
  }
  get exit(): ProcessExit | null {
    return this.exitInfo;
  }
  get error(): Error | null {
    return this.spawnError;
  }

  /**
   * Streams output deltas within `yieldMs` (data is yielded as soon as it arrives). Once done,
   * the terminal state is determined via `running`/`exit`/`error`:
   * - Exits mid-window -> the trailing output is yielded along with it (extra ≤POST_EXIT_DRAIN_MS drain);
   * - Still running once the window expires -> whatever output exists is yielded and collection ends, with the process switching to background;
   * - `signal` aborts -> whatever output exists is yielded and collection ends immediately (the process isn't killed; the caller decides whether to keep it).
   */
  async *collect(yieldMs: number, signal?: AbortSignal): AsyncGenerator<string> {
    const start = Date.now();
    const onAbort = (): void => this.wakeSignal.notify();
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      // Phase one: running, data is yielded as soon as it arrives, until exit / abort / yield expires.
      while (!this.exited) {
        const chunk = this.buffer.drain();
        if (chunk) yield chunk;
        if (signal?.aborted) return;
        const remaining = yieldMs - (Date.now() - start);
        if (remaining <= 0) {
          const tail = this.buffer.drain();
          if (tail) yield tail;
          return; // Still running -> yield
        }
        // Re-check the predicate before sleeping: data that arrives while `yield` is suspended
        // wakes at a point before this wait begins, and would otherwise be missed.
        if (!this.buffer.isEmpty) continue;
        await this.wakeSignal.wait(remaining);
      }
      // Phase two: already exited (or spawn failed) -> drain the trailing output, with a cap.
      const head = this.buffer.drain();
      if (head) yield head;
      const drainStart = Date.now();
      for (;;) {
        if (!this.buffer.isEmpty) {
          yield this.buffer.drain();
          continue;
        }
        const left = POST_EXIT_DRAIN_MS - (Date.now() - drainStart);
        if (left <= 0) break;
        await this.wakeSignal.wait(left);
        if (this.buffer.isEmpty) break; // Woke with no new data (or timed out) -> draining is done
      }
      const tail = this.buffer.drain();
      if (tail) yield tail;
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  }

  write(chars: string): void {
    this.lastUsed = Date.now();
    try {
      if (!this.child.stdin || this.child.stdin.destroyed) return;
      this.child.stdin.write(chars, () => {});
    } catch {
      // stdin may already be closed, ignored.
    }
  }
  /** Ctrl-C. POSIX: SIGINT to the process group; Windows: degrades to a hard tree kill (see signalGroup). */
  interrupt(): void {
    this.lastUsed = Date.now();
    this.signalGroup("SIGINT");
  }

  /** Closes out: sends SIGTERM to the process group, then SIGKILL after a grace period (reaping leftover background child processes); idempotent. */
  kill(): void {
    if (this.killed) return;
    this.killed = true;
    this.signalGroup("SIGTERM");
    // Unconditionally escalates to SIGKILL: the foreground has exited but background child
    // processes may still be around; killpg on an already-vanished group is ESRCH (harmless).
    this.killTimer = setTimeout(() => this.signalGroup("SIGKILL"), SIGKILL_GRACE_MS);
    this.killTimer.unref?.();
  }

  /** Synchronous hard kill (process 'exit' fallback: the event loop has already stopped at this point, so timers aren't available). */
  killHard(): void {
    this.killed = true;
    if (this.killTimer) {
      clearTimeout(this.killTimer);
      this.killTimer = null;
    }
    this.signalGroup("SIGKILL", true);
  }
}

/**
 * Signals that mean "stop", as opposed to "something broke": the harness's own SIGTERM, a
 * Ctrl-C from a terminal sharing the process group, a `pkill`, a supervisor shutting a dev
 * server down. Dying from one of these is somebody's decision, not a fault — SIGKILL and the
 * fault signals stay failures, so an OOM kill or a segfault still reads as one.
 */
const STOP_SIGNALS: ReadonlySet<string> = new Set(["SIGTERM", "SIGINT", "SIGHUP"]);

/** Whether an exit signal means the process was deliberately stopped (see STOP_SIGNALS). */
export function isStopSignal(signal: NodeJS.Signals | null | undefined): boolean {
  return signal != null && STOP_SIGNALS.has(signal);
}

/** Converts exit info into a tool result (the terminal marker is appended via `note`, outside the truncation, so it isn't lost with long output). */
export function resultForExit(exit: ProcessExit | null): ToolResult {
  if (!exit) return { stopReason: "completed" };
  if (exit.signal) return { stopReason: "fatal", note: `[terminated by signal ${exit.signal}]` };
  if (exit.code !== 0)
    return { stopReason: "fatal", note: `[exit code: ${exit.code ?? "unknown"}]` };
  return { stopReason: "completed" };
}
