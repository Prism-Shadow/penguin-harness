/**
 * The Session SSE endpoint (FD-1 / FD-2) and the user event stream.
 *
 * - A new subscription's first frame is always the task_state snapshot: idle when idle; when
 *   running, `running` followed by the replay of pending approvals.
 * - A Last-Event-ID from another epoch gets resync_required first, then the snapshot; one that
 *   hits the replay buffer gets the later events, then the snapshot.
 * - An admin resetting a user's password ends that user's open event streams at once, and the
 *   old session cannot reopen one.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { approvalDecision, assistantText, toolCall, userText } from "@prismshadow/penguin-core";
import type { ApproveFn, OmniMessage } from "@prismshadow/penguin-core";
import type { SessionRow } from "../src/db/repos/sessions.js";
import type { RuntimeSession } from "../src/runtime/session-manager.js";
import { fakeSession, sessionRow, uniqueSessionId } from "./fixtures/session.js";
import { apiClient, createTestApp, loginAdmin, provisionUser, waitFor } from "./helpers.js";
import type { TestApp } from "./helpers.js";

interface SseFrame {
  event?: string;
  id?: string;
  data: string;
}

/** Reads the first `count` frames of an SSE response (skipping heartbeat comment lines), then cancels the stream. */
async function readSseFrames(res: Response, count: number, timeoutMs = 3000): Promise<SseFrame[]> {
  expect(res.status).toBe(200);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const frames: SseFrame[] = [];
  let buf = "";
  const deadline = Date.now() + timeoutMs;
  try {
    while (frames.length < count) {
      if (Date.now() > deadline)
        throw new Error(`SSE read timed out (${frames.length} frames so far)`);
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const raw = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        if (raw.startsWith(":") || raw.trim() === "") continue; // heartbeat/empty frame
        const frame: SseFrame = { data: "" };
        for (const line of raw.split("\n")) {
          if (line.startsWith("event:")) frame.event = line.slice(6).trim();
          else if (line.startsWith("id:")) frame.id = line.slice(3).trim();
          else if (line.startsWith("data:")) frame.data += line.slice(5).trim();
        }
        frames.push(frame);
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return frames;
}

/** Fake Session that requests one approval (for the running state and approval-replay scenarios). */
function approvalFakeSession(sessionId: string): RuntimeSession {
  return fakeSession(sessionId, {
    async *run(_input: OmniMessage[], opts: { approve: ApproveFn; signal: AbortSignal }) {
      const tc = toolCall({ name: "exec_command", arguments: "{}", toolCallId: "tc-sse" });
      yield tc;
      yield approvalDecision(await opts.approve(tc), "tc-sse");
      yield assistantText("done");
    },
  });
}

describe("sse-stream", () => {
  let t: TestApp;
  let cookie: string;
  let SID: string;
  let row: SessionRow;

  beforeAll(async () => {
    t = await createTestApp();
    ({ cookie } = await provisionUser(t.app, "streamer"));
  });
  afterAll(async () => {
    await t.cleanup();
  });
  beforeEach(() => {
    SID = uniqueSessionId();
    // streamer's own initial Project (default_project belongs to admin; others get 404 via
    // the index lookup).
    row = sessionRow(SID, { projectId: "streamer-default_project", approvalMode: "always-ask" });
    t.deps.sessionsRepo.insert(row);
  });

  const getStream = (headers: Record<string, string> = {}) =>
    t.app.request(`/api/sessions/${SID}/stream`, { headers: { cookie, ...headers } });

  it("FD-1: a new subscription's first frame is always the task_state snapshot (idle)", async () => {
    const frames = await readSseFrames(await getStream(), 1);
    expect(frames[0]!.event).toBe("server_event");
    expect(JSON.parse(frames[0]!.data)).toEqual({ type: "task_state", state: "idle", queued: 0 });
    expect(frames[0]!.id).toMatch(/^[0-9a-f]{8}-\d+$/); // FD-2: opaque string id
  });

  it("FD-1: subscribing while running receives task_state: running, then pending approvals are replayed", async () => {
    t.deps.manager.adopt(row, approvalFakeSession(SID));
    await t.deps.manager.startTask(SID, [userText("go")]);
    await waitFor(() => t.deps.manager.pendingApprovalCount(SID) === 1);

    const frames = await readSseFrames(await getStream(), 2);
    expect(JSON.parse(frames[0]!.data)).toEqual({
      type: "task_state",
      state: "running",
      queued: 0,
    });
    const approval = JSON.parse(frames[1]!.data) as {
      type: string;
      toolCall: { payload: { tool_call_id: string } };
    };
    expect(approval.type).toBe("approval_request");
    expect(approval.toolCall.payload.tool_call_id).toBe("tc-sse");

    t.deps.manager.abortTask(SID);
    await waitFor(() => t.deps.manager.statusOf(SID) === "idle");
  });

  it("FD-2: mismatched Last-Event-ID epoch → resync_required first, then the task_state snapshot", async () => {
    t.deps.channels.get(SID).publish(userText("old event"));
    const frames = await readSseFrames(
      await getStream({ "Last-Event-ID": "deadbeef-1" }), // guaranteed to differ from the current channel epoch
      2,
    );
    expect(JSON.parse(frames[0]!.data)).toEqual({ type: "resync_required" });
    expect(JSON.parse(frames[1]!.data)).toEqual({ type: "task_state", state: "idle", queued: 0 });
  });

  it("an admin resetting the password ends the streams that user had open", async () => {
    // Its own user: the reset retires the session it is about.
    const { cookie: own } = await provisionUser(t.app, "reset_streamer");
    const res = await t.app.request("/api/events", { headers: { cookie: own } });
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    // The hello frame proves the subscription is live — and therefore registered — before
    // the reset lands; the ping that follows it is the last of the opening frames.
    let opening = "";
    while (!opening.includes("event: ping")) {
      opening += new TextDecoder().decode((await reader.read()).value);
    }
    expect(opening).toContain("hello");

    const admin = await loginAdmin(t.app);
    const reset = await apiClient(t.app, admin.cookie).post(
      "/api/admin/users/reset_streamer/password",
      { password: "password-456" },
    );
    expect(reset.status).toBe(204);

    // Ended by the reset itself, within the same request: no heartbeat has passed, and the
    // reader has made no request of its own that could have noticed.
    expect((await reader.read()).done).toBe(true);
    expect((await t.app.request("/api/events", { headers: { cookie: own } })).status).toBe(401);
  });

  it("FD-2: same-epoch Last-Event-ID hitting the buffer → replays later events, then the task_state snapshot", async () => {
    const channel = t.deps.channels.get(SID);
    const first = channel.publish(userText("m1"));
    channel.publish(userText("m2"));
    const frames = await readSseFrames(await getStream({ "Last-Event-ID": first.id }), 2);
    expect(frames[0]!.event).toBeUndefined(); // replayed OmniMessage
    expect((JSON.parse(frames[0]!.data) as { payload: { text: string } }).payload.text).toBe("m2");
    expect(JSON.parse(frames[1]!.data)).toEqual({ type: "task_state", state: "idle", queued: 0 });
  });
});
