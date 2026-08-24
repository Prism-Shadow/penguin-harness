/**
 * Agent-run handoff across a REAL platform swap (kernel upgrade over the full App): a
 * running Task is neither aborted nor restarted. Its HmrAgent rides the resource registry
 * (the `hmr-agents:table` shared map), the successor App adopts it at the next turn
 * boundary and takes that turn on the SAME Session, and only the run after it reloads
 * through the successor's loader. The manager-level coverage lives in
 * session-manager.test.ts; this file pins the platform wiring — the table's registry
 * entry, quiesce in the dispose effect, and adoption in the successor's create().
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

/** One stepped fake per LOAD, so the test can tell "same run carried on" from "reloaded". */
function steppedLoader(states: SteppedState[]): {
  load: (row: { sessionId: string }) => Promise<RuntimeSession>;
} {
  return {
    load: async (row) => {
      const state: SteppedState = {
        finish: false,
        began: [],
        steps: 0,
        ended: 0,
        disposed: 0,
        aborted: false,
      };
      states.push(state);
      let signal: AbortSignal | null = null;
      return {
        sessionId: row.sessionId,
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
      } satisfies RuntimeSession;
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

  it("the successor App adopts the running Task and takes its next turn", async () => {
    const states: SteppedState[] = [];
    // The overrides loader is registry-published, so BOTH generations use it.
    t = await createTestApp({ loader: steppedLoader(states) });
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
    await waitFor(() => states[0]!.steps >= 1);

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

    // The same run carries on under the successor: no reload, no second begin, no abort.
    const stepsAtSwap = states[0]!.steps;
    await waitFor(() => states[0]!.steps > stepsAtSwap + 1);
    expect(states).toHaveLength(1);
    expect(states[0]!.began).toHaveLength(1);
    expect(states[0]!.ended).toBe(0);
    expect(states[0]!.aborted).toBe(false);
    expect(nextManager.statusOf("s-handoff")).toBe("running");

    // It ends under the successor, which closes it — and only the NEXT run reloads,
    // because the Session itself is the previous generation's code.
    states[0]!.finish = true;
    await waitFor(() => nextManager.statusOf("s-handoff") === "idle");
    expect(states[0]!.ended).toBe(1);
    await nextManager.startTask("s-handoff", [userText("after the swap")]);
    await waitFor(() => states.length === 2);
    expect(states[0]!.disposed).toBe(1);
    expect(nextManager.abortTask("s-handoff")).toBe(true);
    await waitFor(() => nextManager.statusOf("s-handoff") === "idle");
  });
});
