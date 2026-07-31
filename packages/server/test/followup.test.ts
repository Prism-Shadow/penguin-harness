/**
 * Integration tests for the follow-up queue (POST /api/sessions/:id/tasks with
 * `queueIfBusy`):
 *   - busy session → 202 `{queued: true}`, input held server-side, auto-started as an
 *     ordinary task once the current run finishes;
 *   - idle session → the flag is a no-op (`queued: false`, task starts directly).
 * (The queued count on task_state events is covered by the session-manager unit tests.)
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { approvalDecision, assistantText, toolCall } from "@prismshadow/penguin-core";
import type { ApproveFn, OmniMessage } from "@prismshadow/penguin-core";
import type { TaskCreateResponse } from "../src/api/types.js";
import type { SessionRow } from "../src/db/repos/sessions.js";
import type { RuntimeSession } from "../src/runtime/session-manager.js";
import { apiClient, createTestApp, provisionUser, waitFor } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const SID = "session-2026-07-06-10-00-00-eeff0001";

/** Fake Session that parks on one approval per run (keeps the Task running) and records each run's input. */
function parkingFakeSession(sessionId: string, runs: string[][]): RuntimeSession {
  return {
    sessionId,
    toolPermission: () => "rw",
    generateTitle: async () => ({ title: null, usage: null }),
    compactability: () => "ok" as const,
    steer: () => false,
    skipReconnectWait: () => false,
    async *run(input: OmniMessage[], opts: { approve: ApproveFn; signal: AbortSignal }) {
      runs.push(input.map((m) => (m.payload as { text?: string }).text ?? ""));
      const tc = toolCall({ name: "exec_command", arguments: "{}", toolCallId: "tc-fu" });
      yield tc;
      const decision = await opts.approve(tc);
      yield approvalDecision(decision, "tc-fu");
      yield assistantText("done");
    },
    async *compact() {},
  };
}

describe("follow-up queue route", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;
  let runs: string[][];

  beforeEach(async () => {
    t = await createTestApp();
    const { cookie } = await provisionUser(t.app, "queuer");
    api = apiClient(t.app, cookie);
    t.deps.approvalModes.set("queuer", "always-ask");
    const row: SessionRow = {
      sessionId: SID,
      projectId: "queuer-default_project",
      agentId: "default_agent",
      provider: "custom",
      modelId: "m1",
      workspace: "/tmp/w",
      approvalMode: "always-ask",
      title: null,
      createdAt: new Date().toISOString(),
    };
    t.deps.sessionsRepo.insert(row);
    runs = [];
    t.deps.manager.adopt(row, parkingFakeSession(SID, runs));
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("busy → 202 queued:true and auto-starts after the current run; idle → queued:false", async () => {
    // Idle: the flag is a no-op, the task starts directly.
    const direct = await api.post(`/api/sessions/${SID}/tasks`, {
      input: [{ type: "text", text: "task 1" }],
      queueIfBusy: true,
    });
    expect(direct.status).toBe(202);
    expect(((await direct.json()) as TaskCreateResponse).queued).toBe(false);
    await waitFor(() => t.deps.manager.pendingApprovalCount(SID) === 1);

    // Busy: held server-side (a plain POST would 409).
    const queuedRes = await api.post(`/api/sessions/${SID}/tasks`, {
      input: [{ type: "text", text: "follow-up" }],
      queueIfBusy: true,
    });
    expect(queuedRes.status).toBe(202);
    expect(((await queuedRes.json()) as TaskCreateResponse).queued).toBe(true);
    expect(t.deps.manager.pendingFollowUpCount(SID)).toBe(1);
    expect(
      (await api.post(`/api/sessions/${SID}/tasks`, { input: [{ type: "text", text: "x" }] }))
        .status,
    ).toBe(409);

    // Finish run 1: the follow-up auto-starts as an ordinary task, in order.
    t.deps.manager.decideApproval(SID, "tc-fu", "allow");
    await waitFor(() => runs.length === 2);
    expect(runs[1]).toEqual(["follow-up"]);
    expect(t.deps.manager.pendingFollowUpCount(SID)).toBe(0);
    await waitFor(() => t.deps.manager.pendingApprovalCount(SID) === 1);
    t.deps.manager.decideApproval(SID, "tc-fu", "allow");
    await waitFor(() => t.deps.manager.statusOf(SID) === "idle");
  });
});
