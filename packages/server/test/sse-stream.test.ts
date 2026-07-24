/**
 * Integration tests for the SSE endpoint (FD-1 / FD-2):
 *   - Subscribing immediately delivers the current task_state snapshot (first
 *     frame, ahead of any pending-approval replay);
 *   - A Last-Event-ID with a mismatched/unknown epoch → sends resync_required
 *     first; a buffer hit → replays events after it.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { approvalDecision, assistantText, toolCall, userText } from "@prismshadow/penguin-core";
import type { ApproveFn, OmniMessage } from "@prismshadow/penguin-core";
import type { SessionRow } from "../src/db/repos/sessions.js";
import type { RuntimeSession } from "../src/runtime/session-manager.js";
import { apiClient, createTestApp, provisionUser, waitFor } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const SID = "session-2026-07-06-10-00-00-aabb0001";

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
  return {
    sessionId,
    toolPermission: () => "rw",
    generateTitle: async () => ({ title: null, usage: null }),
    compactability: () => "ok" as const,
    async *run(_input: OmniMessage[], opts: { approve: ApproveFn; signal: AbortSignal }) {
      const tc = toolCall({ name: "run_command", arguments: "{}", toolCallId: "tc-sse" });
      yield tc;
      const decision = await opts.approve(tc);
      yield approvalDecision(decision, "tc-sse");
      yield assistantText("done");
    },
    async *compact() {},
  };
}

describe("sse-stream", () => {
  let t: TestApp;
  let cookie: string;
  let row: SessionRow;

  beforeEach(async () => {
    t = await createTestApp();
    ({ cookie } = await provisionUser(t.app, "streamer"));
    row = {
      sessionId: SID,
      // streamer's own initial Project (default_project belongs to admin; others
      // get 404 via the index lookup).
      projectId: "streamer-default_project",
      agentId: "default_agent",
      modelId: "m1",
      provider: "custom",
      workspace: "/tmp/w",
      approvalMode: "always-ask",
      title: null,
      createdAt: new Date().toISOString(),
    };
    t.deps.sessionsRepo.insert(row);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  const getStream = (headers: Record<string, string> = {}) =>
    t.app.request(`/api/sessions/${SID}/stream`, { headers: { cookie, ...headers } });

  it("FD-1: a new subscription's first frame is always the task_state snapshot (idle)", async () => {
    const frames = await readSseFrames(await getStream(), 1);
    expect(frames[0]!.event).toBe("server_event");
    expect(JSON.parse(frames[0]!.data)).toEqual({ type: "task_state", state: "idle" });
    expect(frames[0]!.id).toMatch(/^[0-9a-f]{8}-\d+$/); // FD-2: opaque string id
  });

  it("FD-1: subscribing while running receives task_state: running, then pending approvals are replayed", async () => {
    t.deps.manager.adopt(row, approvalFakeSession(SID));
    await t.deps.manager.startTask(SID, [userText("go")]);
    await waitFor(() => t.deps.manager.pendingApprovalCount(SID) === 1);

    const frames = await readSseFrames(await getStream(), 2);
    expect(JSON.parse(frames[0]!.data)).toEqual({ type: "task_state", state: "running" });
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
    expect(JSON.parse(frames[1]!.data)).toEqual({ type: "task_state", state: "idle" });
  });

  it("FD-2: same-epoch Last-Event-ID hitting the buffer → replays later events, then the task_state snapshot", async () => {
    const channel = t.deps.channels.get(SID);
    const first = channel.publish(userText("m1"));
    channel.publish(userText("m2"));
    const frames = await readSseFrames(await getStream({ "Last-Event-ID": first.id }), 2);
    expect(frames[0]!.event).toBeUndefined(); // replayed OmniMessage
    expect((JSON.parse(frames[0]!.data) as { payload: { text: string } }).payload.text).toBe("m2");
    expect(JSON.parse(frames[1]!.data)).toEqual({ type: "task_state", state: "idle" });
  });
});
