/**
 * Interrupt, then send: POST /api/sessions/:id/tasks with `interrupt`, and POST /interrupt.
 *
 * - Given an idle Session the flag is a no-op: the Task starts at once (`queued: false`).
 * - Given a busy one the run is aborted and the message starts as soon as it settles, ahead of
 *   every follow-up queued before it; interrupts keep their own order among themselves.
 * - Undelivered steering meets the abort as it meets a Stop: it is handed back to the composer.
 * - While the aborted run winds down, the interrupt waits in the queue mirror flagged as one,
 *   and a recall hands back its content.
 * - `interrupt` with `queueIfBusy` or `goal` is a 400; the queue's one cap holds interrupts too.
 * - POST /interrupt sends one waiting message now: a queued follow-up (keeping its id; one
 *   already interrupting stays where it is) or an undelivered steering message. It names
 *   exactly one of them (400 otherwise), and one no longer waiting is a 409.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { approvalDecision, assistantText, toolCall } from "@prismshadow/penguin-core";
import type { ApproveFn, AmspRecord } from "@prismshadow/penguin-core";
import type { TaskCreateResponse } from "../src/api/types.js";
import { adoptSession, fakeSession, uniqueSessionId } from "./fixtures/session.js";
import { apiClient, createTestApp, provisionUser, waitFor } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const PROJECT = "interrupter-default_project";

const texts = (input: AmspRecord[]): string[] =>
  input.map((m) => (m.payload as { text?: string }).text ?? "");

describe("interrupt, then send", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;
  let SID: string;
  /** Each run's input texts, in start order. */
  let runs: string[][];
  /** Runs that saw their signal fire. */
  let aborted: number;
  /** Steering core still holds (delivery is simulated by emptying it). */
  let steered: AmspRecord[][];
  /** What an aborted run waits on before it ends, standing in for tools winding down. */
  let windDown: Promise<void>;

  beforeAll(async () => {
    t = await createTestApp();
    api = apiClient(t.app, (await provisionUser(t.app, "interrupter")).cookie);
  });
  afterAll(async () => {
    await t.cleanup();
  });

  // A Session that parks every run on one approval, so it stays busy until the test decides.
  beforeEach(() => {
    SID = uniqueSessionId();
    runs = [];
    aborted = 0;
    steered = [];
    windDown = Promise.resolve();
    const session = fakeSession(SID, {
      steer: (input: AmspRecord[]) => {
        steered.push(input);
        return true;
      },
      unsteer: (input: AmspRecord[]) => {
        const i = steered.indexOf(input);
        if (i < 0) return false;
        steered.splice(i, 1);
        return true;
      },
      async *run(input: AmspRecord[], opts: { approve: ApproveFn; signal: AbortSignal }) {
        runs.push(texts(input));
        const tc = toolCall({ name: "exec_command", arguments: "{}", toolCallId: "tc-int" });
        yield tc;
        yield approvalDecision(await opts.approve(tc), "tc-int");
        if (opts.signal.aborted) {
          aborted += 1;
          await windDown;
          return;
        }
        yield assistantText("done");
      },
    });
    adoptSession(t.deps, session, { projectId: PROJECT, approvalMode: "always-ask" });
  });

  const post = (text: string, extra: Record<string, unknown> = {}) =>
    api.post(`/api/sessions/${SID}/tasks`, { input: [{ type: "text", text }], ...extra });

  /** Starts the first run and waits until it parks on its approval. */
  async function busy(): Promise<void> {
    await post("task 1");
    await waitFor(() => t.deps.manager.pendingApprovalCount(SID) === 1);
  }

  /** Lets the run in flight finish normally; the next queued message, if any, starts after it. */
  async function allow(): Promise<void> {
    await waitFor(() => t.deps.manager.pendingApprovalCount(SID) === 1);
    t.deps.manager.decideApproval(SID, "tc-int", "allow");
  }

  /** Lets the last run finish and waits for the Session to settle (an idle flip followed by a queued start is too brief to poll for). */
  async function finish(): Promise<void> {
    await allow();
    await waitFor(() => t.deps.manager.statusOf(SID) === "idle");
  }

  it("given an idle Session, an interrupt is an ordinary send", async () => {
    const res = await post("hello", { interrupt: true });
    expect(res.status).toBe(202);
    expect(((await res.json()) as TaskCreateResponse).queued).toBe(false);
    await waitFor(() => runs.length === 1);
    expect(runs).toEqual([["hello"]]);
    expect(aborted).toBe(0);
    await finish();
  });

  it("given a busy Session, it aborts the run and starts first, ahead of earlier follow-ups", async () => {
    await busy();
    await post("queued earlier", { queueIfBusy: true });

    const res = await post("stop and do this", { interrupt: true });
    expect(res.status).toBe(202);
    expect(((await res.json()) as TaskCreateResponse).queued).toBe(true);

    await waitFor(() => runs.length === 2);
    expect(aborted).toBe(1);
    expect(runs[1]).toEqual(["stop and do this"]);
    // The follow-up queued before it still goes out, after it.
    await allow();
    await waitFor(() => runs.length === 3);
    expect(runs[2]).toEqual(["queued earlier"]);
    await finish();
  });

  it("interrupts sent while the run winds down keep their own order", async () => {
    let release!: () => void;
    windDown = new Promise((r) => (release = r));
    await busy();
    await post("first", { interrupt: true });
    await post("second", { interrupt: true });
    await waitFor(() => aborted === 1);
    release();

    await waitFor(() => runs.length === 2);
    expect(runs[1]).toEqual(["first"]);
    await allow();
    await waitFor(() => runs.length === 3);
    expect(runs[2]).toEqual(["second"]);
    await finish();
  });

  it("hands undelivered steering back to the composer, as a Stop does", async () => {
    await busy();
    await api.post(`/api/sessions/${SID}/steer`, { text: "steer 1" });

    await post("now", { interrupt: true });

    await waitFor(() => runs.length === 2);
    expect(runs[1]).toEqual(["now"]);
    expect(t.deps.manager.returnedSteeringOf(SID)).toMatchObject([{ text: "steer 1" }]);
    await finish();
  });

  it("waits in the queue mirror as an interrupt, and a recall hands back its content", async () => {
    let release!: () => void;
    windDown = new Promise((r) => (release = r));
    await busy();
    await post("now", { interrupt: true });
    await waitFor(() => aborted === 1);

    const [waiting] = t.deps.manager.pendingFollowUpsOf(SID);
    expect(waiting).toEqual({
      id: expect.any(String),
      text: "now",
      images: 0,
      files: 0,
      interrupt: true,
    });
    const res = await api.delete(`/api/sessions/${SID}/follow-ups/${waiting!.id}`);
    expect(await res.json()).toEqual({ text: "now", images: [], files: [] });

    release();
    await waitFor(() => t.deps.manager.statusOf(SID) === "idle");
    expect(runs).toHaveLength(1);
  });

  it("cannot be combined with queueIfBusy or goal", async () => {
    expect((await post("x", { interrupt: true, queueIfBusy: true })).status).toBe(400);
    expect((await post("x", { interrupt: true, goal: { budget: -1 } })).status).toBe(400);
    expect(runs).toEqual([]);
  });

  it("is held to the queue's cap like any queued message", async () => {
    await busy();
    for (let n = 0; n < 16; n += 1) await post(`follow-up ${n}`, { queueIfBusy: true });

    const res = await post("now", { interrupt: true });
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("queue_full");
    expect(aborted).toBe(0);
  });

  it("POST /interrupt turns a queued follow-up into an interrupt that keeps its id", async () => {
    let release!: () => void;
    windDown = new Promise((r) => (release = r));
    await busy();
    await post("follow-up 1", { queueIfBusy: true });
    await post("follow-up 2", { queueIfBusy: true });
    const [first, second] = t.deps.manager.pendingFollowUpsOf(SID);

    const res = await api.post(`/api/sessions/${SID}/interrupt`, { followUpId: second!.id });
    expect(res.status).toBe(202);
    await waitFor(() => aborted === 1);
    expect(t.deps.manager.pendingFollowUpsOf(SID).map((f) => [f.id, f.interrupt])).toEqual([
      [second!.id, true],
      [first!.id, undefined],
    ]);

    release();
    await waitFor(() => runs.length === 2);
    expect(runs[1]).toEqual(["follow-up 2"]);
    await allow();
    await waitFor(() => runs.length === 3);
    expect(runs[2]).toEqual(["follow-up 1"]);
    await finish();

    // Started already: nothing left to interrupt with.
    const again = await api.post(`/api/sessions/${SID}/interrupt`, { followUpId: second!.id });
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: { code: string } }).error.code).toBe(
      "follow_up_started",
    );
  });

  it("POST /interrupt on a message already interrupting leaves the order as it is", async () => {
    let release!: () => void;
    windDown = new Promise((r) => (release = r));
    await busy();
    await post("first", { interrupt: true });
    await post("second", { interrupt: true });
    await waitFor(() => aborted === 1);
    const [first, second] = t.deps.manager.pendingFollowUpsOf(SID);

    expect(
      (await api.post(`/api/sessions/${SID}/interrupt`, { followUpId: second!.id })).status,
    ).toBe(202);
    expect(t.deps.manager.pendingFollowUpsOf(SID).map((f) => f.id)).toEqual([
      first!.id,
      second!.id,
    ]);

    release();
    await waitFor(() => runs.length === 2);
    expect(runs[1]).toEqual(["first"]);
    await allow();
    await waitFor(() => runs.length === 3);
    await finish();
  });

  it("POST /interrupt sends one undelivered steering message now; the rest come back", async () => {
    await busy();
    await api.post(`/api/sessions/${SID}/steer`, { text: "steer 1" });
    await api.post(`/api/sessions/${SID}/steer`, { text: "steer 2" });
    const [, second] = t.deps.manager.pendingSteeringOf(SID);

    expect((await api.post(`/api/sessions/${SID}/interrupt`, { steerId: second!.id })).status).toBe(
      202,
    );

    await waitFor(() => runs.length === 2);
    expect(aborted).toBe(1);
    expect(runs[1]).toEqual(["steer 2"]);
    expect(t.deps.manager.returnedSteeringOf(SID)).toMatchObject([{ text: "steer 1" }]);
    await finish();
  });

  it("POST /interrupt on steering the model already took is a 409 not_pending", async () => {
    await busy();
    await api.post(`/api/sessions/${SID}/steer`, { text: "delivered" });
    const [delivered] = t.deps.manager.pendingSteeringOf(SID);
    steered.splice(0); // core took it at a boundary

    const res = await api.post(`/api/sessions/${SID}/interrupt`, { steerId: delivered!.id });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("not_pending");
    expect(aborted).toBe(0);
    await finish();
  });

  it("POST /interrupt names exactly one waiting message", async () => {
    await busy();
    const interrupt = (body: Record<string, unknown>) =>
      api.post(`/api/sessions/${SID}/interrupt`, body);
    expect((await interrupt({})).status).toBe(400);
    expect((await interrupt({ followUpId: null })).status).toBe(400);
    expect((await interrupt({ followUpId: "a", steerId: "b" })).status).toBe(400);
    expect(aborted).toBe(0);
    await finish();
  });
});
