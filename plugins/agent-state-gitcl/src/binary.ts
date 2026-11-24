/**
 * The Git this plugin runs: the Git command line this host already has — the same `git` a
 * person uses on this machine. There is nothing to name and nothing to download: this host has
 * a `git` on its `PATH`, or it has not, and the probe answers that once.
 *
 * Nothing is downloaded and nothing is kept: the host's Git finds its own exec path (the plugin
 * sets no `GIT_EXEC_PATH` for it). The probe runs `git version` once per process and remembers
 * the answer — a host whose `git` is not on the `PATH`, does not start, or is not Git, has no
 * Git — and the harness then records versions with its built-in engine, or with the next engine
 * a plugin offers (the agent-state-dugite plugin, which fetches a build of its own).
 */
import { spawn } from "node:child_process";
import { unavailable } from "./git.js";

/** The Git to run: the program the `PATH` resolves. */
export interface GitProgram {
  /** The bare name the `PATH` resolves. */
  program: string;
}

/** What the probe found: the Git, and the version it said it is. */
export interface FoundGit {
  git: GitProgram;
  version: string;
}

let remembered: Promise<FoundGit | null> | undefined;

/** `git version`'s answer, or why there is none. */
function runVersion(): Promise<FoundGit> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["version"], { windowsHide: true });
    let out = "";
    child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
    child.on("error", (err: NodeJS.ErrnoException) => reject(unavailable(err.code ?? err.message)));
    child.on("close", (code, signal) => {
      const version = /^git version (\S+)/.exec(out)?.[1];
      if (code === 0 && version !== undefined) resolve({ git: { program: "git" }, version });
      else reject(unavailable(signal !== null ? `killed by ${signal}` : `exit ${code}`));
    });
  });
}

/**
 * The host's Git and its version, probed once per process and remembered; null when this host
 * has no usable `git`. Every later call answers the same thing without another process.
 */
export function probeGit(): Promise<FoundGit | null> {
  remembered ??= runVersion().catch(() => null);
  return remembered;
}
