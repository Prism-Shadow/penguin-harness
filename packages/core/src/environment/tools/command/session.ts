/**
 * ManagedSession — runtime state and collection logic for a single command session.
 *
 * Spawns the process with `bash -lc <cmd>`, with stdout/stderr going through plain pipes (no
 * native dependency, clean output; an interactive program that detects no TTY falls back to
 * non-interactive mode, which parses more cleanly for the Agent anyway). `detached` makes the
 * child process the process-group leader, so both Ctrl-C and killing the whole group rely on
 * **process-group signals** (sending a signal to `-pid` also reaches background child processes).
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
import { spawn, type ChildProcess } from "node:child_process";
import type { ToolResult } from "../types.js";
import { CappedTextBuffer, WakeSignal } from "../background/index.js";

/** Process-group semantics are available on POSIX; Windows falls back to signaling the child process directly. */
const SUPPORTS_PROCESS_GROUP = process.platform !== "win32";

/** Extra wait cap (ms) after the command exits to collect trailing output: enough to drain the last flush, without hanging. */
const POST_EXIT_DRAIN_MS = 50;
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
  /** Command string handed to `bash -lc`. */
  cmd: string;
  /** Working directory (absolute path). */
  cwd: string;
  /** Child process environment variables (the caller has already injected hardening entries like PAGER/TERM). */
  env: NodeJS.ProcessEnv;
}

export class ManagedSession {
  /** Timestamp of the last access (used for LRU / idle reaping). */
  lastUsed: number = Date.now();

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
    this.child = spawn("bash", ["-lc", opts.cmd], {
      cwd: opts.cwd,
      env: opts.env,
      detached: SUPPORTS_PROCESS_GROUP, // Become the process-group leader, so the whole group can be signaled
      stdio: ["pipe", "pipe", "pipe"],
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

  /** Signals the process group; ignores the case where the process/group has already exited (ESRCH). */
  private signalGroup(sig: NodeJS.Signals): void {
    try {
      if (SUPPORTS_PROCESS_GROUP && typeof this.child.pid === "number" && this.child.pid > 0) {
        process.kill(-this.child.pid, sig); // Negative pid = the whole process group
      } else {
        this.child.kill(sig);
      }
    } catch {
      // ESRCH etc., ignored.
    }
  }

  private handleData(chunk: string): void {
    this.buffer.append(chunk);
    this.wakeSignal.notify();
  }
  private handleExit(exit: ProcessExit): void {
    if (this.exited) return;
    this.exited = true;
    this.exitInfo = exit;
    this.wakeSignal.notify();
  }
  private handleError(err: Error): void {
    if (this.exited) return;
    this.spawnError = err;
    this.exited = true; // A spawn failure is also treated as a terminal state
    this.wakeSignal.notify();
  }

  /** Whether the command is still running (hasn't exited, spawn hasn't failed). */
  get running(): boolean {
    return !this.exited;
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
    this.signalGroup("SIGKILL");
  }
}

/** Converts exit info into a tool result (the terminal marker is appended via `note`, outside the truncation, so it isn't lost with long output). */
export function resultForExit(exit: ProcessExit | null): ToolResult {
  if (!exit) return { stopReason: "completed" };
  if (exit.signal) return { stopReason: "failed", note: `[terminated by signal ${exit.signal}]` };
  if (exit.code !== 0)
    return { stopReason: "failed", note: `[exit code: ${exit.code ?? "unknown"}]` };
  return { stopReason: "completed" };
}
