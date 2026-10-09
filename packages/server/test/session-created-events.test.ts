/**
 * `session_created` on the user channel: the list learns about rows it did not make.
 *
 * A Session created by the CLI, another tab, a schedule or an agent spawning a child goes
 * through the same route as one created from the list, and the list never heard about it.
 * `session_state` and `session_title` cannot stand in: both act on a row the list already
 * holds. So this event is what makes a Session appear without a reload.
 *
 * - A new Session reaches the Project's owner and members with its ids and its source (`user`
 *   for one a person opens), and nobody else.
 * - The event is published after the row is in place, so a reader who reloads on it finds it.
 * - A title set by PATCH (the CLI's --title, another tab's rename) is announced to the same
 *   audience.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type {
  ProjectCreateResponse,
  ServerEvent,
  SessionCreateResponse,
} from "../src/api/types.js";
import { userChannelKey } from "../src/http/routes/events.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

/** A client that has GET /api/events open: what the publish side checks for. */
function inbox(t: TestApp, userId: string): ServerEvent[] {
  const events: ServerEvent[] = [];
  t.deps.channels.get(userChannelKey(userId)).subscribe((evt) => {
    if (evt.event === "server_event") events.push(JSON.parse(evt.data) as ServerEvent);
  });
  return events;
}

const created = (events: ServerEvent[]) =>
  events.flatMap((e) => (e.type === "session_created" ? [e] : []));

describe("session_created on the user channel", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let projectId: string;
  let boxes: { owner: ServerEvent[]; member: ServerEvent[]; stranger: ServerEvent[] };

  beforeAll(async () => {
    t = await createTestApp();
    const a = await provisionUser(t.app, "owner");
    await provisionUser(t.app, "member");
    await provisionUser(t.app, "stranger");
    owner = apiClient(t.app, a.cookie);
    const res = (await (
      await owner.post("/api/projects", { projectId: "owner-live", name: "project" })
    ).json()) as ProjectCreateResponse;
    projectId = res.project.projectId;
    await owner.post(`/api/projects/${projectId}/members`, { userId: "member" });
    await owner.put(`/api/projects/${projectId}/models`, {
      defaultModel: { provider: "anthropic", modelId: "claude-sonnet-4-6" },
      models: [{ provider: "anthropic", modelId: "claude-sonnet-4-6", contextWindow: 128000 }],
    });
  });
  afterAll(async () => {
    await t.cleanup();
  });
  beforeEach(() => {
    boxes = {
      owner: inbox(t, "owner"),
      member: inbox(t, "member"),
      stranger: inbox(t, "stranger"),
    };
  });

  it("reaches the Project's owner and members with the new row's ids and source, and nobody else", async () => {
    const res = (await (
      await owner.post(`/api/projects/${projectId}/agents/default_agent/sessions`, {})
    ).json()) as SessionCreateResponse;
    const sessionId = res.session.sessionId;

    for (const who of ["owner", "member"] as const) {
      const got = created(boxes[who]);
      expect(got, who).toHaveLength(1);
      // The event names the Session's source as its meta records it, the same as the row.
      expect(got[0]).toMatchObject({
        projectId,
        agentId: "default_agent",
        sessionId,
        source: res.session.source,
      });
      expect(res.session.source).toBe("user");
    }
    expect(created(boxes.stranger)).toHaveLength(0);
  });

  it("is published after the row is in place, so a reader who reloads on it finds the row", async () => {
    let seenAtPublish: boolean | null = null;
    t.deps.channels.get(userChannelKey("owner")).subscribe((evt) => {
      if (evt.event !== "server_event") return;
      const ev = JSON.parse(evt.data) as ServerEvent;
      if (ev.type === "session_created") {
        seenAtPublish = t.deps.sessionsRepo.findById(ev.sessionId) !== null;
      }
    });
    await owner.post(`/api/projects/${projectId}/agents/default_agent/sessions`, {});
    expect(seenAtPublish).toBe(true);
  });

  it("a title set by PATCH is announced too — the CLI's --title, another tab's rename", async () => {
    const res = (await (
      await owner.post(`/api/projects/${projectId}/agents/default_agent/sessions`, {})
    ).json()) as SessionCreateResponse;
    const sessionId = res.session.sessionId;
    await owner.patch(`/api/sessions/${sessionId}`, { title: "made by the CLI" });
    const titles = (events: ServerEvent[]) =>
      events.flatMap((e) => (e.type === "session_title" ? [e] : []));
    for (const who of ["owner", "member"] as const) {
      expect(titles(boxes[who]), who).toEqual([
        { type: "session_title", sessionId, title: "made by the CLI" },
      ]);
    }
    expect(titles(boxes.stranger)).toHaveLength(0);
  });
});
