/**
 * git for deploys: the port every git call goes through, the real one that spawns `git`, and
 * the reads a deploy's readiness is made of.
 *
 * git authenticates with the host's own SSH keys; Penguin stores no git credential. So that
 * a missing key fails rather than waits on a prompt nobody sees, the child runs with
 * `GIT_TERMINAL_PROMPT=0` and SSH in batch mode. No shell, a time limit, bounded output.
 *
 * Tests replace the port with a fake; nothing here is reached by a test that talks to a real
 * remote.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { stopTree } from "./sandbox-build-runner.js";
import type { BranchState, CloneState } from "./deploy-types.js";

/** How long one git call may take unless the caller says otherwise. */
export const GIT_TIMEOUT_MS = 60_000;

/** How much of a git call's output is kept, per stream: the end, where errors are. */
export const GIT_OUTPUT_MAX = 64 * 1024;

export interface DeployGitResult {
  /** The exit code; null when git did not exit on its own (not started, or stopped). */
  code: number | null;
  stdout: string;
  stderr: string;
  /**
   * Why there is no exit code: git is not installed, it ran past its time limit, or the
   * caller's signal stopped it.
   */
  error?: "not_found" | "timed_out" | "not_started" | "stopped";
}

export interface DeployGitOptions {
  timeoutMs?: number;
  /** Stops git, and everything it started, as soon as it aborts. */
  signal?: AbortSignal;
  /** Added to the environment git runs in (never replaces the no-prompt settings). */
  env?: Record<string, string>;
}

/** Every git call a deploy makes. */
export interface DeployGit {
  run(args: string[], cwd: string, opts?: DeployGitOptions): Promise<DeployGitResult>;
}

/** The environment git runs in: never prompts, SSH in batch mode. */
export function gitEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...base,
    GIT_TERMINAL_PROMPT: "0",
    GIT_SSH_COMMAND: "ssh -o BatchMode=yes",
  };
}

function bounded(text: string): string {
  return text.length > GIT_OUTPUT_MAX ? text.slice(-GIT_OUTPUT_MAX) : text;
}

/** The real port: `git` on this server's PATH. Never throws. */
export const spawnGit: DeployGit = {
  run(args, cwd, opts = {}) {
    return new Promise((resolve) => {
      if (opts.signal?.aborted) {
        resolve({ code: null, stdout: "", stderr: "", error: "stopped" });
        return;
      }
      let stdout = "";
      let stderr = "";
      let child;
      try {
        child = spawn("git", args, {
          cwd,
          env: { ...process.env, ...opts.env, ...gitEnv({}) },
          stdio: ["ignore", "pipe", "pipe"],
          shell: false,
          windowsHide: true,
        });
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        resolve({
          code: null,
          stdout: "",
          stderr: (error as Error).message,
          error: code === "ENOENT" ? "not_found" : "not_started",
        });
        return;
      }
      child.stdout?.on("data", (chunk: Buffer) => (stdout = bounded(stdout + chunk.toString())));
      child.stderr?.on("data", (chunk: Buffer) => (stderr = bounded(stderr + chunk.toString())));
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        stopTree(child);
      }, opts.timeoutMs ?? GIT_TIMEOUT_MS);
      timer.unref();
      let stopped = false;
      const onAbort = () => {
        stopped = true;
        stopTree(child);
      };
      opts.signal?.addEventListener("abort", onAbort, { once: true });
      const settle = () => {
        clearTimeout(timer);
        opts.signal?.removeEventListener("abort", onAbort);
      };
      child.on("error", (error: NodeJS.ErrnoException) => {
        settle();
        resolve({
          code: null,
          stdout,
          stderr: error.message,
          error: error.code === "ENOENT" ? "not_found" : "not_started",
        });
      });
      child.on("close", (code) => {
        settle();
        if (stopped) resolve({ code: null, stdout, stderr, error: "stopped" });
        else if (timedOut) resolve({ code: null, stdout, stderr, error: "timed_out" });
        else resolve({ code, stdout, stderr });
      });
    });
  },
};

/** Whether git can be run at all. */
export async function gitAvailable(git: DeployGit, cwd: string): Promise<boolean> {
  const result = await git.run(["--version"], cwd, { timeoutMs: 10_000 });
  return result.code === 0;
}

/** A module folder's short name (`waf-module-abc` → `abc`), which its deploy branch is named from. */
export function moduleShortName(moduleFolder: string): string {
  const folder = moduleFolder.trim();
  for (const prefix of ["waf-module-", "wafmodule-"])
    if (folder.startsWith(prefix)) return folder.slice(prefix.length);
  return folder;
}

/** The module branch a deploy pushes, named as Loom named it so its branch is reused. */
export function deployBranchName(moduleFolder: string): string {
  return `loom/${moduleShortName(moduleFolder)}-deploy`;
}

/** The activity-data branch a deploy pushes, named as Loom named it so its branch is reused. */
export function activityDataBranchName(productCode: string): string {
  return `loom/${productCode}-activity-data`;
}

/**
 * The folder of the media repository an activity's media lives in. The repository is the
 * checkout's `media/` folder, so a manifest's `media/loom/<pc>/...` is `loom/<pc>/...` in it.
 */
