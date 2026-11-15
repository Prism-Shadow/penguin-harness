/**
 * The Session background-process endpoints the process panel drives.
 *
 * - GET lists the runtime's processes with ISO start times (refreshing their service probes);
 *   an unloaded Session reports none.
 * - Kill stops a running process and drops its row.
 * - DELETE removes an EXITED entry (204); a running one is a 409 process_running (removal never
 *   signals a live process group — stopping is the kill route's job); an unknown id, or a
 *   Session whose runtime is gone, is a 404.
 * - Backgrounding hands an executing call back as a background task (204); a call that is not
 *   running is a 404 tool_call_not_found, a tool with no background form a 409.
 * - Foreign and unknown Sessions are 404s, as on every Session route.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { BackgroundCommandInfo, ToolDetachResult } from "@prismshadow/penguin-core";
import type { SessionProcessesResponse } from "../src/api/types.js";
import type { RuntimeSession } from "../src/runtime/session-manager.js";
import { adoptSession, fakeSession, sessionRow, uniqueSessionId } from "./fixtures/session.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const PROJECT = "procuser-default_project";
const STARTED_AT = Date.UTC(2026, 7, 18, 12, 4, 0);

/**
 * What core's detach answers per tool_call_id in these tests: one executing call the user can
 * move to the background, one executing call whose tool has no background form. Any other id
 * is a call that is not running.
 */
const DETACH_ANSWERS = new Map<string, ToolDetachResult>([
  ["call_exec_1", "detached"],
  ["call_read_1", "not_detachable"],
]);

/** Fake Session backed by a mutable process array; kill removes the entry like core's registry. */
function processesFakeSession(
  sessionId: string,
  procs: BackgroundCommandInfo[],
  kills: string[],
  probes?: string[],
  detaches?: string[],
): RuntimeSession {
  return fakeSession(sessionId, {
    listBackgroundCommands: () => [...procs],
    probeBackgroundCommandServices: async () => {
      probes?.push(sessionId);
    },
    killBackgroundCommand: (processId: string) => {
      const i = procs.findIndex((p) => p.processId === processId);
      if (i === -1) return false;
      kills.push(processId);
      procs.splice(i, 1);
      return true;
    },
    detachToolCall: (toolCallId: string) => {
      const answer = DETACH_ANSWERS.get(toolCallId) ?? "not_running";
      if (answer === "detached") detaches?.push(toolCallId);
      return answer;
    },
  });
}

describe("session processes routes", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;
  let outsider: ReturnType<typeof apiClient>;
  let SID: string;
  let SID_UNLOADED: string;
  let procs: BackgroundCommandInfo[];
  let kills: string[];
  let probes: string[];
  let detaches: string[];

  beforeAll(async () => {
    t = await createTestApp();
    api = apiClient(t.app, (await provisionUser(t.app, "procuser")).cookie);
    outsider = apiClient(t.app, (await provisionUser(t.app, "outsider_p")).cookie);
  });
  afterAll(async () => {
    await t.cleanup();
  });
  beforeEach(() => {
    SID = uniqueSessionId();
    SID_UNLOADED = uniqueSessionId();
    procs = [
      {
        processId: "proc-11111111",
        pid: 4242,
        cmd: "pnpm dev",
        cwd: "/tmp/w",
        startedAt: STARTED_AT,
        running: true,
        serviceUrl: "http://localhost:5173/",
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
    probes = [];
    detaches = [];
    adoptSession(t.deps, processesFakeSession(SID, procs, kills, probes, detaches), {
      projectId: PROJECT,
      approvalMode: "always-ask",
    });
    // A second session with no runtime entry: truthfully reports no processes.
    t.deps.sessionsRepo.insert(sessionRow(SID_UNLOADED, { projectId: PROJECT }));
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
        serviceUrl: "http://localhost:5173/",
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

    // The route refreshed the listen-port probes before listing (first fetch carries probed URLs).
    expect(probes).toEqual([SID]);

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

  it("POST background moves an executing call to the background (204)", async () => {
    const res = await api.post(`/api/sessions/${SID}/tool-calls/call_exec_1/background`, {});
    expect(res.status).toBe(204);
    expect(detaches).toEqual(["call_exec_1"]);
  });

  it("POST background → 404 tool_call_not_found for a call that is not running, or an unloaded runtime", async () => {
    const gone = await api.post(`/api/sessions/${SID}/tool-calls/call_ghost/background`, {});
    expect(gone.status).toBe(404);
    expect(((await gone.json()) as { error: { code: string } }).error.code).toBe(
      "tool_call_not_found",
    );

    const unloaded = await api.post(
      `/api/sessions/${SID_UNLOADED}/tool-calls/call_exec_1/background`,
      {},
    );
    expect(unloaded.status).toBe(404);
    expect(detaches).toEqual([]);
  });

  it("POST background → 409 tool_not_detachable for a tool with no background form", async () => {
    const res = await api.post(`/api/sessions/${SID}/tool-calls/call_read_1/background`, {});
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "tool_not_detachable",
    );
    expect(detaches).toEqual([]);
  });

  it("foreign and unknown sessions → 404 (same auth semantics as the other session routes)", async () => {
    expect((await outsider.get(`/api/sessions/${SID}/processes`)).status).toBe(404);
    expect((await outsider.delete(`/api/sessions/${SID}/processes/proc-22222222`)).status).toBe(
      404,
    );
    expect((await api.delete(`/api/sessions/session-ghost/processes/proc-1`)).status).toBe(404);
    expect(
      (await outsider.post(`/api/sessions/${SID}/tool-calls/call_exec_1/background`, {})).status,
    ).toBe(404);
    expect(kills).toEqual([]);
    expect(detaches).toEqual([]);
  });
});
