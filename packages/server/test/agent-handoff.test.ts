/**
 * Agent-run handoff across a REAL platform swap (kernel upgrade over the full App):
 * a running Task is not aborted by the swap — its monitor rides the resource registry
 * (the `agent-sessions:table` shared map, see runtime/session-monitor.ts), the old
 * generation's drive parks at its next turn boundary (lame duck), and the monitor swaps
 * its code pointer to the successor at that boundary: the session reads busy until the
 * old drive settles, then the run is resumed on a freshly loaded Session with an empty
 * input (the real loader's session carries the parked turn back as Trace-replayed
 * carry-over). The manager-level unit coverage lives in session-manager.test.ts; this
 * file pins the platform wiring — quiesce in the dispose effect, the table's registry
 * entry, and adoption in the successor's create().
 */
import { afterEach, describe, expect, it } from "vitest";
import { upgrade } from "@prismshadow/penguin-core/kernel";
import { userText } from "@prismshadow/penguin-core";
import type { ApproveFn, OmniMessage } from "@prismshadow/penguin-core";
import { packagedPlatform } from "../src/hmr/platform.js";
import type { PlatformApi } from "../src/hmr/platform.js";
import type { Instance } from "@prismshadow/penguin-core/kernel";
import type { RuntimeSession } from "../src/runtime/session-manager.js";
import { createTestApp, waitFor } from "./helpers.js";
import type { TestApp } from "./helpers.js";

/** A fake long run with turn boundaries: yields once, then polls shouldPark/abort between "turns". */
function parkableFakeSession(
  sessionId: string,
  state: { parked: boolean; aborted: boolean; ranInputs: OmniMessage[][] },
): RuntimeSession {
  return {
    sessionId,
    toolPermission: () => "rw",
    generateTitle: async () => ({ title: null, usage: null }),
    compactability: () => "ok" as const,
    steer: () => false,
    skipReconnectWait: () => false,
    async *run(
      input: OmniMessage[],
      opts: { approve: ApproveFn; signal: AbortSignal; shouldPark?: () => boolean },
    ) {
      state.ranInputs.push(input);
      yield userText("[fake] turn-1");
      for (;;) {
        if (opts.signal.aborted) {
          state.aborted = true;
          return;
        }
        if (opts.shouldPark?.() ?? false) {
          state.parked = true;
          return;
        }
        await new Promise((r) => setTimeout(r, 5));
      }
    },
    async *compact() {
      // Nothing to do in this fake.
    },
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

  it("a running Task parks, rides the registry, and resumes under the successor App", async () => {
    const lameState = { parked: false, aborted: false, ranInputs: [] as OmniMessage[][] };
    const resumedState = { parked: false, aborted: false, ranInputs: [] as OmniMessage[][] };
    const loads: string[] = [];
    // The overrides loader is registry-published, so BOTH generations' buildAppDeps use
    // it: the first load backs the original run, later loads the resumed Session.
    t = await createTestApp({
      loader: {
        load: async (row) => {
          loads.push(row.sessionId);
          return parkableFakeSession(row.sessionId, loads.length === 1 ? lameState : resumedState);
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
    await waitFor(() => t!.deps.manager.statusOf("s-handoff") === "running");

    // The real swap: park → dispose (quiesce registers the handoff) → drained → boot
    // (the successor's create adopts it).
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

    // The old drive parked at its boundary (not aborted), and the successor resumed the
    // run: a fresh Session loaded through the loader, relaunched with an EMPTY input.
    await waitFor(() => resumedState.ranInputs.length === 1);
    expect(lameState.parked).toBe(true);
    expect(lameState.aborted).toBe(false);
    expect(resumedState.ranInputs[0]).toEqual([]);
    expect(loads).toEqual(["s-handoff", "s-handoff"]);
    expect(nextManager.statusOf("s-handoff")).toBe("running");

    // The resumed run belongs to the successor: its interrupt endpoint controls it.
    expect(nextManager.abortTask("s-handoff")).toBe(true);
    await waitFor(() => nextManager.statusOf("s-handoff") === "idle");
    expect(resumedState.aborted).toBe(true);
  });
});
