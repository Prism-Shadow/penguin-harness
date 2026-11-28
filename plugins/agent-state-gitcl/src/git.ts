/**
 * Isolated Git plumbing process helpers.
 *
 * - Strips ALL ambient `GIT_*` (and `LANGUAGE`) env vars case-insensitively.
 * - Pins `--literal-pathspecs`, `--no-replace-objects`, `core.protectNTFS=false` (bare index
 *   plumbing never writes to a worktree), `core.hooksPath=NULL`, `core.autocrlf=false`,
 *   `core.eol=lf`, `commit.gpgsign=false`, `LC_ALL=C`, `LANG=C`.
 * - Attaches `error` handlers to stdout, stderr, and stdin so stream errors always reject the
 *   active promise cleanly rather than becoming uncaught process exceptions.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { GitProgram } from "./binary.js";

const NULL_CONFIG = process.platform === "win32" ? "NUL" : "/dev/null";

const ISOLATED_CONFIG_ARGS = [
  "--literal-pathspecs",
  "--no-replace-objects",
  "-c",
  "core.autocrlf=false",
  "-c",
  "core.safecrlf=false",
  "-c",
  "core.eol=lf",
  "-c",
  "core.protectNTFS=false",
  "-c",
  `core.hooksPath=${NULL_CONFIG}`,
  "-c",
  "commit.gpgsign=false",
  "-c",
  "i18n.commitEncoding=utf-8",
  "-c",
  "gc.auto=0",
];

export function isolatedEnv(git: GitProgram, extraEnv?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    const upper = k.toUpperCase();
    if (upper.startsWith("GIT_") || upper === "LANGUAGE") continue;
    env[k] = v;
  }
  env.LC_ALL = "C";
  env.LANG = "C";
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.GIT_CONFIG_GLOBAL = NULL_CONFIG;
  env.GIT_ATTR_NOSYSTEM = "1";
  env.GIT_NO_REPLACE_OBJECTS = "1";
  env.GIT_TERMINAL_PROMPT = "0";
  if ("execPath" in git && typeof git.execPath === "string" && git.execPath !== "") {
    env.GIT_EXEC_PATH = git.execPath;
  }
  if ("templateDir" in git && typeof git.templateDir === "string" && git.templateDir !== "") {
    env.GIT_TEMPLATE_DIR = git.templateDir;
  }
  if ("env" in git && git.env && typeof git.env === "object") {
    Object.assign(env, git.env);
  }
  return extraEnv === undefined ? env : { ...env, ...extraEnv };
}

export function startGit(
  git: GitProgram,
  gitdir: string,
  args: string[],
  extraEnv?: NodeJS.ProcessEnv,
): ChildProcessWithoutNullStreams {
  const fullArgs = ["--git-dir", gitdir, ...ISOLATED_CONFIG_ARGS, ...args];
  return spawn(git.program, fullArgs, {
    env: isolatedEnv(git, extraEnv),
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
    let settled = false;
    let closed = false;
    let pendingErr: Error | null = null;
    const fail = (err: Error) => {
      if (pendingErr === null) pendingErr = err;
      try {
        child.stdin.destroy();
      } catch {
        // ignore
      }
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
      child.stdout.resume();
      child.stderr.resume();
      if (closed || child.pid === undefined) {
        if (settled) return;
        settled = true;
        reject(pendingErr);
      }
    };
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.stdout.on("error", fail);
    child.stderr.on("error", fail);
    child.on("error", fail);
    child.stdin.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code !== "EPIPE") fail(err);
    });
    child.on("close", (code, signal) => {
      closed = true;
      if (settled) return;
      settled = true;
      if (pendingErr !== null) {
        reject(pendingErr);
        return;
      }
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
