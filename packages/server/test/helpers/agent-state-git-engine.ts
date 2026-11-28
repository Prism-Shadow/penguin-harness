/**
 * A real `GitEngine` for the server's own Agent State suites: the pure-plumbing Git CLI engine
 * over this host's `git` program. Null when the host has no `git`, and suites that need an engine skip.
 */
import type { GitEngine } from "@prismshadow/penguin-core/plugin";
import { gitclGitEngine, probeGit } from "@penguinharness/agent-state-gitcl";

let engine: Promise<GitEngine | null> | undefined;

export function gitEngineForTests(): Promise<GitEngine | null> {
  engine ??= (async () => {
    const found = await probeGit();
    if (found === null) return null;
    return gitclGitEngine(found.git, found.version);
  })();
  return engine;
}
