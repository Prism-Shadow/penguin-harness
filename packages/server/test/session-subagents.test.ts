/**
 * Integration tests for the panel's subagent endpoints and the child-liveness broadcast:
 *   - POST /api/sessions/:id/subagents/:childSessionId/steer — steering while the child runs
 *     ({outcome:"steered"}), a follow-up run while it is idle ({outcome:"started"}); 404
 *     subagent_gone when no live child bears the id or the parent runtime is unloaded, 409
 *     subagent_busy when the child cannot accept steering, 400 on an empty text;
 *   - POST /api/sessions/:id/subagents/:childSessionId/abort — 202 when a run was aborted,
 *     204 when the child is idle/unknown (nothing left to stop);
 *   - `task_state` republished with the live `subagents` listing on every child state ping,
 *     and the SSE subscribe snapshot carrying the same listing;
 *   - 404 for foreign/unknown sessions (the shared resolveSession semantics).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BackgroundSubagentInfo, OmniMessage } from "@prismshadow/penguin-core";
import type { ApproveFn, SubagentSteerOutcome } from "@prismshadow/penguin-core";
import type { ServerEvent, SubagentSteerResponse } from "../src/api/types.js";
import type { SessionRow } from "../src/db/repos/sessions.js";
import type { RuntimeSession } from "../src/runtime/session-manager.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const SID = "session-2026-08-24-10-00-00-ccdd0041";
const SID_UNLOADED = "session-2026-08-24-10-00-00-ccdd0042";
const CHILD_RUNNING = "session-2026-08-24-10-01-00-child001";
const CHILD_IDLE = "session-2026-08-24-10-01-00-child002";

/** Fake Session over a mutable child list; steering/abort mutate it like core's manager would. */
function subagentsFakeSession(
  sessionId: string,
  children: BackgroundSubagentInfo[],
  steers: { childSessionId: string; text: string }[],
  aborts: string[],
  stateListeners: (() => void)[],
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
    listBackgroundSubagents: () => children.map((c) => ({ ...c })),
    steerBackgroundSubagent: (childSessionId: string, text: string): SubagentSteerOutcome => {
      const child = children.find((c) => c.sessionId === childSessionId);
      if (!child) return "gone";
      steers.push({ childSessionId, text });
      if (child.running) return "steered";
      child.running = true;
      return "started";
    },
    abortBackgroundSubagentRun: (childSessionId: string): boolean => {
      const child = children.find((c) => c.sessionId === childSessionId);
      if (!child || !child.running) return false;
      aborts.push(childSessionId);
      child.running = false;
      return true;
    },
    onSubagentState: (listener: () => void) => {
      stateListeners.push(listener);
    },
  };
}

