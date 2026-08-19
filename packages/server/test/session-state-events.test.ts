/**
 * `session_state` on the user channel: the run-state flip a Session list can act on.
 *
 * The per-Session `task_state` event is session-scoped and deliberately carries no id, so it
 * only ever reaches the one conversation a client has subscribed to. This is its user-channel
 * counterpart — named by `sessionId`, carrying the row stamp — and what these tests pin is its
 * SCOPE: it reaches the Project's owner and its members, and nobody else, not even a logged-in
 * user with a live channel of their own.
 *
 * The unchanged shape of `task_state` itself is pinned by sse-stream.test.ts, which compares
 * the frame with `toEqual` and would fail the moment an id appeared on it.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assistantText } from "@prismshadow/penguin-core";
import type { ServerEvent } from "../src/api/types.js";
import type { SessionRow } from "../src/db/repos/sessions.js";
import { userChannelKey } from "../src/http/routes/events.js";
import type { RuntimeSession } from "../src/runtime/session-manager.js";
import { apiClient, createTestApp, provisionUser, waitFor } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const SID = "session-2026-08-19-10-00-00-abcd0001";
const PROJECT = "owner-default_project";
/** Comfortably before the run: the run-end stamp must be visibly later than this. */
const INSERTED_AT = "2026-08-19T09:00:00.000Z";

/** Fake Session that answers once and returns, so a run is one clean running → idle pair. */
function quickFakeSession(sessionId: string): RuntimeSession {
  return {
    sessionId,
    toolPermission: () => "rw",
    generateTitle: async () => ({ title: null, usage: null }),
    compactability: () => "ok" as const,
    steer: () => false,
    skipReconnectWait: () => false,
    async *run() {
      yield assistantText("done");
    },
    async *compact() {},
  };
}

/** Everything one user's channel received, as a connected client would see it. */
function inbox(t: TestApp, userId: string) {
  const events: ServerEvent[] = [];
  // `get`, not `peek`: this stands in for a client that has opened GET /api/events, which is
  // exactly the condition the publish side checks for.
  t.deps.channels.get(userChannelKey(userId)).subscribe((evt) => {
    if (evt.event === "server_event") events.push(JSON.parse(evt.data) as ServerEvent);
  });
  const states = () => events.flatMap((e) => (e.type === "session_state" ? [e] : []));
  return { events, states, run: () => states().map((e) => e.state) };
}

describe("session_state on the user channel", () => {
  let t: TestApp;
  let owner: { cookie: string };
  let boxes: { owner: ReturnType<typeof inbox>; member: ReturnType<typeof inbox> };
  let stranger: ReturnType<typeof inbox>;

  beforeEach(async () => {
    t = await createTestApp();
    owner = await provisionUser(t.app, "owner");
    await provisionUser(t.app, "member");
    // A logged-in user with their own Project and their own live channel, granted nothing here.
    await provisionUser(t.app, "stranger");
    expect(
      (
        await apiClient(t.app, owner.cookie).post(`/api/projects/${PROJECT}/members`, {
          userId: "member",
        })
      ).status,
    ).toBe(201);

    const row: SessionRow = {
      sessionId: SID,
      projectId: PROJECT,
      agentId: "default_agent",
      provider: "custom",
      modelId: "m1",
      workspace: "/tmp/w",
      approvalMode: "allow-all",
      title: null,
      createdAt: INSERTED_AT,
      lastActiveAt: INSERTED_AT,
    };
    t.deps.sessionsRepo.insert(row);
    t.deps.manager.adopt(row, quickFakeSession(SID));

    // Subscribe before anything runs: `peek` on the publish side means a channel that does not
    // exist is skipped, so the test has to be listening the way a real client would be.
    boxes = { owner: inbox(t, "owner"), member: inbox(t, "member") };
    stranger = inbox(t, "stranger");
  });
  afterEach(async () => {
    await t.cleanup();
  });

  const runTask = async () => {
    const res = await apiClient(t.app, owner.cookie).post(`/api/sessions/${SID}/tasks`, {
      input: [{ type: "text", text: "go" }],
    });
    expect(res.status).toBe(202);
    await waitFor(() => boxes.owner.run().at(-1) === "idle");
  };

  it("reaches the Project's owner and its members, and no other user", async () => {
    await runTask();
    expect(boxes.owner.run()).toEqual(["running", "idle"]);
    expect(boxes.member.run()).toEqual(["running", "idle"]);
    // The stranger's channel exists and is being listened to — it simply is never published to.
    expect(stranger.events).toEqual([]);
  });

  it("names the Session and carries the row stamp a list fetch would return", async () => {
    await runTask();
    const settled = boxes.owner.states().at(-1)!;
    expect(settled.sessionId).toBe(SID);
    expect(settled.state).toBe("idle");
    // Read back from the DB, not reconstructed: a client can trust this against its read
    // marker, which is what makes "finished while I was elsewhere" legible as unread.
    expect(settled.lastActiveAt).toBe(t.deps.sessionsRepo.findById(SID)!.lastActiveAt);
    expect(Date.parse(settled.lastActiveAt)).toBeGreaterThan(Date.parse(INSERTED_AT));
  });

  it("says nothing about the composer state the Session channel owns", async () => {
    await runTask();
    // queued / pendingSteering belong to the conversation being watched, not to a list row.
    for (const e of boxes.owner.states()) {
      expect(Object.keys(e).sort()).toEqual(["lastActiveAt", "sessionId", "state", "type"]);
    }
  });

  it("a member removed from the Project stops hearing about its Sessions", async () => {
    expect(
      (await apiClient(t.app, owner.cookie).delete(`/api/projects/${PROJECT}/members/member`))
        .status,
    ).toBe(204);
    await runTask();
    expect(boxes.owner.run()).toEqual(["running", "idle"]);
    expect(boxes.member.events).toEqual([]);
  });
});
