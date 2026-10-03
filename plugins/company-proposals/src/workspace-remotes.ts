/**
 * The shared workspace's git remotes, for the PR graph's fallback when no delivery repository
 * is set (config.ts). The organization runs on the server that holds its workspace, so the
 * workspace is a local directory; `git remote -v` is the one read, and nothing is written.
 */
import { execFile } from "node:child_process";

/** Runs `git` with these arguments in `cwd` and answers its stdout; rejects when it cannot run or fails. */
export type RunGit = (cwd: string, args: readonly string[]) => Promise<string>;

const TIMEOUT_MS = 5_000;
const MAX_OUTPUT_BYTES = 64 * 1024;

/** The `git` on the PATH, started as an argument vector (no shell). */
export function gitRunner(command = "git"): RunGit {
  return (cwd, args) =>
    new Promise((resolve, reject) => {
      execFile(
        command,
        ["-C", cwd, ...args],
        {
          timeout: TIMEOUT_MS,
          maxBuffer: MAX_OUTPUT_BYTES,
          windowsHide: true,
          env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
        },
        (err, stdout, stderr) => {
          if (err === null) {
            resolve(stdout);
            return;
          }
          const lastLine = stderr.trim().split(/\r?\n/).at(-1) ?? "";
          reject(
            new Error(
              err.code === "ENOENT"
                ? `${command} not found`
                : lastLine !== ""
                  ? lastLine
                  : err.message,
            ),
          );
        },
      );
    });
}