export function mediaSparsePath(productCode: string): string {
  return `loom/${productCode}`;
}

/** A manifest's `media/...` path as a path inside the media repository; null for any other. */
export function mediaRepoPath(reference: string): string | null {
  return reference.startsWith("media/") && reference.length > "media/".length
    ? reference.slice("media/".length)
    : null;
}

/** The branch every deploy starts from. */
export const BASE_BRANCH = "main";

/**
 * A remote reduced to `host/owner/repo`, lower-cased and without `.git`, so the SSH and
 * https spellings of one repository compare equal. Null when it does not look like a remote.
 */
export function remoteKey(remote: string): string | null {
  const raw = remote.trim().replace(/^git\+/, "");
  if (raw === "") return null;
  const scp = /^[^@/\s]+@([^:/\s]+):(.+)$/.exec(raw);
  let host: string;
  let pathname: string;
  if (scp && !raw.includes("://")) {
    host = scp[1]!;
    pathname = scp[2]!;
  } else {
    try {
      const url = new URL(raw);
      host = url.host;
      pathname = url.pathname;
    } catch {
      return null;
    }
  }
  const tail = pathname
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/, "");
  if (!tail) return null;
  return `${host}/${tail}`.toLowerCase();
}

/** Whether two remotes name the same repository. */
export function sameRemote(a: string, b: string): boolean {
  const left = remoteKey(a);
  return left !== null && left === remoteKey(b);
}

/**
 * What a clone looks like: its branch, whether its working tree is clean, how far it is ahead
 * of its upstream, and whether origin is the expected remote. `present` is whether the clone
 * is on disk at all (the caller looks); nothing is asked of git when it is not.
 */
export async function cloneState(
  git: DeployGit,
  dir: string,
  expectedRemote: string | null,
  present: boolean,
): Promise<CloneState> {
  if (!present)
    return { present: false, branch: null, clean: null, ahead: null, remoteUrlMatches: null };
  const [head, status, ahead, origin] = await Promise.all([
    git.run(["rev-parse", "--abbrev-ref", "HEAD"], dir),
    git.run(["status", "--porcelain"], dir),
    git.run(["rev-list", "--count", "@{u}..HEAD"], dir),
    git.run(["remote", "get-url", "origin"], dir),
  ]);
  const branch = head.code === 0 ? head.stdout.trim() : "";
  const count = ahead.code === 0 ? Number.parseInt(ahead.stdout.trim(), 10) : Number.NaN;
  return {
    present: true,
    branch: branch && branch !== "HEAD" ? branch : null,
    clean: status.code === 0 ? status.stdout.trim() === "" : null,
    ahead: Number.isFinite(count) ? count : null,
    remoteUrlMatches:
      expectedRemote === null
        ? null
        : origin.code === 0 && sameRemote(origin.stdout, expectedRemote),
  };
}

/** Whether a branch exists in a clone; null when git could not say. */
export async function localBranchExists(
  git: DeployGit,
  dir: string,
  branch: string,
): Promise<boolean | null> {
  const result = await git.run(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], dir);
  if (result.code === 0) return true;
  if (result.code === 1) return false;
  return null;
}

/**
 * Whether a branch exists on the clone's origin. This reaches the remote, so it is asked
 * only when the engineer presses Check remote. Null when the remote could not be asked.
 */
export async function remoteBranchExists(
  git: DeployGit,
  dir: string,
  branch: string,
): Promise<boolean | null> {
  const result = await git.run(["ls-remote", "--heads", "origin", `refs/heads/${branch}`], dir, {
    timeoutMs: 30_000,
  });
  if (result.code !== 0) return null;
  return result.stdout.trim() !== "";
}

/**
 * Whether a media clone's checkout includes `sparse`: a sparse folder that is it or holds it,
 * or a clone that is not sparse at all (an existing checkout). Null when git could not say.
 */
export async function sparsePathPresent(
  git: DeployGit,
  dir: string,
  sparse: string,
): Promise<boolean | null> {
  const list = await git.run(["sparse-checkout", "list"], dir);
  if (list.code !== 0) return /not sparse/i.test(list.stderr) ? true : null;
  return list.stdout.split(/\r?\n/).some((line) => {
    const folder = line.trim().replace(/\/+$/, "");
    return folder !== "" && (sparse === folder || sparse.startsWith(`${folder}/`));
  });
}

/** Where a branch is, locally and (when asked) on the remote. */
export async function branchState(
  git: DeployGit,
  dir: string,
  present: boolean,
  branch: string,
  checkRemote: boolean,
): Promise<BranchState> {
  if (!present) return { local: null, remote: null };
  const [local, remote] = await Promise.all([
    localBranchExists(git, dir, branch),
    checkRemote ? remoteBranchExists(git, dir, branch) : Promise.resolve(null),
  ]);
  return { local, remote };
}

/** The clones a deploy works in: the WAF workspace's, laid out as a WAF checkout is. */
export interface DeployClonePaths {
  module: string;
  activityData: string;
  media: string;
}

export function deployClonePaths(wafRoot: string, moduleFolder: string): DeployClonePaths {
  return {
    module: path.join(wafRoot, "modules", moduleFolder),
    activityData: path.join(wafRoot, "waf-activity-data"),
    media: path.join(wafRoot, "media"),
  };
}
