/**
 * The local side of reaching a machine: a helper's output as bytes (a tarball to hand over),
 * and what a failed command says. Starting a machine's own program — ssh, wsl.exe, a
 * container CLI — is its kind's (mechanisms/machines.ts); nothing here names one.
 *
 * No shell: argv goes straight to execFile, so nothing on this side interprets quotes,
 * spaces or `$`.
 *
 * Failures are returned, never thrown, and carry the far side's own stderr verbatim — a wrong
 * key, a host-key mismatch or a refused connection is the user's to read, and rewording
 * those diagnostics into our own vocabulary would only lose detail.
 */
import { execFile } from "node:child_process";
import type { ExecResult } from "../../mechanisms/machines.js";

export type { ExecResult } from "../../mechanisms/machines.js";

/** Enough for a payload transfer over a slow link, short enough to not hang a menu forever. */
const DEFAULT_TIMEOUT_MS = 10 * 60_000;

/** A local helper's stdout as bytes — a tarball to hand to a machine as a heredoc. */
export function runBytes(
  file: string,
  args: string[],
): Promise<{ code: number; stdout: Buffer; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { encoding: "buffer", timeout: DEFAULT_TIMEOUT_MS, maxBuffer: 256 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const code =
          error && typeof (error as NodeJS.ErrnoException & { code?: number }).code === "number"
            ? ((error as NodeJS.ErrnoException & { code: number }).code as number)
            : error
              ? 1
              : 0;
        resolve({ code, stdout: Buffer.from(stdout), stderr: String(stderr) });
      },
    );
  });
}

/** What a failed ExecResult says, in the transport's words; `whenSilent` when it said nothing. */
export function execFailureText(result: ExecResult, whenSilent: string): string {
  if (result.timedOut) return "the machine did not answer in time";
  return result.stderr.trim() || whenSilent;
}
