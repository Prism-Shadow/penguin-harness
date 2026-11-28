/**
 * Runs the server's complete AgentStateRepo behavioral scenario suite against BOTH
 * `gixGitEngine` (gitoxide) and `gitclGitEngine` (pure-plumbing host Git CLI).
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GitEngine } from "@prismshadow/penguin-core/plugin";
import { gitclGitEngine } from "@penguinharness/agent-state-gitcl";
import { tryLoadNative } from "../src/binary.js";
import { gixGitEngine } from "../src/git-engine.js";

const { agentStateRepoScenarios } = (await import(
  fileURLToPath(
    new URL("../../../packages/server/test/helpers/agent-state-repo-scenarios.ts", import.meta.url),
  )
)) as {
  agentStateRepoScenarios: (
    t: { afterEach: unknown; beforeEach: unknown; describe: unknown; expect: unknown; it: unknown },
    scenario: { label: string; engine: () => GitEngine },
  ) => void;
};

const native = tryLoadNative();
if (native !== null) {
  const gix = gixGitEngine(native, native.engineVersion());
  agentStateRepoScenarios(
    { afterEach, beforeEach, describe, expect, it },
    { label: gix.name, engine: () => gix },
  );
}

const gitVer = /^git version (\S+)/.exec(
  spawnSync("git", ["version"], { encoding: "utf8", windowsHide: true }).stdout ?? "",
)?.[1];

if (gitVer !== undefined) {
  const gitcl = gitclGitEngine({ program: "git" }, gitVer);
  agentStateRepoScenarios(
    { afterEach, beforeEach, describe, expect, it },
    { label: gitcl.name, engine: () => gitcl },
  );
}
