/**
 * POST /api/sessions/:id/tasks with `steerIfBusy`: one request that does what the Session's
 * state calls for, decided under the Session lock.
 *
 * - Given an idle Session, the input starts a Task (`queued: false`, not steered).
 * - Given a running Task, the input is handed to it as steering (`steered: true`, no Task of its
 *   own): core receives it, the steering mirror lists it, and a file attachment rides it as an
 *   `[attached file: …]` line and comes back with a recall.
 * - Given a compaction, which has no Task to steer, or a run that no longer takes steering, the
 *   input is queued (`queued: true`) and starts as a Task once the Session is idle.
 * - With `interrupt` or `goal` it is a 400; with `queueIfBusy` it is accepted.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { approvalDecision, assistantText, toolCall } from "@prismshadow/penguin-core";
import type { ApproveFn, AmspRecord } from "@prismshadow/penguin-core";
import type { RecalledMessageResponse, TaskCreateResponse } from "../src/api/types.js";
import { adoptSession, fakeSession, uniqueSessionId } from "./fixtures/session.js";
import { apiClient, createTestApp, provisionUser, waitFor } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const PROJECT = "steerifbusy-default_project";

const texts = (input: AmspRecord[]): string[] =>
  input.map((m) => (m.payload as { text?: string }).text ?? "");

describe("steer if busy", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;
  let SID: string;
  /** Each run's input texts, in start order. */
  let runs: string[][];
  /** Steering core holds. */
  let steered: AmspRecord[][];
  /** Whether core takes steering right now (false: the run is settling). */
  let takesSteering: boolean;
  /** What a compaction waits on before it ends. */
  let compactGate: Promise<void>;

  beforeAll(async () => {
    t = await createTestApp();
    api = apiClient(t.app, (await provisionUser(t.app, "steerifbusy")).cookie);
  });
  afterAll(async () => {
    await t.cleanup();
  });

  // A Session that parks every run on one approval, so it stays busy until the test decides.
  beforeEach(() => {
    SID = uniqueSessionId();
    runs = [];
    steered = [];
    takesSteering = true;
    compactGate = Promise.resolve();
    const session = fakeSession(SID, {
      steer: (input: AmspRecord[]) => {
        if (!takesSteering) return false;
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
        const tc = toolCall({ name: "exec_command", arguments: "{}", toolCallId: "tc-sib" });
        yield tc;
        yield approvalDecision(await opts.approve(tc), "tc-sib");
        yield assistantText("done");
      },
      async *compact() {
        await compactGate;
      },
    });
    adoptSession(t.deps, session, { projectId: PROJECT, approvalMode: "always-ask" });
  });

  const post = (input: Record<string, unknown>[], extra: Record<string, unknown> = {}) =>
    api.post(`/api/sessions/${SID}/tasks`, { input, steerIfBusy: true, ...extra });
  const say = (text: string, extra: Record<string, unknown> = {}) =>
    post([{ type: "text", text }], extra);

  /** Starts the first run and waits until it parks on its approval. */
  async function busy(): Promise<void> {
    const res = await api.post(`/api/sessions/${SID}/tasks`, {
      input: [{ type: "text", text: "task 1" }],
    });
    expect(res.status).toBe(202);
    await waitFor(() => t.deps.manager.pendingApprovalCount(SID) === 1);
  }

  /** Lets the run in flight finish; the next queued message, if any, starts after it. */
  async function allow(): Promise<void> {
    await waitFor(() => t.deps.manager.pendingApprovalCount(SID) === 1);
    t.deps.manager.decideApproval(SID, "tc-sib", "allow");
  }

  it("given an idle Session, the input starts a Task", async () => {
    const res = await say("hello");
    expect(res.status).toBe(202);
    const body = (await res.json()) as TaskCreateResponse;
    expect(body.queued).toBe(false);
    expect(body.steered).toBeUndefined();
    await waitFor(() => runs.length === 1);
    expect(runs).toEqual([["hello"]]);
    expect(steered).toEqual([]);

    await allow();
    await waitFor(() => t.deps.manager.statusOf(SID) === "idle");
  });

  it("given a running Task, the input reaches it as steering, attachments included, and starts no Task", async () => {
    await busy();
    const res = await post([
      { type: "text", text: "focus on tests" },
      {
        type: "file",
        fileName: "notes.txt",
        dataUrl: `data:text/plain;base64,${Buffer.from("remember this").toString("base64")}`,
      },
    ]);
    expect(res.status).toBe(202);
    expect((await res.json()) as TaskCreateResponse).toEqual({
      sessionId: SID,
      queued: false,
      steered: true,
    });

    expect(steered).toHaveLength(1);
    const [text] = texts(steered[0]!);
    expect(text).toContain("focus on tests");
    expect(text).toMatch(/\[attached file: .*notes\.txt\]/);
    const [pending] = t.deps.manager.pendingSteeringOf(SID);
    expect(pending).toMatchObject({ text: "focus on tests", images: 0, files: 1 });
    expect(t.deps.manager.pendingFollowUpCount(SID)).toBe(0);

    // A recall hands the message back as it was sent, the file with it.
    const recalled = await api.delete(`/api/sessions/${SID}/steer/${pending!.id}`);
    expect(recalled.status).toBe(200);
    const content = (await recalled.json()) as RecalledMessageResponse;
    expect(content.text).toBe("focus on tests");
    expect(content.files.map((f) => f.fileName)).toEqual(["notes.txt"]);
    expect(steered).toEqual([]);

    await allow();
    await waitFor(() => t.deps.manager.statusOf(SID) === "idle");
    expect(runs).toEqual([["task 1"]]);
  });

  it("given a compaction, the input is queued and starts as a Task once the Session is idle", async () => {
    let release!: () => void;
    compactGate = new Promise<void>((resolve) => (release = resolve));
    expect((await api.post(`/api/sessions/${SID}/compact`, {})).status).toBe(202);
    expect(t.deps.manager.statusOf(SID)).toBe("compacting");

    const res = await say("after the compaction");
    expect(res.status).toBe(202);
    const body = (await res.json()) as TaskCreateResponse;
    expect(body.queued).toBe(true);
    expect(body.steered).toBeUndefined();
    expect(steered).toEqual([]);

    release();
    await waitFor(() => runs.length === 1);
    expect(runs).toEqual([["after the compaction"]]);
    await allow();
    await waitFor(() => t.deps.manager.statusOf(SID) === "idle");
  });

  it("given a run that no longer takes steering, the input is queued and follows it", async () => {
    await busy();
    takesSteering = false;

    const res = await say("next");
    expect(res.status).toBe(202);
    expect(((await res.json()) as TaskCreateResponse).queued).toBe(true);
    expect(t.deps.manager.pendingSteeringOf(SID)).toEqual([]);

    await allow();
    await waitFor(() => runs.length === 2);
    expect(runs).toEqual([["task 1"], ["next"]]);
    await allow();
    await waitFor(() => t.deps.manager.statusOf(SID) === "idle");
  });

  it("cannot be combined with interrupt or goal; with queueIfBusy it is accepted", async () => {
    expect((await say("x", { interrupt: true })).status).toBe(400);
    expect((await say("x", { goal: { budget: -1 } })).status).toBe(400);
    expect(runs).toEqual([]);

    await busy();
    const res = await say("steer me", { queueIfBusy: true });
    expect(res.status).toBe(202);
    expect(((await res.json()) as TaskCreateResponse).steered).toBe(true);
    expect(steered.map(texts)).toEqual([["steer me"]]);

    await allow();
    await waitFor(() => t.deps.manager.statusOf(SID) === "idle");
  });
});
