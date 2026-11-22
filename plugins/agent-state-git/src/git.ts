/**
 * Running Git against an Agent State repository, and nothing else.
 *
 * Every process is told where the repository is (`--git-dir`) and is kept from anything that
 * could change what it does there: every `GIT_*` variable of the server's environment is
 * dropped (an ambient `GIT_DIR`, `GIT_OBJECT_DIRECTORY`, `GIT_INDEX_FILE`, `-c` values passed
 * down through `GIT_CONFIG_PARAMETERS`…), the system and global config are not read (who a
 * commit is by comes in the commit itself), hooks point at a file and so never run, replace
 * refs are ignored, and `safe.directory` admits the repository whoever owns its files. What it
 * writes is synced: objects and refs (`core.fsync`), the loose objects in one batch.
 *
 * A process that could not start, or died on a signal, rejects with `engineUnavailable` (core's
 * `AgentStateEngineUnavailable`): the harness then does the step with its built-in engine. A
 * process that ran and exited non-zero rejects with what git said on stderr.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import type { GitProgram } from "./binary.js";

/** git's own name for "no file": `/dev/null`, which Git for Windows maps to `nul`. */
const NO_CONFIG = "/dev/null";

/** The environment every git process gets: the server's, without a single `GIT_*` variable. */
export function gitEnv(git: GitProgram): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (!/^GIT_/i.test(name)) env[name] = value;
  }
  return {
    ...env,
    GIT_EXEC_PATH: git.execPath,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: NO_CONFIG,
    GIT_TERMINAL_PROMPT: "0",
  };
}

/** The arguments before the command: the repository, and the settings that hold for every write. */
export function gitArgs(gitdir: string): string[] {
  return [
    "--git-dir",
    gitdir,
    "--no-replace-objects",
    "-c",
    // HEAD is a file, so this "directory" can never hold a hook to run.
    `core.hooksPath=${path.join(gitdir, "HEAD")}`,
    "-c",
    "safe.directory=*",
    "-c",
    "core.fsync=objects,reference",
    "-c",
    "core.fsyncMethod=batch",
    "-c",
    "gc.auto=0",
  ];
}

/** An error for a process that could not run at all. */
export function unavailable(message: string): Error {
  return Object.assign(new Error(message), { engineUnavailable: true as const });
}

/** Starts git; the caller writes stdin and reads stdout. */
export function start(
  git: GitProgram,
  gitdir: string,
  args: string[],
): ChildProcessWithoutNullStreams {
  return spawn(git.program, [...gitArgs(gitdir), ...args], {
    env: gitEnv(git),
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
