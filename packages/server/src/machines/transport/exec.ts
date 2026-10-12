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

/**
 * How the child is started beyond its argv (login.ts): its own environment — the one place a
 * password travels — and, for an OpenSSH that asks a terminal first, a session of its own with no
 * terminal in it.
 */
export interface ChildLaunch {
  env?: NodeJS.ProcessEnv;
  detached?: boolean;
}

export function run(
  file: string,
  args: string[],
  opts: { timeoutMs?: number } & ChildLaunch = {},
): Promise<ExecResult> {
  // execFile does not pass `detached` on to the child; a detached run is a spawn with nothing on
  // its stdin, which is what a command without input reads anyway.
  if (opts.detached === true) {
    return runWithInput(file, args, { ...opts, input: Buffer.alloc(0) });
  }
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      {
        timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxBuffer: 16 * 1024 * 1024,
        ...(opts.env === undefined ? {} : { env: opts.env }),
      },
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
  opts: { input: Buffer; onLine?: (line: string) => void; timeoutMs?: number } & ChildLaunch,
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = spawn(file, args, {
      stdio: ["pipe", "pipe", "pipe"],
      ...(opts.env === undefined ? {} : { env: opts.env }),
      ...(opts.detached === true ? { detached: true } : {}),
    });
    let stdout = "";
    let stderr = "";
    let pending = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    // Decoding is the stream's, not each chunk's: a multibyte character whose bytes land in
    // two `data` events would otherwise become two replacement characters. This path carries
    // the Windows installer's own output, which is where a localized far side puts non-ASCII.
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (text: string) => {
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
    child.stderr.on("data", (chunk: string) => (stderr += chunk));
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

/** What a failed ExecResult says, in the transport's words; `whenSilent` when it said nothing. */
export function execFailureText(result: ExecResult, whenSilent: string): string {
  if (result.timedOut) return "the machine did not answer in time";
  return result.stderr.trim() || whenSilent;
}
