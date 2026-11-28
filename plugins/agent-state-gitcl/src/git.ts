/**
 * Isolated Git plumbing process helpers: strips Git location env vars and disables host/system
 * `.gitconfig` so every object written is byte-identical across platforms and host configs.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { GitProgram } from "./binary.js";

const STRIP_ENV = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
];

const NULL_CONFIG = process.platform === "win32" ? "NUL" : "/dev/null";

/** Config flags pinned on every plumbing command so host settings never alter bytes. */
const ISOLATED_CONFIG_ARGS = [
  "-c",
  "core.autocrlf=false",
  "-c",
  "core.safecrlf=false",
  "-c",
  "commit.gpgsign=false",
  "-c",
  "i18n.commitEncoding=utf-8",
];

export function isolatedEnv(extraEnv?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of STRIP_ENV) delete env[name];
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.GIT_CONFIG_GLOBAL = NULL_CONFIG;
  env.GIT_TERMINAL_PROMPT = "0";
  return extraEnv === undefined ? env : { ...env, ...extraEnv };
}

export function startGit(
  git: GitProgram,
  gitdir: string,
  args: string[],
  extraEnv?: NodeJS.ProcessEnv,
): ChildProcessWithoutNullStreams {
  return spawn(git.program, ["--git-dir", gitdir, ...ISOLATED_CONFIG_ARGS, ...args], {
    env: isolatedEnv(extraEnv),
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

export function runGit(
  git: GitProgram,
  gitdir: string,
  args: string[],
  opts: { input?: Uint8Array; env?: NodeJS.ProcessEnv; allowNonZero?: boolean } = {},
): Promise<{ status: number; stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = startGit(git, gitdir, args, opts.env);
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (err) => reject(err));
    child.stdin.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code !== "EPIPE") reject(err);
    });
    child.on("close", (code, signal) => {
      if (signal !== null) {
        reject(new Error(`git ${args[0] ?? ""}: killed by ${signal}`));
        return;
      }
      const status = code ?? -1;
      const outBuf = Buffer.concat(stdout);
      const errText = Buffer.concat(stderr).toString("utf8").trim();
      if (status === 0 || opts.allowNonZero) {
        resolve({ status, stdout: outBuf, stderr: errText });
      } else {
        reject(new Error(`git ${args[0] ?? ""}: ${errText || `exit ${status}`}`));
      }
    });
    if (opts.input !== undefined) child.stdin.end(opts.input);
    else child.stdin.end();
  });
}
