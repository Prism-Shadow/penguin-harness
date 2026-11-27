/**
 * A real engine for the server's own Agent State suites: the native-Git plugin's engine over
 * this host's `git` program. (The plugin ships its own Git builds in production; a test host
 * has the one on PATH.) Null when the host has none, and a suite that needs an engine skips.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import which from "which";
import type { AgentStateEngine } from "@prismshadow/penguin-core/plugin";
import { gitEngine } from "@penguinharness/agent-state-git";

const run = promisify(execFile);

let engine: Promise<AgentStateEngine | null> | undefined;

export function gitEngineForTests(): Promise<AgentStateEngine | null> {
  engine ??= (async () => {
    const program = await which("git", { nothrow: true });
    if (program === null) return null;
    let version: string;
    let execPath: string;
    try {
      version =
        /^git version (\S+)/.exec(
          (await run(program, ["version"], { windowsHide: true })).stdout,
        )?.[1] ?? "git";
      execPath = (await run(program, ["--exec-path"], { windowsHide: true })).stdout.trim();
    } catch {
      return null;
    }
    return gitEngine({ program, execPath }, version, "system");
  })();
  return engine;
}
