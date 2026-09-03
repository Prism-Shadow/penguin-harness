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
import { execFile, spawn } from "node:child_process";

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
  /**
   * True when we killed it for running past its budget. Worth its own flag because a
   * timeout is otherwise INDISTINGUISHABLE from a refusal: the child is killed before it
   * says anything, so the result is a non-zero code with empty stderr — which reads as
   * "the remote said no" when the truth is "the remote never answered in time".
   */
  timedOut: boolean;
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
        // execFile signals a timeout by killing the child: `killed` is set and there is no
        // numeric exit code of its own.
        const killed = (error as (Error & { killed?: boolean }) | null)?.killed === true;
        resolve({
          code,
          stdout: String(stdout),
          stderr: String(stderr),
          timedOut: killed && error !== null,
        });
      },
    );
  });
}

/**
 * Runs one command with `input` on its stdin, reporting each line of output as it arrives.
 *
 * This is how the ordinary installer reaches a POSIX remote: `ssh host 'sh -s'` with
 * install.sh piped in, which is the same shape as the documented `curl … | sh` and saves the
 * scratch directory, the scp and the cleanup a copied file would need — three ssh handshakes,
 * each of which can cost tens of seconds.
 *
 * `onLine` exists because an install takes minutes: buffering until exit would show the far
 * side's own progress only once it no longer matters. Lines are split on the way through, so
 * a partial chunk never surfaces as a line of its own.
 */
export function runWithInput(
  file: string,
  args: string[],
  opts: { input: Buffer; onLine?: (line: string) => void; timeoutMs?: number },
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = spawn(file, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let pending = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stdout += text;
      if (opts.onLine === undefined) return;
      pending += text;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trimEnd();
        if (trimmed !== "") opts.onLine(trimmed);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    child.on("close", (code) => {
      clearTimeout(timer);
      // Whatever the last chunk left without a newline is still a line the far side wrote.
      if (pending.trim() !== "") opts.onLine?.(pending.trim());
      resolve({ code: code ?? 1, stdout, stderr, timedOut });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: 1, stdout, stderr: `${stderr}${err.message}\n`, timedOut });
    });
    // A remote that never reads stdin (a refused connection) closes the pipe under us.
    child.stdin.on("error", () => {});
    child.stdin.end(opts.input);
  });
}

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

/** True when the failure is "ssh could not authenticate without asking" — the BatchMode wall. */
export function looksLikeAuthFailure(result: ExecResult): boolean {
  return /permission denied|no supported authentication|host key verification failed/i.test(
    result.stderr,
  );
}
