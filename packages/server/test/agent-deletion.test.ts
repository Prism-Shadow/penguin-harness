/**
 * Removing several Agents at once (services/agent-deletion.ts `removeAgents`), the step an
 * organization's delete takes for the employees it deletes. The session manager, the folder move
 * and the index tables are stand-ins at the service's own seams, so the runs can be held and the
 * clock advanced.
 *
 * - Given three Agents whose runs do not wind down, no folder is moved before the runs have had
 *   their wait, and all three are moved once one wait has passed — the wait is shared, not one
 *   per Agent.
 * - Given runs that end early, the folders are moved as soon as they have ended.
 * - Given one folder that cannot be moved, its refusal is reported, the others are removed, and
 *   every Agent is released from the deleting state.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentDeletionInfo } from "../src/api/types.js";
import { HttpError } from "../src/http/errors.js";
import { removeAgents } from "../src/services/agent-deletion.js";

const PROJECT = "olivia-default_project";
/** The one wait the module gives aborted runs, at most (its own constant is not exported). */
const ONE_WAIT_MS = 5000;

/** The seams `removeAgents` reaches, recording what happened to each Agent. */
function world(opts: { runEndsAfterMs?: number; busy?: string[] } = {}) {
  const moved: string[] = [];
  const deleting = new Set<string>();
  const ended: Array<() => void> = [];
  const manager = {
    beginAgentDeletion: (_projectId: string, agentId: string): Promise<void>[] => {
      deleting.add(agentId);
      // One active run per Agent, winding down when the test says (never, by default).
      return [
        new Promise<void>((resolve) => {
          if (opts.runEndsAfterMs !== undefined) setTimeout(resolve, opts.runEndsAfterMs);
          else ended.push(resolve);
        }),
      ];
    },
    endAgentDeletion: (_projectId: string, agentId: string) => {
      deleting.delete(agentId);
    },
  };
  const agentService = {
    deleteAgent: async (_projectId: string, agentId: string): Promise<AgentDeletionInfo> => {
      if (opts.busy?.includes(agentId)) {
        throw new HttpError(409, "agent_folder_busy", "The agent's folder could not be moved.");
      }
      moved.push(agentId);
      return { deletionId: `${agentId}-1`, agentId, phase: "counting", total: 0, removed: 0 };
    },
  };
  const rows = { deleteByAgent: () => {} };
  const deps = {
    manager,
    agentService,
    workbenches: { releaseAgent: async () => {} },
    drafts: rows,
    sessionsRepo: rows,
    traceIndex: { removeAgent: () => {} },
    schedulesRepo: rows,
    errorsRepo: rows,
    agentApi: rows,
  };
  return { deps, moved, deleting };
}

describe("removing several Agents at once", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("gives every Agent's runs one shared wait before the folders are moved", async () => {
    const { deps, moved, deleting } = world();
    const done = removeAgents(deps, PROJECT, ["a1", "a2", "a3"]);

    await vi.advanceTimersByTimeAsync(0);
    expect(moved).toEqual([]);
    expect([...deleting].sort()).toEqual(["a1", "a2", "a3"]);
    // One wait, not one per Agent: three in turn would need three of them.
    await vi.advanceTimersByTimeAsync(ONE_WAIT_MS);
    expect(moved).toEqual(["a1", "a2", "a3"]);

    const removals = await done;
    expect(removals.map((r) => ("deletion" in r ? r.agentId : "failed"))).toEqual([
      "a1",
      "a2",
      "a3",
    ]);
    expect(deleting.size).toBe(0);
  });

  it("moves the folders as soon as the runs have ended", async () => {
    const { deps, moved } = world({ runEndsAfterMs: 100 });
    const done = removeAgents(deps, PROJECT, ["a1", "a2"]);

    await vi.advanceTimersByTimeAsync(100);

    expect(moved).toEqual(["a1", "a2"]);
    await done;
  });

  it("reports a folder that cannot be moved, removes the rest, and releases every Agent", async () => {
    const { deps, moved, deleting } = world({ runEndsAfterMs: 0, busy: ["a2"] });
    const done = removeAgents(deps, PROJECT, ["a1", "a2", "a3"]);
    await vi.advanceTimersByTimeAsync(0);
    const removals = await done;

    expect(moved).toEqual(["a1", "a3"]);
    const failed = removals.find((r) => r.agentId === "a2");
    expect(failed !== undefined && "error" in failed && failed.error).toMatchObject({
      code: "agent_folder_busy",
    });
    expect(deleting.size).toBe(0);
  });
});
