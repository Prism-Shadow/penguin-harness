/**
 * The follow-up queue: POST /api/sessions/:id/tasks with `queueIfBusy`, and its recall.
 *
 * - Given an idle Session the flag is a no-op (`queued: false`, the task starts at once);
 *   given a busy one the input is held server-side (`queued: true`, where a plain POST is a
 *   409) and auto-starts as an ordinary task once the current run finishes.
 * - A queued follow-up can be recalled with its content, and then never starts; one already
 *   started (or recalled) answers 409 `follow_up_started`.
 * - The SSE subscribe snapshot carries the queued list, so a reloaded page can still recall.
 * - A recall racing the auto-start in the idle gap wins exactly once: nothing starts.
 * - One queued follow-up starts exactly one task, whether the run before it completes or is
 *   aborted.
 * - A follow-up queued straight through the manager (the messaging bridge's door) is
 *   recallable the same way.
 *
 * The queued count on task_state events is covered by the session-manager suite.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { approvalDecision, assistantText, toolCall, userText } from "@prismshadow/penguin-core";
import type { ApproveFn, OmniMessage } from "@prismshadow/penguin-core";
import type { TaskCreateResponse } from "../src/api/types.js";
import type { RecallStore } from "../src/runtime/session-manager.js";
import { adoptSession, fakeSession, uniqueSessionId } from "./fixtures/session.js";
import { apiClient, createTestApp, provisionUser, waitFor } from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("follow-up queue route", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;
  let SID: string;
  let runs: string[][];

  beforeAll(async () => {
    t = await createTestApp();
    api = apiClient(t.app, (await provisionUser(t.app, "queuer")).cookie);
  });
  afterAll(async () => {
    await t.cleanup();
  });

  // A Session that parks on one approval per run (keeping the Task running) and records each
  // run's input.
  beforeEach(() => {
    SID = uniqueSessionId();
    runs = [];
    const session = fakeSession(SID, {
      async *run(input: OmniMessage[], opts: { approve: ApproveFn; signal: AbortSignal }) {
        runs.push(input.map((m) => (m.payload as { text?: string }).text ?? ""));
        const tc = toolCall({ name: "exec_command", arguments: "{}", toolCallId: "tc-fu" });
        yield tc;
        yield approvalDecision(await opts.approve(tc), "tc-fu");
        yield assistantText("done");
      },
    });
    adoptSession(t.deps, session, {
      projectId: "queuer-default_project",
      approvalMode: "always-ask",
    });
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

  it("recall (#287): DELETE withdraws a queued follow-up with its content; the rest auto-start", async () => {
    await api.post(`/api/sessions/${SID}/tasks`, { input: [{ type: "text", text: "task 1" }] });
    await waitFor(() => t.deps.manager.pendingApprovalCount(SID) === 1);

    const png = "data:image/png;base64,AAAA";
    await api.post(`/api/sessions/${SID}/tasks`, {
      input: [
        { type: "text", text: "follow-up 1" },
        { type: "image_url", imageUrl: png },
      ],
      queueIfBusy: true,
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

    // The recall returns the original content.
    const res = await api.delete(`/api/sessions/${SID}/follow-ups/${pending[0]!.id}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: "follow-up 1", images: [png], files: [] });
    expect(t.deps.manager.pendingFollowUpCount(SID)).toBe(1);

    // Recalled means never started: only the remaining follow-up auto-starts.
    t.deps.manager.decideApproval(SID, "tc-fu", "allow");
    await waitFor(() => runs.length === 2);
    expect(runs[1]).toEqual(["follow-up 2"]);

    // Gone (recalled or auto-started) → 409 follow_up_started, steering's not_pending being
    // a different sentence to the user.
    const again = await api.delete(`/api/sessions/${SID}/follow-ups/${pending[0]!.id}`);
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: { code: string } }).error.code).toBe(
      "follow_up_started",
    );

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

  it("one queued follow-up starts exactly one task, whether the run completes or is aborted", async () => {
    // The whole point of the queue: a message posted while a Task runs is delivered once.
    // drive's finally is the only drain trigger and it shifts under the session lock, so a
    // run's end can never launch the same queued input twice — pin that for both ways a run
    // can end, each with something actually queued behind it (a queued follow-up
    // deliberately survives an abort of the run under way).
    await api.post(`/api/sessions/${SID}/tasks`, { input: [{ type: "text", text: "task 1" }] });
    await waitFor(() => t.deps.manager.pendingApprovalCount(SID) === 1);
    await api.post(`/api/sessions/${SID}/tasks`, {
      input: [{ type: "text", text: "after a finish" }],
      queueIfBusy: true,
    });
    expect(t.deps.manager.pendingFollowUpCount(SID)).toBe(1);

    // Run 1 completes: the follow-up becomes run 2 and the queue empties.
    t.deps.manager.decideApproval(SID, "tc-fu", "allow");
    await waitFor(() => runs.length === 2);
    expect(t.deps.manager.pendingFollowUpCount(SID)).toBe(0);

    // Queue behind run 2, then abort it rather than letting it finish — the other exit from
    // drive's finally, this time with a queue to drain. The abort discards the run under
    // way, never the tasks queued behind it, so exactly one third run starts.
    await waitFor(() => t.deps.manager.pendingApprovalCount(SID) === 1);
    await api.post(`/api/sessions/${SID}/tasks`, {
      input: [{ type: "text", text: "after an abort" }],
      queueIfBusy: true,
    });
    expect(t.deps.manager.pendingFollowUpCount(SID)).toBe(1);
    await api.post(`/api/sessions/${SID}/abort`, {});
    await waitFor(() => runs.length === 3);
    // Settle window: a second launch rides the same lock chain and would land well inside it.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(runs).toEqual([["task 1"], ["after a finish"], ["after an abort"]]);
    expect(t.deps.manager.pendingFollowUpCount(SID)).toBe(0);

    // Settle the last run so teardown does not race it.
    await waitFor(() => t.deps.manager.pendingApprovalCount(SID) === 1);
    t.deps.manager.decideApproval(SID, "tc-fu", "allow");
    await waitFor(() => t.deps.manager.statusOf(SID) === "idle");
  });

  it("recall (#287) works on a follow-up queued straight through the manager (the messaging bridge's path)", async () => {
    await api.post(`/api/sessions/${SID}/tasks`, { input: [{ type: "text", text: "task 1" }] });
    await waitFor(() => t.deps.manager.pendingApprovalCount(SID) === 1);

    // What the messaging bridge does with a text-only Feishu/Telegram message on a busy
    // Session: the manager API directly, with no recall store of its own (a message that
    // wrote file attachments supplies one, because their on-disk paths are the half the
    // input does not carry). The queued entry must still show its content and still be
    // recallable — a queued message's recallability cannot depend on which door it came
    // through.
    const queued = await t.deps.manager.startTask(SID, [userText("from the chat channel")], {
      queueIfBusy: true,
    });
    expect(queued.queued).toBe(true);
    const pending = t.deps.manager.pendingFollowUpsOf(SID);
    expect(pending).toEqual([
      { id: expect.any(String), text: "from the chat channel", images: 0, files: 0 },
    ]);

    const res = await api.delete(`/api/sessions/${SID}/follow-ups/${pending[0]!.id}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: "from the chat channel", images: [], files: [] });
    expect(t.deps.manager.pendingFollowUpCount(SID)).toBe(0);

    // Recalled means never started: run 1 stays the only run.
    t.deps.manager.decideApproval(SID, "tc-fu", "allow");
    await waitFor(() => t.deps.manager.statusOf(SID) === "idle");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(runs).toEqual([["task 1"]]);
  });
});
