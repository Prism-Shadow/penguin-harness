/**
 * One git run as an argument vector (no shell), for the mirror's commands that feed stdin or
 * must stop reading early (git-mirror.ts): input on stdin, output kept up to a cap — past it the
 * child is stopped and `cut` is true — and a deadline and an abort signal that stop it too.
 */
import { spawn } from "node:child_process";

export interface SpawnedGit {
  code: number;
  stdout: string;
  stderr: string;
  /** The output reached `maxBytes` and the child was stopped there; `stdout` is that much. */
  cut: boolean;
}

/** stderr kept for the error line: the tail of a failure, never a dump. */
const MAX_STDERR = 64 * 1024;

export function spawnGit(
  git: string,
  env: Record<string, string>,
  args: readonly string[],
  opts: { input?: string; timeoutMs: number; maxBytes: number; signal?: AbortSignal },
): Promise<SpawnedGit> {
  return new Promise((resolve, reject) => {
    const child = spawn(git, args, {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...env },
    });
    const out: Buffer[] = [];
    let size = 0;
    let stderr = "";
    let cut = false;
    let failure: Error | null = null;
    const stop = (err: Error | null) => {
      failure ??= err;
      child.kill();
    };
    const timer = setTimeout(
      () => stop(new Error(`git timed out after ${opts.timeoutMs} ms`)),
      opts.timeoutMs,
    );
    const onAbort = () => stop(new Error("aborted"));
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    const settle = () => {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
    };
    child.stdout.on("data", (chunk: Buffer) => {
      if (cut) return;
      if (size + chunk.length > opts.maxBytes) {
        out.push(chunk.subarray(0, opts.maxBytes - size));
        size = opts.maxBytes;
        cut = true;
        stop(null);
        return;
      }
      out.push(chunk);
      size += chunk.length;
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < MAX_STDERR) stderr += chunk;
    });
    child.stdin.on("error", () => {
      // The child may exit before reading all of its input; its exit code tells.
    });
    child.on("error", (err) => {
      settle();
      reject((err as NodeJS.ErrnoException).code === "ENOENT" ? new Error("git not found") : err);
    });
    child.on("close", (code) => {
      settle();
      if (failure !== null) {
        reject(failure);
        return;
      }
      const stdout = Buffer.concat(out).toString("utf8");
      // Stopped on purpose at the cap: what was read is the answer, not a failure.
      resolve({ code: cut ? 0 : (code ?? 1), stdout, stderr, cut });
    });
    child.stdin.end(opts.input ?? "");
  });
}
