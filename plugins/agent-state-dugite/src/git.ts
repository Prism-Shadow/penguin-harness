/**
 * Running Git against an Agent State repository, and nothing else.
 *
 * Every process is told where the repository is (`--git-dir`) and given the exec path of the
 * build this plugin fetched — and nothing else is imposed: the environment goes through as it
 * is, so the Git behaves the way its configuration says. The steps the engine runs are plumbing
 * commands, which read no identity from config and run no hooks — who a commit is by arrives as
 * environment variables of that one process (./engine.ts).
 *
 * A process that could not start, or died on a signal, rejects with `engineUnavailable` (core's
 * `AgentStateEngineUnavailable`): the harness then does the step with its built-in engine. A
 * process that ran and exited non-zero rejects with what git said on stderr.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { GitProgram } from "./binary.js";

/** The environment every git process gets: the server's, plus the build's exec path. */
export function gitEnv(git: GitProgram): NodeJS.ProcessEnv {
  return { ...process.env, GIT_EXEC_PATH: git.execPath };
}

/** The arguments before the command: the repository every step addresses. */
export function gitArgs(gitdir: string): string[] {
  return ["--git-dir", gitdir];
}

/** An error for a process that could not run at all. */
export function unavailable(message: string): Error {
  return Object.assign(new Error(message), { engineUnavailable: true as const });
}

/** Starts git; the caller writes stdin and reads stdout. `extraEnv` joins the environment. */
export function start(
  git: GitProgram,
  gitdir: string,
  args: string[],
  extraEnv?: NodeJS.ProcessEnv,
): ChildProcessWithoutNullStreams {
  return spawn(git.program, [...gitArgs(gitdir), ...args], {
    env: { ...process.env, GIT_EXEC_PATH: git.execPath, ...extraEnv },
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

/**
 * The end of a process: its stdout when it exits 0 (unless the caller reads it itself). `input`
 * is written whole first, binary as it is; a process that closes its stdin early is not an error
 * here, its exit status says.
 */
export function finish(
  child: ChildProcessWithoutNullStreams,
  what: string,
  input?: Uint8Array,
  opts: { keepStdout?: boolean } = {},
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    if (opts.keepStdout !== false) child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (err: NodeJS.ErrnoException) =>
      reject(unavailable(`git ${what}: ${err.code ?? err.message}`)),
    );
    child.stdin.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code !== "EPIPE") reject(err);
    });
    child.on("close", (code, signal) => {
      if (signal !== null) reject(unavailable(`git ${what}: killed by ${signal}`));
      else if (code === 0) resolve(Buffer.concat(stdout));
      else {
        const said = Buffer.concat(stderr).toString().trim();
        reject(new Error(`git ${what}: ${said || `exit ${code}`}`));
      }
    });
    if (input !== undefined) child.stdin.end(input);
  });
}

/** Runs one git command to its end. */
export function runGit(
  git: GitProgram,
  gitdir: string,
  args: string[],
  input?: Uint8Array,
): Promise<Buffer> {
  return finish(start(git, gitdir, args), args[0] ?? "", input ?? new Uint8Array());
}