describe("session subagent routes and liveness", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;
  let outsider: ReturnType<typeof apiClient>;
  let children: BackgroundSubagentInfo[];
  let steers: { childSessionId: string; text: string }[];
  let aborts: string[];
  let stateListeners: (() => void)[];

  const sessionRow = (sessionId: string): SessionRow => ({
    sessionId,
    projectId: "subuser-default_project",
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
    const { cookie } = await provisionUser(t.app, "subuser");
    const other = await provisionUser(t.app, "outsider_s");
    api = apiClient(t.app, cookie);
    outsider = apiClient(t.app, other.cookie);
    children = [
      { sessionId: CHILD_RUNNING, subagentId: "subagent-child001", running: true },
      { sessionId: CHILD_IDLE, subagentId: null, running: false },
    ];
    steers = [];
    aborts = [];
    stateListeners = [];
    t.deps.sessionsRepo.insert(sessionRow(SID));
    t.deps.manager.adopt(
      sessionRow(SID),
      subagentsFakeSession(SID, children, steers, aborts, stateListeners),
    );
    // A second session with no runtime entry: its children are gone with the process.
    t.deps.sessionsRepo.insert(sessionRow(SID_UNLOADED));
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("steer: steering while the child runs, a follow-up run while it is idle", async () => {
    const mid = await api.post(`/api/sessions/${SID}/subagents/${CHILD_RUNNING}/steer`, {
      text: "focus on the tests",
    });
    expect(mid.status).toBe(200);
    expect((await mid.json()) as SubagentSteerResponse).toEqual({ outcome: "steered" });

    const idle = await api.post(`/api/sessions/${SID}/subagents/${CHILD_IDLE}/steer`, {
      text: "one more round",
    });
    expect(idle.status).toBe(200);
    expect((await idle.json()) as SubagentSteerResponse).toEqual({ outcome: "started" });

    expect(steers).toEqual([
      { childSessionId: CHILD_RUNNING, text: "focus on the tests" },
      { childSessionId: CHILD_IDLE, text: "one more round" },
    ]);
  });

  it("steer: 404 subagent_gone for unknown children and unloaded runtimes; 400 without text", async () => {
    const ghost = await api.post(`/api/sessions/${SID}/subagents/session-ghost/steer`, {
      text: "hello",
    });
    expect(ghost.status).toBe(404);
    expect(((await ghost.json()) as { error: { code: string } }).error.code).toBe("subagent_gone");

    const unloaded = await api.post(
      `/api/sessions/${SID_UNLOADED}/subagents/${CHILD_RUNNING}/steer`,
      { text: "hello" },
    );
    expect(unloaded.status).toBe(404);
    expect(((await unloaded.json()) as { error: { code: string } }).error.code).toBe(
      "subagent_gone",
    );

    const empty = await api.post(`/api/sessions/${SID}/subagents/${CHILD_RUNNING}/steer`, {
      text: "   ",
    });
    expect(empty.status).toBe(400);
    expect(steers).toEqual([]);
  });

  it("abort: 202 ends the running child's round; 204 when idle or unknown", async () => {
    const res = await api.post(`/api/sessions/${SID}/subagents/${CHILD_RUNNING}/abort`, {});
    expect(res.status).toBe(202);
    expect(aborts).toEqual([CHILD_RUNNING]);

    const again = await api.post(`/api/sessions/${SID}/subagents/${CHILD_RUNNING}/abort`, {});
    expect(again.status).toBe(204);
    const ghost = await api.post(`/api/sessions/${SID}/subagents/session-ghost/abort`, {});
    expect(ghost.status).toBe(204);
    const unloaded = await api.post(
      `/api/sessions/${SID_UNLOADED}/subagents/${CHILD_RUNNING}/abort`,
      {},
    );
    expect(unloaded.status).toBe(204);
    expect(aborts).toEqual([CHILD_RUNNING]);
  });

  it("republishes task_state with the live subagents listing on every child state ping", async () => {
    const events: ServerEvent[] = [];
    t.deps.channels.get(SID).subscribe((evt) => {
      if (evt.event === "server_event") events.push(JSON.parse(evt.data) as ServerEvent);
    });
    expect(stateListeners).toHaveLength(1);

    children[0]!.running = false;
    stateListeners[0]!();
    const state = events.find((e) => e.type === "task_state");
    expect(state).toBeDefined();
    expect(state && state.type === "task_state" ? state.subagents : undefined).toEqual([
      { sessionId: CHILD_RUNNING, subagentId: "subagent-child001", running: false },
      { sessionId: CHILD_IDLE, subagentId: null, running: false },
    ]);
  });

  it("the SSE subscribe snapshot carries the live subagents listing", async () => {
    const res = await api.get(`/api/sessions/${SID}/stream`);
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    const { value } = await reader.read();
    await reader.cancel();
    const frame = new TextDecoder().decode(value);
    expect(frame).toContain('"type":"task_state"');
    expect(frame).toContain(`"subagents":[{"sessionId":"${CHILD_RUNNING}"`);
  });

  it("foreign and unknown sessions → 404 (same auth semantics as the other session routes)", async () => {
    expect(
      (await outsider.post(`/api/sessions/${SID}/subagents/${CHILD_RUNNING}/steer`, { text: "x" }))
        .status,
    ).toBe(404);
    expect(
      (await outsider.post(`/api/sessions/${SID}/subagents/${CHILD_RUNNING}/abort`, {})).status,
    ).toBe(404);
    expect(
      (
        await api.post(`/api/sessions/session-ghost/subagents/${CHILD_RUNNING}/steer`, {
          text: "x",
        })
      ).status,
    ).toBe(404);
    expect(steers).toEqual([]);
    expect(aborts).toEqual([]);
  });
});
