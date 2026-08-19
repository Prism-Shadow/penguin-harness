/**
 * POST /api/sessions/:id/abort while a **compaction** is in flight.
 *
 * The composer's Stop button used to be gated on the Session being `running`, so a
 * compacting Session showed a disabled Send instead and a compaction could not be
 * interrupted from the Web App. The button was the whole of that bug — this file pins the
 * half underneath it, so a future change cannot quietly make the server the problem too:
 * the abort route does not care which non-idle state the Session is in, and the signal it
 * fires reaches the compaction (the runtime's `compact` generator sees it and finishes),
 * returning the Session to idle.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compactionBegin, compactionEnd } from "@prismshadow/penguin-core";
import type { OmniMessage } from "@prismshadow/penguin-core";
import type { SessionRow } from "../src/db/repos/sessions.js";
import type { RuntimeSession } from "../src/runtime/session-manager.js";
import { apiClient, createTestApp, provisionUser, waitFor } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const SID = "session-2026-08-19-10-00-00-aabb0003";

/** Records what the compaction saw of the abort signal. */
interface CompactionProbe {
  started: boolean;
  sawAbort: boolean;
  /** The terminal status the compaction settled on (mirrors core: an interrupted one ends `aborted`). */
  endStatus: string | null;
}

/**
 * Fake Session whose compaction parks until the signal fires — the shape of a real one, whose
 * compaction request is a full LLM round trip against the largest context of the session and
 * therefore the thing a user most wants to be able to stop.
 */
function compactingFakeSession(sessionId: string, probe: CompactionProbe): RuntimeSession {
  return {
    sessionId,
    toolPermission: () => "rw",
    generateTitle: async () => ({ title: null, usage: null }),
    compactability: () => "ok" as const,
    steer: () => false,
    skipReconnectWait: () => false,
    // eslint-disable-next-line require-yield
    async *run() {},
    async *compact(opts: { signal: AbortSignal }): AsyncGenerator<OmniMessage> {
      probe.started = true;
      yield compactionBegin({ reason: "manual", mode: "summarize", context: 1000, turns: 3 });
      await new Promise<void>((resolve) => {
        if (opts.signal.aborted) {
          resolve();
          return;
        }
        opts.signal.addEventListener("abort", () => resolve(), { once: true });
      });
      probe.sawAbort = opts.signal.aborted;
      // Core's own interrupted-compaction outcome: the pair closes `aborted`, the original
      // context is kept, and the half-written summary is discarded.
      probe.endStatus = "aborted";
      yield compactionEnd({ reason: "manual", mode: "summarize", status: "aborted" });
    },
  };
}

describe("abort during compaction", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;
  let probe: CompactionProbe;

  beforeEach(async () => {
    t = await createTestApp();
    const { cookie } = await provisionUser(t.app, "compactstopper");
    api = apiClient(t.app, cookie);
    const row: SessionRow = {
      sessionId: SID,
      projectId: "compactstopper-default_project",
      agentId: "default_agent",
      modelId: "m1",
      provider: "custom",
      workspace: "/tmp/w",
      approvalMode: "always-ask",
      title: null,
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    };
    t.deps.sessionsRepo.insert(row);
    probe = { started: false, sawAbort: false, endStatus: null };
    t.deps.manager.adopt(row, compactingFakeSession(SID, probe));
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("takes the abort while compacting: 202, the signal reaches the compaction, the Session goes idle", async () => {
    await t.deps.manager.startCompact(SID);
    await waitFor(() => probe.started && t.deps.manager.statusOf(SID) === "compacting");

    const res = await api.post(`/api/sessions/${SID}/abort`, {});
    // 202 = an interrupt was triggered (204 would mean "nothing in progress" — the answer
    // this route would give if it only recognized `running` as interruptible).
    expect(res.status).toBe(202);

    await waitFor(() => t.deps.manager.statusOf(SID) === "idle");
    expect(probe.sawAbort).toBe(true);
    // The interrupted compaction settles in the same well-defined state a crash-interrupted
    // one does: aborted, with the original context kept.
    expect(probe.endStatus).toBe("aborted");
  });

  it("an idle Session reports 204: there is no compaction to stop", async () => {
    const res = await api.post(`/api/sessions/${SID}/abort`, {});
    expect(res.status).toBe(204);
    expect(probe.started).toBe(false);
  });
});
