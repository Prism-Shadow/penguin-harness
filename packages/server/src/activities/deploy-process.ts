/**
 * The programs a deploy runs besides git (npm, npx): started without a prompt, their output
 * streamed to the deploy's log as it arrives, bounded, stopped at a time limit or when the
 * engineer presses Stop — and with them everything they started.
 *
 * The spawn, time limit and tree kill follow `spawnModuleBuild` in `sandbox-build-runner.ts`,
 * whose `stopTree` and `clampLog` this reuses; what differs is that output is handed on line
 * by line and an abort signal stops the child.
 *
 * Tests replace the port with a fake; nothing here is reached by a test.
 */
import { spawn } from "node:child_process";
import { clampLog, stopTree } from "./sandbox-build-runner.js";

/** How long one program may run unless the caller says otherwise. */
export const PROCESS_TIMEOUT_MS = 20 * 60 * 1000;

/** How much of a program's output is kept for the failure it reports: the end. */
export const PROCESS_TAIL_MAX = 8 * 1024;

export interface DeployProcessOptions {
  cwd: string;
  timeoutMs?: number;
  /** Aborting it stops the program and everything it started. */
  signal?: AbortSignal;
  /** Each piece of output, as it arrives. */
  onOutput?: (text: string) => void;
}

export interface DeployProcessResult {
  /** The exit code; null when the program did not exit on its own. */
  code: number | null;
  /** The end of its output, both streams. */
  tail: string;
  error?: "not_found" | "timed_out" | "stopped" | "not_started";
}

/** Runs one program. Never throws. */
export interface DeployProcess {
  run(command: string, args: string[], options: DeployProcessOptions): Promise<DeployProcessResult>;
}

/** The real port. On Windows npm and npx are shell wrappers, so they go through the shell. */
export const spawnDeployProcess: DeployProcess = {
  run(command, args, options) {
    return new Promise((resolve) => {
      let tail = "";
      const keep = (text: string) => {
        tail = clampLog(tail + text, PROCESS_TAIL_MAX * 2);
        options.onOutput?.(text);
      };
      if (options.signal?.aborted) {
        resolve({ code: null, tail: "", error: "stopped" });
        return;
      }
      let child;
      try {
        child = spawn(command, args, {
          cwd: options.cwd,
          env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
          stdio: ["ignore", "pipe", "pipe"],
          shell: process.platform === "win32",
          windowsHide: true,
        });
      } catch {
        resolve({ code: null, tail: "", error: "not_started" });
        return;
      }
      child.stdout?.on("data", (chunk: Buffer) => keep(chunk.toString("utf8")));
      child.stderr?.on("data", (chunk: Buffer) => keep(chunk.toString("utf8")));
      let ended: "timed_out" | "stopped" | null = null;
      const stop = (why: "timed_out" | "stopped") => {
        if (ended) return;
        ended = why;
        stopTree(child);
      };
      const timer = setTimeout(() => stop("timed_out"), options.timeoutMs ?? PROCESS_TIMEOUT_MS);
      timer.unref();
      const onAbort = () => stop("stopped");
      options.signal?.addEventListener("abort", onAbort, { once: true });
      const done = (result: DeployProcessResult) => {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", onAbort);
        resolve({ ...result, tail: tail.slice(-PROCESS_TAIL_MAX) });
      };
      child.on("error", (error: NodeJS.ErrnoException) =>
        done({ code: null, tail, error: error.code === "ENOENT" ? "not_found" : "not_started" }),
      );
      child.on("close", (code) => {
        if (ended) done({ code: null, tail, error: ended });
        // A shell that cannot find the program says so with 127 (sh) or 9009 (cmd).
        else if (code === 127 || code === 9009) done({ code, tail, error: "not_found" });
        else done({ code, tail });
      });
    });
  },
};
