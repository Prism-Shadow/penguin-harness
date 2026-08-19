/**
 * Integration tests for the session background-process endpoints:
 *   - GET  /api/sessions/:id/processes            — list (ISO startedAt, running flag);
 *   - POST /api/sessions/:id/processes/:pid/kill  — stop a running process (drops the row);
 *   - DELETE /api/sessions/:id/processes/:pid     — remove an EXITED entry from the list:
 *       204 removes it, 409 process_running while it still runs (stop is the kill route's
 *       job — removal never signals a live process group), 404 for unknown ids and for
 *       sessions whose runtime is gone (nothing left to remove either way);
 *   - 404 for foreign/unknown sessions (the shared resolveSession semantics).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BackgroundCommandInfo, OmniMessage } from "@prismshadow/penguin-core";
import type { ApproveFn } from "@prismshadow/penguin-core";
import type { SessionProcessesResponse } from "../src/api/types.js";
import type { SessionRow } from "../src/db/repos/sessions.js";
import type { RuntimeSession } from "../src/runtime/session-manager.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const SID = "session-2026-08-18-10-00-00-ccdd0031";
const SID_UNLOADED = "session-2026-08-18-10-00-00-ccdd0032";
const STARTED_AT = Date.UTC(2026, 7, 18, 12, 4, 0);

/** Fake Session backed by a mutable process array; kill removes the entry like core's registry. */
function processesFakeSession(
  sessionId: string,
  procs: BackgroundCommandInfo[],
  kills: string[],
): RuntimeSession {
  return {
    sessionId,
    toolPermission: () => "rw",
    generateTitle: async () => ({ title: null, usage: null }),
    compactability: () => "ok" as const,
    steer: () => false,
    skipReconnectWait: () => false,
    async *run(_input: OmniMessage[], _opts: { approve: ApproveFn; signal: AbortSignal }) {},
    async *compact() {},
    listBackgroundCommands: () => [...procs],
    killBackgroundCommand: (processId: string) => {
      const i = procs.findIndex((p) => p.processId === processId);
      if (i === -1) return false;
      kills.push(processId);
      procs.splice(i, 1);
      return true;
    },
  };
}

describe("session processes routes", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;
  let outsider: ReturnType<typeof apiClient>;
  let procs: BackgroundCommandInfo[];
  let kills: string[];

  const sessionRow = (sessionId: string): SessionRow => ({
    sessionId,
    projectId: "procuser-default_project",
    agentId: "default_agent",
    modelId: "m1",
    provider: "custom",
    workspace: "/tmp/w",
    approvalMode: "always-ask",
    title: null,
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
  });

  beforeEach(async () => {
    t = await createTestApp();
    const { cookie } = await provisionUser(t.app, "procuser");
    const other = await provisionUser(t.app, "outsider_p");
    api = apiClient(t.app, cookie);
    outsider = apiClient(t.app, other.cookie);
    procs = [
      {
        processId: "proc-11111111",
        pid: 4242,
        cmd: "pnpm dev",
        cwd: "/tmp/w",
        startedAt: STARTED_AT,
        running: true,
      },
      {
        processId: "proc-22222222",
        pid: 4243,
        cmd: "sleep 1",
        cwd: "/tmp/w",
        startedAt: STARTED_AT,
        running: false,
      },
    ];
    kills = [];
    t.deps.sessionsRepo.insert(sessionRow(SID));
    t.deps.manager.adopt(sessionRow(SID), processesFakeSession(SID, procs, kills));
    // A second session with no runtime entry: truthfully reports no processes.
    t.deps.sessionsRepo.insert(sessionRow(SID_UNLOADED));
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("GET lists the runtime's processes with ISO start times; an unloaded session reports none", async () => {
    const res = await api.get(`/api/sessions/${SID}/processes`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as SessionProcessesResponse;
    expect(body.processes).toEqual([
      {
        processId: "proc-11111111",
        pid: 4242,
        cmd: "pnpm dev",
        cwd: "/tmp/w",
        startedAt: new Date(STARTED_AT).toISOString(),
        running: true,
      },
      {
        processId: "proc-22222222",
        pid: 4243,
        cmd: "sleep 1",
        cwd: "/tmp/w",
        startedAt: new Date(STARTED_AT).toISOString(),
        running: false,
      },
    ]);

    const unloaded = await api.get(`/api/sessions/${SID_UNLOADED}/processes`);
    expect(unloaded.status).toBe(200);
    expect(((await unloaded.json()) as SessionProcessesResponse).processes).toEqual([]);
  });

  it("DELETE removes an exited entry (204) and the follow-up list no longer carries it", async () => {
    const res = await api.delete(`/api/sessions/${SID}/processes/proc-22222222`);
    expect(res.status).toBe(204);
    expect(kills).toEqual(["proc-22222222"]);

    const body = (await (
      await api.get(`/api/sessions/${SID}/processes`)
    ).json()) as SessionProcessesResponse;
    expect(body.processes.map((p) => p.processId)).toEqual(["proc-11111111"]);

    // Removing it again: already gone → 404, nothing re-killed.
    const again = await api.delete(`/api/sessions/${SID}/processes/proc-22222222`);
    expect(again.status).toBe(404);
    expect(((await again.json()) as { error: { code: string } }).error.code).toBe(
      "process_not_found",
    );
    expect(kills).toEqual(["proc-22222222"]);
  });

  it("DELETE on a running process → 409 process_running, entry untouched", async () => {
    const res = await api.delete(`/api/sessions/${SID}/processes/proc-11111111`);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("process_running");
    expect(kills).toEqual([]);

    const body = (await (
      await api.get(`/api/sessions/${SID}/processes`)
    ).json()) as SessionProcessesResponse;
    expect(body.processes).toHaveLength(2);
  });

  it("DELETE with an unknown id or an unloaded runtime → 404 process_not_found", async () => {
    const ghost = await api.delete(`/api/sessions/${SID}/processes/proc-99999999`);
    expect(ghost.status).toBe(404);
    expect(((await ghost.json()) as { error: { code: string } }).error.code).toBe(
      "process_not_found",
    );

    const unloaded = await api.delete(`/api/sessions/${SID_UNLOADED}/processes/proc-11111111`);
    expect(unloaded.status).toBe(404);
    expect(((await unloaded.json()) as { error: { code: string } }).error.code).toBe(
      "process_not_found",
    );
    expect(kills).toEqual([]);
  });

  it("POST kill stops a RUNNING process and drops its row (the stop path is untouched)", async () => {
    const res = await api.post(`/api/sessions/${SID}/processes/proc-11111111/kill`, {});
    expect(res.status).toBe(204);
    expect(kills).toEqual(["proc-11111111"]);

    const body = (await (
      await api.get(`/api/sessions/${SID}/processes`)
    ).json()) as SessionProcessesResponse;
    expect(body.processes.map((p) => p.processId)).toEqual(["proc-22222222"]);
  });

  it("foreign and unknown sessions → 404 (same auth semantics as the other session routes)", async () => {
    expect((await outsider.get(`/api/sessions/${SID}/processes`)).status).toBe(404);
    expect((await outsider.delete(`/api/sessions/${SID}/processes/proc-22222222`)).status).toBe(
      404,
    );
    expect((await api.delete(`/api/sessions/session-ghost/processes/proc-1`)).status).toBe(404);
    expect(kills).toEqual([]);
  });
});
