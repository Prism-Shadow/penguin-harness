/**
 * POST /api/sessions/:id/abort while a **compaction** is in flight.
 *
 * The composer's Stop button used to be gated on the Session being `running`, so a compacting
 * Session could not be interrupted from the Web App. This file pins the half underneath that
 * button: the abort route does not care which non-idle state the Session is in, and the signal
 * it fires reaches the compaction.
 *
 * - Given a compacting Session, an abort answers 202, the compaction sees the signal and ends
 *   `aborted` (the original context kept), and the Session goes idle.
 * - Given an idle Session, an abort answers 204 and starts nothing.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { compactionBegin, compactionEnd } from "@prismshadow/penguin-core";
import type { OmniMessage } from "@prismshadow/penguin-core";
import { adoptSession, fakeSession, uniqueSessionId } from "./fixtures/session.js";
import { apiClient, createTestApp, provisionUser, waitFor } from "./helpers.js";
import type { TestApp } from "./helpers.js";

/** Records what the compaction saw of the abort signal. */
interface CompactionProbe {
  started: boolean;
  sawAbort: boolean;
  /** The terminal status the compaction settled on (mirrors core: an interrupted one ends `aborted`). */
  endStatus: string | null;
}

describe("abort during compaction", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;
  let sid: string;
  let probe: CompactionProbe;

  beforeAll(async () => {
    t = await createTestApp();
    api = apiClient(t.app, (await provisionUser(t.app, "compactstopper")).cookie);
  });
  afterAll(async () => {
    await t.cleanup();
  });

  // A compaction that parks until the signal fires — the shape of a real one, whose request
  // is a full LLM round trip over the Session's largest context.
  beforeEach(() => {
    sid = uniqueSessionId();
    probe = { started: false, sawAbort: false, endStatus: null };
    const session = fakeSession(sid, {
      async *compact(opts: { signal: AbortSignal }): AsyncGenerator<OmniMessage> {
        probe.started = true;
        yield compactionBegin({ reason: "manual", mode: "summarize", context: 1000, turns: 3 });
        await new Promise<void>((resolve) => {
          if (opts.signal.aborted) resolve();
          else opts.signal.addEventListener("abort", () => resolve(), { once: true });
        });
        probe.sawAbort = opts.signal.aborted;
        // Core's own interrupted-compaction outcome: the pair closes `aborted`, the original
        // context is kept, and the half-written summary is discarded.
        probe.endStatus = "aborted";
        yield compactionEnd({ reason: "manual", mode: "summarize", status: "aborted" });
      },
    });
    adoptSession(t.deps, session, { projectId: "compactstopper-default_project" });
  });

  it("takes the abort while compacting: 202, the signal reaches the compaction, the Session goes idle", async () => {
    await t.deps.manager.startCompact(sid);
    await waitFor(() => probe.started && t.deps.manager.statusOf(sid) === "compacting");

    const res = await api.post(`/api/sessions/${sid}/abort`, {});
    // 202 = an interrupt was triggered (204 would mean "nothing in progress" — the answer
    // this route would give if it only recognized `running` as interruptible).
    expect(res.status).toBe(202);

    await waitFor(() => t.deps.manager.statusOf(sid) === "idle");
    expect(probe.sawAbort).toBe(true);
    expect(probe.endStatus).toBe("aborted");
  });

  it("an idle Session reports 204: there is no compaction to stop", async () => {
    const res = await api.post(`/api/sessions/${sid}/abort`, {});
    expect(res.status).toBe(204);
    expect(probe.started).toBe(false);
  });
});
