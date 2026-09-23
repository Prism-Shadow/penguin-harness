/**
 * The Agent state across a swap (PRFC-0015), driven through the real thing: a full App, the
 * platform's own re-assembly — the kernel `upgrade()` a hot push performs, without a new
 * bundle — and a fake Session whose run the test holds open.
 *
 * Compatible (the same build on both sides): the successor boots over the predecessor's
 * state, so the Task never stops and everything that arrives after the swap — an approval
 * of nothing here, but the follow-up queue, the interrupt — is the successor's to handle.
 * Incompatible (the predecessor's recorded shape is not this build's): the predecessor's
 * logic stops the run, the successor starts the Session again from its loader.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { OmniMessage } from "@prismshadow/penguin-core";
import { assistantText } from "@prismshadow/penguin-core";
import type { SessionRow } from "../src/db/repos/sessions.js";
import type { Reassembly } from "../src/hmr/capabilities.js";
import type { RuntimeSession, SessionManager } from "../src/runtime/session-manager.js";
import { createTestApp, waitFor } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const SID = "session-2026-09-21-10-00-00-aabb0001";

function rowFor(projectId: string): SessionRow {
  const at = new Date().toISOString();
  return {
    sessionId: SID,
    projectId,
    agentId: "default_agent",
    provider: "custom",
    modelId: "m1",
    workspace: "/tmp/w",
    approvalMode: "allow-all",
    title: null,
    createdAt: at,
    lastActiveAt: at,
  };
}

/** A Session whose every run records its input and stays open until the test releases it (or it is aborted). */
function heldSession(runs: OmniMessage[][], release: Promise<void>): RuntimeSession {
  return {
    sessionId: SID,
    toolPermission: () => "rw",
    generateTitle: async () => ({ title: null, usage: null }),
    compactability: () => "ok" as const,
    steer: () => false,
    skipReconnectWait: () => false,
    async *run(input: OmniMessage[], opts) {
      runs.push(input);
      await Promise.race([
        release,
        new Promise<void>((resolve) => opts.signal.addEventListener("abort", () => resolve())),
      ]);
      yield assistantText(opts.signal.aborted ? "stopped" : "done");
    },
    async *compact() {},
  };
}

const textOf = (input: OmniMessage[]): string =>
  input.map((m) => (m.payload as { text?: string }).text ?? "").join("\n");

/** The manager of whichever App is current — after a swap, not the one the fixture flattened. */
async function currentManager(t: TestApp): Promise<SessionManager> {
  const instance = await t.deps.hmr.ensure();
  return instance.api.business()!.api<SessionManager>("SessionRuntimeModule", "Sessions");
}

const reassemble = (t: TestApp): Promise<boolean> =>
  t.deps.tree.api<Reassembly>("RuntimeModule", "Reassembly").reassemble();

describe("the Agent state across a swap", () => {
  let t: TestApp;
  afterEach(async () => {
    await t.cleanup();
  });

  it("a running Task goes on through the swap, and the successor starts what it queued", async () => {
    const runs: OmniMessage[][] = [];
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    t = await createTestApp();
    const before = t.deps.manager;
    before.adopt(rowFor("default_project"), heldSession(runs, held));
    t.deps.sessionsRepo.insert(rowFor("default_project"));
    await before.startTask(SID, [assistantText("first")]);
    await waitFor(() => runs.length === 1);

    expect(await reassemble(t)).toBe(true);

    const after = await currentManager(t);
    expect(after).not.toBe(before);
    // Same state, never stopped: the successor reads the run as its own.
    expect(after.statusOf(SID)).toBe("running");
    expect(runs).toHaveLength(1);
    // What arrives after the swap is the successor's: a follow-up queues behind the run…
    const queued = await after.startTask(SID, [assistantText("second")], { queueIfBusy: true });
    expect(queued.queued).toBe(true);
    // …and when the run — still the predecessor's function — ends, the successor starts it.
    release();
    await waitFor(() => runs.length === 2);
    expect(textOf(runs[1]!)).toBe("second");
    await waitFor(() => after.statusOf(SID) === "idle");
  });

  it("a state this build cannot take over is stopped by the old logic and started again by the new", async () => {
    const runs: OmniMessage[][] = [];
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const session = heldSession(runs, held);
    // The successor has no state to find the Session in, so it loads it — from here.
    t = await createTestApp({ loader: { load: async () => session } });
    const before = t.deps.manager;
    t.deps.sessionsRepo.insert(rowFor("default_project"));
    await before.startTask(SID, [assistantText("first")]);
    await waitFor(() => runs.length === 1);
    // The predecessor "was another build": its state's recorded shape is not this one's.
    const envelope = t.deps.hmr.resources.claim<{ shape: string | null }>("agentState:state")!;
    envelope.shape = "another build's AgentState";

    expect(await reassemble(t)).toBe(true);

    // Stopped with the predecessor's logic (its abort reached the run), started again with
    // the successor's: a second run, carrying the note that says why.
    await waitFor(() => runs.length === 2);
    expect(textOf(runs[1]!)).toContain("[harness_updated]");
    const after = await currentManager(t);
    expect(after).not.toBe(before);
    expect(after.statusOf(SID)).toBe("running");
    release();
    await waitFor(() => after.statusOf(SID) === "idle");
  });
});
