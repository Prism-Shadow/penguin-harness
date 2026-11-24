/**
 * The server's Agent State suite (packages/server/test/helpers/agent-state-repo-scenarios.ts),
 * run with this plugin's engine instead of the built-in one: every scenario the harness holds
 * its repository to — first commit, no-op loads, edits, history caps, removals, refused names,
 * untrustworthy refs, who a version is by — and, last, the same commits as the built-in engine,
 * object for object.
 *
 * Live: it needs this host's Git (test/global-setup.ts); without it the suite skips, unless
 * PENGUIN_MUST_RUN names agent-state-dugite.
 */
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentStateEngine } from "@prismshadow/penguin-core/plugin";
import { liveGit } from "./live-git.js";

const live = await liveGit();

const { agentStateRepoScenarios } = (await import(
  fileURLToPath(
    new URL("../../../packages/server/test/helpers/agent-state-repo-scenarios.ts", import.meta.url),
  )
)) as {
  agentStateRepoScenarios: (
    t: { afterEach: unknown; beforeEach: unknown; describe: unknown; expect: unknown; it: unknown },
    scenario: { label: string; engine: () => AgentStateEngine | undefined },
  ) => void;
};

if (live !== null) {
  agentStateRepoScenarios(
    { afterEach, beforeEach, describe, expect, it },
    { label: live.engine.name, engine: () => live.engine },
  );
} else {
  describe.skip("the Agent State repository with native Git: no Git on this host", () => {
    it("runs where this host has Git", () => {});
  });
}
