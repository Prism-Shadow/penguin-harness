/**
 * GET|PATCH /api/me/drafts: a user's unsent drafts, kept on the server so they follow the account.
 *
 * - Given two users, when one writes and removes drafts, then GET reads back exactly what that
 *   user wrote and the other user sees none of it.
 * - Given a patch with one bad entry (an unknown kind, a value over the cap, too many entries),
 *   when it is sent, then it is refused whole and nothing in it is stored.
 * - Given an account at its draft bound, when a patch writes one more, then the least recently
 *   written draft outside that patch goes and the new one stays.
 * - Given drafts of a Session and of a Project, when the Session is deleted, then every draft
 *   naming it goes (its composer and its form answers) and no other; when the Project is deleted,
 *   then its new-conversation draft goes too.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DRAFT_VALUE_MAX_CHARS, DRAFTS_PATCH_MAX_ENTRIES } from "../src/api/types.js";
import type {
  DraftsResponse,
  ProjectCreateResponse,
  SessionCreateResponse,
} from "../src/api/types.js";
import { DRAFTS_MAX_COUNT } from "../src/services/user-drafts.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

type Client = ReturnType<typeof apiClient>;

async function draftsOf(api: Client): Promise<Record<string, unknown>> {
  const res = await api.get("/api/me/drafts");
  expect(res.status).toBe(200);
  return ((await res.json()) as DraftsResponse).drafts;
}

describe("/api/me/drafts", () => {
  let t: TestApp;
  let ann: Client;
  let ben: Client;

  beforeEach(async () => {
    t = await createTestApp();
    ann = apiClient(t.app, (await provisionUser(t.app, "ann")).cookie);
    ben = apiClient(t.app, (await provisionUser(t.app, "ben")).cookie);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("stores and removes one user's drafts, out of every other user's sight", async () => {
    const written = await ann.patch("/api/me/drafts", {
      drafts: {
        "chat:ann-default_project": {
          text: "half a sentence",
          modelRef: { provider: "a", modelId: "m" },
        },
        "session:session-1": { text: "reply" },
        "parked:ann-default_project": [{ id: "draft-0000aaaa", savedAt: "", draft: { text: "x" } }],
      },
    });
    expect(written.status).toBe(204);
    expect(
      (await ann.patch("/api/me/drafts", { drafts: { "session:session-1": null } })).status,
    ).toBe(204);

    expect(await draftsOf(ann)).toEqual({
      "chat:ann-default_project": {
        text: "half a sentence",
        modelRef: { provider: "a", modelId: "m" },
      },
      "parked:ann-default_project": [{ id: "draft-0000aaaa", savedAt: "", draft: { text: "x" } }],
    });
    expect(await draftsOf(ben)).toEqual({});
  });

  it("refuses a patch with one bad entry whole, storing none of it", async () => {
    const fine = { "chat:ann-default_project": { text: "kept out" } };
    for (const bad of [
      { "notes:anything": { text: "an unknown kind" } },
      { "session:": { text: "no id" } },
      { "session:session-1": { text: "x".repeat(DRAFT_VALUE_MAX_CHARS) } },
    ]) {
      const res = await ann.patch("/api/me/drafts", { drafts: { ...fine, ...bad } });
      expect(res.status).toBe(400);
    }
    const tooMany = Object.fromEntries(
      Array.from({ length: DRAFTS_PATCH_MAX_ENTRIES + 1 }, (_, i) => [
        `session:s-${i}`,
        { text: "" },
      ]),
    );
    expect((await ann.patch("/api/me/drafts", { drafts: tooMany })).status).toBe(400);
    expect((await ann.patch("/api/me/drafts", { drafts: [] })).status).toBe(400);
    expect(await draftsOf(ann)).toEqual({});
  });

  it("keeps an account within its bound by dropping its least recently written drafts", async () => {
    const key = (i: number) => `session:s-${String(i).padStart(4, "0")}`;
    for (let start = 0; start < DRAFTS_MAX_COUNT; start += DRAFTS_PATCH_MAX_ENTRIES) {
      const batch = Array.from({ length: DRAFTS_PATCH_MAX_ENTRIES }, (_, i) => [
        key(start + i),
        { text: "t" },
      ]);
      expect(
        (await ann.patch("/api/me/drafts", { drafts: Object.fromEntries(batch) })).status,
      ).toBe(204);
    }
    await ann.patch("/api/me/drafts", { drafts: { [key(DRAFTS_MAX_COUNT)]: { text: "newest" } } });

    const kept = await draftsOf(ann);
    expect(Object.keys(kept)).toHaveLength(DRAFTS_MAX_COUNT);
    expect(kept[key(0)]).toBeUndefined();
    expect(kept[key(1)]).toEqual({ text: "t" });
    expect(kept[key(DRAFTS_MAX_COUNT)]).toEqual({ text: "newest" });
  });

  it("drops every draft of a deleted Session, then of a deleted Project", async () => {
    const owner = apiClient(t.app, (await provisionUser(t.app, "cat")).cookie);
    const { project } = (await (
      await owner.post("/api/projects", { projectId: "cat-drafts", name: "drafts" })
    ).json()) as ProjectCreateResponse;
    await owner.put(`/api/projects/${project.projectId}/models`, {
      defaultModel: { provider: "anthropic", modelId: "claude-sonnet-4-6" },
      models: [{ provider: "anthropic", modelId: "claude-sonnet-4-6" }],
    });
    const created = await owner.post(
      `/api/projects/${project.projectId}/agents/default_agent/sessions`,
      {},
    );
    expect(created.status).toBe(201);
    const { session } = (await created.json()) as SessionCreateResponse;

    await owner.patch("/api/me/drafts", {
      drafts: {
        [`session:${session.sessionId}`]: { text: "unsent" },
        [`a2ui:${session.sessionId}:block-1`]: { v: 1, at: 1, state: {} },
        [`chat:${project.projectId}`]: { text: "new conversation" },
        "session:session-elsewhere": { text: "another Session's" },
      },
    });

    expect((await owner.delete(`/api/sessions/${session.sessionId}`)).status).toBe(204);
    expect(Object.keys(await draftsOf(owner)).sort()).toEqual([
      `chat:${project.projectId}`,
      "session:session-elsewhere",
    ]);

    expect((await owner.delete(`/api/projects/${project.projectId}`)).status).toBe(204);
    expect(Object.keys(await draftsOf(owner))).toEqual(["session:session-elsewhere"]);
  });
});
