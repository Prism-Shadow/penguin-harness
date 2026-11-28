/**
 * Isolated Git plumbing process helpers.
 *
 * Strips ALL ambient `GIT_*` environment variables (case-insensitively on Windows), including
 * `GIT_CONFIG_COUNT` and `GIT_CONFIG_PARAMETERS`, then pins config flags so host settings,
 * hooks (including repo-local hooks), filters, and attributes never alter bytes.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { GitProgram } from "./binary.js";

const NULL_CONFIG = process.platform === "win32" ? "NUL" : "/dev/null";

/** Config flags pinned on every plumbing command so host settings never alter bytes. */
const ISOLATED_CONFIG_ARGS = [
  "--literal-pathspecs",
  "-c",
  "core.autocrlf=false",
  "-c",
  "core.safecrlf=false",
  "-c",
  "core.eol=lf",
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
    if (k.toUpperCase().startsWith("GIT_")) continue;
    env[k] = v;
  }
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.GIT_CONFIG_GLOBAL = NULL_CONFIG;
  env.GIT_ATTR_NOSYSTEM = "1";
  delete env.LANGUAGE;
  env.LC_ALL = "C";
  env.LANG = "C";
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
  return spawn(git.program, ["--git-dir", gitdir, ...ISOLATED_CONFIG_ARGS, ...args], {
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
