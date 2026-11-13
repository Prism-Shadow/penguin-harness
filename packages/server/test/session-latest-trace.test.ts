/**
 * `SessionService.latestTracePath`: the deterministic direct lookup that answers an index miss
 * before the forced reconcile runs, and the TTL cache in front of the whole method.
 *
 * Scenarios:
 * - Given a shard on disk that the mtime gate cannot see (a backdated write), the answer is that
 *   shard and no forced reconcile runs — the walk over the whole Agent tree is what the direct
 *   lookup exists to avoid.
 * - Given no shard of the Session on disk, the direct lookup finds nothing, the forced reconcile
 *   still runs, and the answer is unchanged (`undefined`).
 * - Given the TTL, a repeat call inside it is answered from the cache and past it the method
 *   reconciles again; a negative answer is cached the same way.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionMeta, userText } from "@prismshadow/penguin-core";
import type { SessionMetaPayload } from "@prismshadow/penguin-core";
import type { ProjectCreateResponse } from "../src/api/types.js";
import type { SessionRow } from "../src/db/repos/sessions.js";
import { apiClient, createTestApp, provisionUser, writeTraceFile } from "./helpers.js";
import type { TestApp } from "./helpers.js";

/** The forced passes among a reconcile spy's calls (the ones the direct lookup exists to skip). */
function forced(spy: { mock: { calls: unknown[][] } }): unknown[] {
  return spy.mock.calls.filter(
    (call) => (call[2] as { force?: boolean } | undefined)?.force === true,
  );
}

/**
 * Ages a path's mtime past the reconciler's FRESH_MS window, at a FIXED past instant so
 * repeated calls are idempotent — resetting a changed directory to the clock the gate already
 * cached is what makes the write below invisible to it.
 */
async function backdate(...paths: string[]): Promise<void> {
  const old = new Date("2026-01-01T00:00:00.000Z");
  for (const p of paths) {
    await fs.utimes(p, old, old);
  }
}

describe("session-latest-trace", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;
  let projectId: string;
  /** The case's own Agent: the reconciler's gate and the Trace tree are per Agent. */
  let agentId: string;
  let cases = 0;
  let sessions = 0;

  beforeAll(async () => {
    t = await createTestApp();
    const { cookie } = await provisionUser(t.app, "alice");
    api = apiClient(t.app, cookie);
    const res = await api.post("/api/projects", {
      projectId: "alice-latesttrace",
      name: "test project",
    });
    const created = (await res.json()) as ProjectCreateResponse;
    if (created.project === undefined) {
      throw new Error(`project create failed: ${res.status} ${JSON.stringify(created)}`);
    }
    projectId = created.project.projectId;
  });
  afterAll(async () => {
    await t.cleanup();
  });
  beforeEach(async () => {
    agentId = `case_${++cases}`;
    expect((await api.post(`/api/projects/${projectId}/agents`, { agentId })).status).toBe(201);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await api.delete(`/api/projects/${projectId}/agents/${agentId}`);
  });

  const tracesRoot = () => path.join(t.root, projectId, "agents", agentId, "traces");

  /** A Session that exists in the index and nowhere else (no run ever wrote a shard for it). */
  function insertSession(): SessionRow {
    const sessionId = `session-2026-07-05-10-00-00-aabb${String(++sessions).padStart(4, "0")}`;
    const row: SessionRow = {
      sessionId,
      projectId,
      agentId,
      provider: "custom",
      modelId: "m1",
      workspace: `/tmp/${sessionId}`,
      approvalMode: "allow-all",
      title: null,
      client: "web",
      createdAt: "2026-07-05T10:00:00.000Z",
      lastActiveAt: "2026-07-05T10:00:00.000Z",
    };
    t.deps.sessionsRepo.insert(row);
    return row;
  }

  function metaPayload(row: SessionRow): SessionMetaPayload {
    return {
      session_id: row.sessionId,
      model_id: row.modelId,
      provider: row.provider,
      model_context_window: 1000,
      system_prompt: "",
      agent_state: "/tmp/a",
      workspace: row.workspace,
      source: "user",
    };
  }

  it("answers a backdated shard from disk without running a forced reconcile", async () => {
    const row = insertSession();
    // A quiet, still-empty traces root: the gate caches it as unchanged, so the shard written
    // below — with the directory's mtime put back where the gate left it — is invisible to it.
    await fs.mkdir(tracesRoot(), { recursive: true });
    await backdate(tracesRoot());
    await t.deps.traceIndex.reconcileAgent(projectId, agentId);
    const shard = await writeTraceFile(t.root, projectId, agentId, "2026-07-05", row.sessionId, 1, [
      sessionMeta(metaPayload(row)),
      userText("a"),
    ]);
    await backdate(tracesRoot());
    // The setup is the point: disk is ahead of the index, which is what makes the miss expensive.
    expect(
      t.deps.traceIndex.repo.listFilesBySession(projectId, agentId, row.sessionId),
    ).toHaveLength(0);

    const reconciles = vi.spyOn(t.deps.traceIndex, "reconcileAgent");
    expect(await t.deps.sessionService.latestTracePath(row)).toBe(shard);
    expect(forced(reconciles)).toHaveLength(0);
  });

  it("still forces a reconcile when the direct lookup finds nothing, with the answer unchanged", async () => {
    const row = insertSession();
    const reconciles = vi.spyOn(t.deps.traceIndex, "reconcileAgent");
    expect(await t.deps.sessionService.latestTracePath(row)).toBeUndefined();
    expect(forced(reconciles)).toHaveLength(1);
  });

  it("caches inside the TTL, reconciles again past it, and caches negative answers too", async () => {
    let clock = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    const row = insertSession();
    const shard = await writeTraceFile(t.root, projectId, agentId, "2026-07-05", row.sessionId, 1, [
      sessionMeta(metaPayload(row)),
      userText("a"),
    ]);
    const reconciles = vi.spyOn(t.deps.traceIndex, "reconcileAgent");

    expect(await t.deps.sessionService.latestTracePath(row)).toBe(shard);
    expect(reconciles).toHaveBeenCalledTimes(1);
    expect(await t.deps.sessionService.latestTracePath(row)).toBe(shard);
    expect(reconciles).toHaveBeenCalledTimes(1); // inside the TTL: answered from the cache

    clock += 3100;
    expect(await t.deps.sessionService.latestTracePath(row)).toBe(shard);
    expect(reconciles).toHaveBeenCalledTimes(2); // past the TTL: reconciled again

    const untraced = insertSession();
    clock += 3100;
    expect(await t.deps.sessionService.latestTracePath(untraced)).toBeUndefined();
    const reachedDisk = reconciles.mock.calls.length;
    expect(await t.deps.sessionService.latestTracePath(untraced)).toBeUndefined();
    expect(reconciles.mock.calls.length).toBe(reachedDisk); // the miss is cached as well
  });
});
