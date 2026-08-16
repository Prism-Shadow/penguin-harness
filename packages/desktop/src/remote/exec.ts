/**
 * Running ssh and scp — the only impure corner of the remote install. Everything the
 * commands say lives in commands.ts; this file just spawns them and reports what happened.
 *
 * No shell: argv goes straight to execFile, so nothing on this side interprets quotes,
 * spaces or `$`. The remote command string is the one place a shell is involved, and it is
 * quoted by commands.ts for exactly that reason.
 *
 * Failures are returned, never thrown, and carry ssh's own stderr verbatim — a wrong key, a
 * host-key mismatch or a refused connection is the user's to read, and rewording OpenSSH's
 * diagnostics into our own vocabulary would only lose detail.
 */
import { execFile } from "node:child_process";

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Enough for a payload transfer over a slow link, short enough to not hang a menu forever. */
const DEFAULT_TIMEOUT_MS = 10 * 60_000;

export function run(
  file: string,
  args: string[],
  opts: { timeoutMs?: number } = {},
): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const code =
          error && typeof (error as NodeJS.ErrnoException & { code?: number }).code === "number"
            ? ((error as NodeJS.ErrnoException & { code: number }).code as number)
            : error
              ? 1
              : 0;
        resolve({ code, stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

/** True when the failure is "ssh could not authenticate without asking" — the BatchMode wall. */
export function looksLikeAuthFailure(result: ExecResult): boolean {
  return /permission denied|no supported authentication|host key verification failed/i.test(
    result.stderr,
  );
}
