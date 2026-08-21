/**
 * Integration tests for the follow-up queue (POST /api/sessions/:id/tasks with
 * `queueIfBusy`):
 *   - busy session → 202 `{queued: true}`, input held server-side, auto-started as an
 *     ordinary task once the current run finishes;
 *   - idle session → the flag is a no-op (`queued: false`, task starts directly).
 * (The queued count on task_state events is covered by the session-manager unit tests.)
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  approvalDecision,
  approvalDecisionOf,
  assistantText,
  toolCall,
} from "@prismshadow/penguin-core";
import type { ApproveFn, OmniMessage } from "@prismshadow/penguin-core";
import type { TaskCreateResponse } from "../src/api/types.js";
import type { SessionRow } from "../src/db/repos/sessions.js";
import type { RecallStore, RuntimeSession } from "../src/runtime/session-manager.js";
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
      const decision = approvalDecisionOf(await opts.approve(tc));
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
      lastActiveAt: new Date().toISOString(),
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

  it("recall (#287): DELETE withdraws a queued follow-up with its content and thinking level; the rest auto-start", async () => {
    await api.post(`/api/sessions/${SID}/tasks`, { input: [{ type: "text", text: "task 1" }] });
    await waitFor(() => t.deps.manager.pendingApprovalCount(SID) === 1);

    const png = "data:image/png;base64,AAAA";
    await api.post(`/api/sessions/${SID}/tasks`, {
      input: [
        { type: "text", text: "follow-up 1" },
        { type: "image_url", imageUrl: png },
      ],
      queueIfBusy: true,
      thinkingLevel: "high",
    });
    await api.post(`/api/sessions/${SID}/tasks`, {
      input: [{ type: "text", text: "follow-up 2" }],
      queueIfBusy: true,
    });
    const pending = t.deps.manager.pendingFollowUpsOf(SID);
    expect(pending).toEqual([
      { id: expect.any(String), text: "follow-up 1", images: 1, files: 0 },
      { id: expect.any(String), text: "follow-up 2", images: 0, files: 0 },
    ]);

    // The recall returns the original content plus the per-turn level it was queued with.
    const res = await api.delete(`/api/sessions/${SID}/follow-ups/${pending[0]!.id}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      text: "follow-up 1",
      images: [png],
      files: [],
      thinkingLevel: "high",
    });
    expect(t.deps.manager.pendingFollowUpCount(SID)).toBe(1);

    // Recalled means never started: only the remaining follow-up auto-starts.
    t.deps.manager.decideApproval(SID, "tc-fu", "allow");
    await waitFor(() => runs.length === 2);
    expect(runs[1]).toEqual(["follow-up 2"]);

    // Gone (recalled or auto-started) → 409 not_pending.
    const again = await api.delete(`/api/sessions/${SID}/follow-ups/${pending[0]!.id}`);
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: { code: string } }).error.code).toBe("not_pending");

    await waitFor(() => t.deps.manager.pendingApprovalCount(SID) === 1);
    t.deps.manager.decideApproval(SID, "tc-fu", "allow");
    await waitFor(() => t.deps.manager.statusOf(SID) === "idle");
  });

  it("the SSE subscribe snapshot carries the queued follow-up list (what makes the recall lines survive reloads)", async () => {
    await api.post(`/api/sessions/${SID}/tasks`, { input: [{ type: "text", text: "task 1" }] });
    await waitFor(() => t.deps.manager.pendingApprovalCount(SID) === 1);
    await api.post(`/api/sessions/${SID}/tasks`, {
      input: [{ type: "text", text: "queued for later" }],
      queueIfBusy: true,
    });

    // The first SSE frames are the initial task_state snapshot: it must carry the per-entry
    // list (id + content), not just the queued count — a reloaded page rebuilds each hint
    // line with its recall handle from this alone.
    const res = await api.get(`/api/sessions/${SID}/stream`);
    const reader = res.body!.getReader();
    let seen = "";
    for (let i = 0; i < 5 && !seen.includes("task_state"); i += 1) {
      const { value, done } = await reader.read();
      if (done) break;
      seen += new TextDecoder().decode(value);
    }
    await reader.cancel();
    expect(seen).toContain('"task_state"');
    expect(seen).toContain('"pendingFollowUps"');
    expect(seen).toContain("queued for later");

    t.deps.manager.decideApproval(SID, "tc-fu", "allow");
    await waitFor(() => runs.length === 2);
    await waitFor(() => t.deps.manager.pendingApprovalCount(SID) === 1);
    t.deps.manager.decideApproval(SID, "tc-fu", "allow");
    await waitFor(() => t.deps.manager.statusOf(SID) === "idle");
  });

  it("recall (#287) racing the auto-start: a recall in the idle gap wins exactly once", async () => {
    await api.post(`/api/sessions/${SID}/tasks`, { input: [{ type: "text", text: "task 1" }] });
    await waitFor(() => t.deps.manager.pendingApprovalCount(SID) === 1);
    await api.post(`/api/sessions/${SID}/tasks`, {
      input: [{ type: "text", text: "recalled at the wire" }],
      queueIfBusy: true,
    });
    const [queued] = t.deps.manager.pendingFollowUpsOf(SID);

    // Between drive's idle flip and the drain's locked dequeue lies a microtask-wide gap:
    // the idle task_state broadcast runs its channel listeners synchronously, while the
    // startQueuedFollowUp scheduled right after it only dequeues a promise-chain hop later.
    // A recall enqueued as a microtask from inside the idle broadcast therefore lands
    // exactly in that gap — after the auto-start was scheduled (the queue was still
    // non-empty then), before it shifts the entry. Exactly-one-of must hold: the recall
    // wins, and the drain's under-lock revalidation finds the queue empty and starts nothing.
    const result: { recalled?: { recall: RecallStore }; err?: unknown } = {};
    let fired = false;
    let lastQueued = -1;
    const unsubscribe = t.deps.channels.get(SID).subscribe((evt) => {
      if (evt.event !== "server_event") return;
      const ev = JSON.parse(evt.data) as { type?: string; state?: string; queued?: number };
      if (ev.type !== "task_state") return;
      lastQueued = ev.queued ?? -1;
      if (ev.state !== "idle" || fired) return;
      fired = true;
      queueMicrotask(() => {
        try {
          result.recalled = t.deps.manager.recallFollowUp(SID, queued!.id);
        } catch (e) {
          result.err = e;
        }
      });
    });

    // Finish run 1: drive flips to idle (its broadcast queues the recall) and schedules the
    // auto-start behind it; then give the scheduled drain time to reach its revalidation.
    t.deps.manager.decideApproval(SID, "tc-fu", "allow");
    await waitFor(() => fired && t.deps.manager.statusOf(SID) === "idle");
    await new Promise((resolve) => setTimeout(resolve, 25));
    unsubscribe();

    expect(result.err).toBeUndefined();
    expect(result.recalled?.recall.text).toBe("recalled at the wire");
    // Exactly once: withdrawn, never started — run 1 stays the only run, and nothing is left queued.
    expect(runs).toEqual([["task 1"]]);
    expect(t.deps.manager.pendingFollowUpCount(SID)).toBe(0);
    expect(t.deps.manager.statusOf(SID)).toBe("idle");
    // What another tab sees: the recall's own task_state broadcast already reports the
    // emptied queue, so the entry disappears there without a reload.
    expect(lastQueued).toBe(0);
  });
});
