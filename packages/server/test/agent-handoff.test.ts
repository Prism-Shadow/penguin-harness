/**
 * Agent-run handoff across a REAL platform swap (kernel upgrade over the full App):
 * a running Task is not aborted by the swap — its HmrAgent rides the resource registry
 * (the `hmr-agents:table` shared map, see runtime/hmr-agent.ts), the old generation
 * suspends the run at its next turn boundary, and the successor finishes the remainder
 * from the (loader-reloaded) session with an empty input, with the status reading
 * `running` throughout. The manager-level unit coverage lives in
 * session-manager.test.ts; this file pins the platform wiring — the table's registry
 * entry and re-registration, quiesce in the dispose effect, and adoption in the
 * successor's create().
 */
import { afterEach, describe, expect, it } from "vitest";
import { upgrade } from "@prismshadow/penguin-core/kernel";
import { assistantText, userText } from "@prismshadow/penguin-core";
import type { OmniMessage } from "@prismshadow/penguin-core";
import { packagedPlatform } from "../src/hmr/platform.js";
import type { PlatformApi } from "../src/hmr/platform.js";
import type { Instance } from "@prismshadow/penguin-core/kernel";
import type { RuntimeSession } from "../src/runtime/session-manager.js";
import { createTestApp, waitFor } from "./helpers.js";
import type { TestApp } from "./helpers.js";

interface SteppedState {
  finish: boolean;
  began: OmniMessage[][];
  steps: number;
  ended: number;
  disposed: number;
  aborted: boolean;
}
const steppedState = (): SteppedState => ({
  finish: false,
  began: [],
  steps: 0,
  ended: 0,
  disposed: 0,
  aborted: false,
});

/** A fake with the stepped surface: each stepRun is one ~5ms "turn" (see session-manager.test.ts's twin). */
function steppedFakeSession(sessionId: string, state: SteppedState): RuntimeSession {
  let signal: AbortSignal | null = null;
  return {
    sessionId,
    toolPermission: () => "rw",
    generateTitle: async () => ({ title: null, usage: null }),
    compactability: () => "ok" as const,
    steer: () => false,
    skipReconnectWait: () => false,
    dispose: () => {
      state.disposed++;
    },
    endRun: () => {
      state.ended++;
    },
    async *run() {
      throw new Error("stepped fakes are driven through beginRun/stepRun");
    },
    async *beginRun(input: OmniMessage[], opts: { signal: AbortSignal }) {
      state.began.push(input);
      signal = opts.signal;
      yield assistantText("begun");
      return "continue" as const;
    },
    async *stepRun() {
      state.steps++;
      await new Promise((r) => setTimeout(r, 5));
      if (signal?.aborted) {
        state.aborted = true;
        return "done" as const;
      }
      if (state.finish) return "done" as const;
      yield assistantText(`turn-${state.steps}`);
      return "continue" as const;
    },
    async *compact(): AsyncGenerator<OmniMessage> {},
  };
}

describe("agent-run handoff across a platform swap", () => {
  let t: TestApp | null = null;
  let successor: Instance<PlatformApi> | null = null;

  afterEach(async () => {
    successor?.dispose();
    successor = null;
    await t?.cleanup();
    t = null;
  });

  it("a running Task rides the registry table, is suspended at a boundary, and finishes under the successor App", async () => {
    const lameState = steppedState();
    const resumedState = steppedState();
    const loads: string[] = [];
    // The overrides loader is registry-published, so BOTH generations' buildAppDeps use
    // it: the first load backs the original run, later loads the reloaded remainder.
    t = await createTestApp({
      loader: {
        load: async (row) => {
          loads.push(row.sessionId);
          return steppedFakeSession(row.sessionId, loads.length === 1 ? lameState : resumedState);
        },
      },
    });
    t.deps.sessionsRepo.insert({
      sessionId: "s-handoff",
      projectId: "p1",
      agentId: "a1",
      provider: "custom",
      modelId: "m1",
      workspace: "/tmp/w",
      approvalMode: "allow-all",
      title: null,
      createdAt: "2026-08-24T00:00:00.000Z",
      lastActiveAt: "2026-08-24T00:00:00.000Z",
    });

    await t.deps.manager.startTask("s-handoff", [userText("long job")]);
    await waitFor(() => lameState.steps >= 1);

    // The real swap: park → dispose (quiesce; the agents table is already registered) →
    // drained → boot (the successor's create claims the table and attaches itself).
    const current = await t.deps.hmr.ensure();
    const result = await upgrade({
      current,
      impl: packagedPlatform.impl,
      iface: packagedPlatform.iface,
      resources: t.deps.hmr.resources,
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    successor = result.instance as Instance<PlatformApi>;
    const nextManager = successor.api.business()!.manager;

    // The old run was suspended at a boundary (not aborted), its session disposed, and
    // the successor finished the remainder: a fresh session through the loader,
    // relaunched with an EMPTY input, never reading idle in between.
    await waitFor(() => resumedState.began.length === 1);
    expect(lameState.ended).toBe(1);
    expect(lameState.aborted).toBe(false);
    expect(lameState.disposed).toBe(1);
    expect(resumedState.began[0]).toEqual([]);
    expect(loads).toEqual(["s-handoff", "s-handoff"]);
    expect(nextManager.statusOf("s-handoff")).toBe("running");

    // The remainder belongs to the successor: its interrupt endpoint controls it.
    expect(nextManager.abortTask("s-handoff")).toBe(true);
    await waitFor(() => nextManager.statusOf("s-handoff") === "idle");
    expect(resumedState.aborted).toBe(true);
  });
});
