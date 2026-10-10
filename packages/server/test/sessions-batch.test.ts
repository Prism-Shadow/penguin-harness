/**
 * POST /api/projects/:projectId/sessions/batch: the sidebar's whole reload in one request,
 * every (Agent, page) pair answered on its own.
 *
 * One app and one Project serve the file; two Agents hold a handful of rows, and an Agent
 * that does not exist stands in for one this server does not host.
 *
 * Scenarios:
 * - Given entries for several Agents, the answers come back one per entry in request order
 *   (a repeated Agent stays repeated), each the page the Agent-level list serves for the
 *   same order, cursor, offset, filters and counts.
 * - Given an Agent this server does not host, its entry is `absent` and the others are still
 *   answered.
 * - Given an Agent whose index cannot be read, its entry is `error` (never an empty page) and
 *   the others are still answered.
 * - Given one malformed entry among good ones — a bad Agent id, a limit outside 1–1000, a
 *   cursor outside activity order, beside an offset or malformed, an unknown order or
 *   category, an empty Workspace group, a flag that is not a boolean — or a body with no
 *   entry list, the whole request is a 400.
 * - Given 256 entries, every one is answered; 257 is a 400.
 * - Given no session, the request is a 401; given a user with no access to the Project, it
 *   is the 404 a Project that does not exist answers.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type {
  ProjectCreateResponse,
  SessionBatchPageRequest,
  SessionsBatchResponse,
  SessionsResponse,
} from "../src/api/types.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const A1 = "batch_a1";
const A2 = "batch_a2";
const GHOST = "batch_ghost";
const STAMP = "2026-07-01T08:00:00.000Z";

describe("POST /api/projects/:projectId/sessions/batch", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;
  let projectId: string;
  const batchPath = () => `/api/projects/${projectId}/sessions/batch`;

  /** Inserted straight into the index: the list reads only the stored rows. */
  const seed = (agentId: string, sessionId: string, createdAt: string, lastActiveAt: string) =>
    t.deps.sessionsRepo.insert({
      sessionId,
      projectId,
      agentId,
      provider: "custom",
      modelId: "m-x",
      workspace: `/tmp/ws-${agentId}`,
      approvalMode: "allow-all",
      title: null,
      createdAt,
      lastActiveAt,
    });

  beforeAll(async () => {
    t = await createTestApp();
    const { cookie } = await provisionUser(t.app, "alice");
    api = apiClient(t.app, cookie);
    const created = (await (
      await api.post("/api/projects", { projectId: "alice-batch", name: "batch project" })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
    for (const agentId of [A1, A2]) {
      expect((await api.post(`/api/projects/${projectId}/agents`, { agentId })).status).toBe(201);
    }
    // a1: created in one order, run in another, one of them archived; a2: two rows.
    seed(A1, "session-b1-old", "2026-07-01T08:00:00.000Z", "2026-07-09T08:00:00.000Z");
    seed(A1, "session-b1-mid", "2026-07-02T08:00:00.000Z", "2026-07-05T08:00:00.000Z");
    seed(A1, "session-b1-new", "2026-07-03T08:00:00.000Z", "2026-07-03T08:00:00.000Z");
    seed(A1, "session-b1-arch", "2026-07-04T08:00:00.000Z", "2026-07-04T08:00:00.000Z");
    t.deps.sessionsRepo.setArchived("session-b1-arch", "2026-07-10T08:00:00.000Z");
    seed(A2, "session-b2-one", "2026-07-01T09:00:00.000Z", "2026-07-01T09:00:00.000Z");
    seed(A2, "session-b2-two", "2026-07-02T09:00:00.000Z", "2026-07-02T09:00:00.000Z");
  });
  afterAll(async () => {
    await t.cleanup();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function batch(requests: unknown): Promise<SessionsBatchResponse> {
    const res = await api.post(batchPath(), { requests });
    expect(res.status).toBe(200);
    return (await res.json()) as SessionsBatchResponse;
  }

  /** The Agent-level list's answer for the same knobs, in its query form. */
  async function listed(agentId: string, qs: string): Promise<SessionsResponse> {
    const res = await api.get(`/api/projects/${projectId}/agents/${agentId}/sessions?${qs}`);
    expect(res.status, qs).toBe(200);
    return (await res.json()) as SessionsResponse;
  }

  it("answers one entry per page in request order, each the page the Agent-level list serves", async () => {
    const cursor = { lastActiveAt: "2026-07-09T08:00:00.000Z", sessionId: "session-b1-old" };
    const { results } = await batch([
      {
        agentId: A1,
        limit: 2,
        order: "activity",
        category: "active",
        withCounts: true,
        excludeOrg: true,
      },
      { agentId: A2, limit: 1, offset: 1 },
      { agentId: A1, limit: 5, order: "activity", before: cursor, category: "active" },
      { agentId: A1, limit: 5, order: "activity", category: "archived" },
    ] satisfies SessionBatchPageRequest[]);
    const below = encodeURIComponent(`${cursor.lastActiveAt},${cursor.sessionId}`);
    expect(results).toEqual([
      {
        agentId: A1,
        ok: true,
        ...(await listed(A1, "limit=2&order=activity&category=active&counts=1&excludeOrg=1")),
      },
      { agentId: A2, ok: true, ...(await listed(A2, "limit=1&offset=1")) },
      {
        agentId: A1,
        ok: true,
        ...(await listed(A1, `limit=5&order=activity&before=${below}&category=active`)),
      },
      { agentId: A1, ok: true, ...(await listed(A1, "limit=5&order=activity&category=archived")) },
    ]);
    // The pages are real ones, not empty agreements: the run-last row leads the activity order,
    // the cursor continues below it, and the archived folder holds its one row.
    const ids = results.map((r) => (r.ok ? r.sessions.map((s) => s.sessionId) : null));
    expect(ids).toEqual([
      ["session-b1-old", "session-b1-mid"],
      ["session-b2-one"],
      ["session-b1-mid", "session-b1-new"],
      ["session-b1-arch"],
    ]);
  });

  it("answers an Agent this server does not host as absent, and still answers the rest", async () => {
    const { results } = await batch([
      { agentId: A1, limit: 1 },
      { agentId: GHOST, limit: 1 },
      { agentId: A2, limit: 1 },
    ]);
    expect(results.map((r) => (r.ok ? r.agentId : `${r.agentId}:${r.reason}`))).toEqual([
      A1,
      `${GHOST}:absent`,
      A2,
    ]);
    expect(results[1]).toEqual({ agentId: GHOST, ok: false, reason: "absent" });
  });

  it("answers an Agent whose index cannot be read as an error, never as an empty page", async () => {
    const index = t.deps.sessionsRepo;
    const read = index.listByAgent.bind(index);
    vi.spyOn(index, "listByAgent").mockImplementation((p, agentId) => {
      if (agentId === A2) throw new Error("database disk image is malformed");
      return read(p, agentId);
    });
    const { results } = await batch([
      { agentId: A1, limit: 1 },
      { agentId: A2, limit: 1 },
      { agentId: A1, limit: 1, offset: 1 },
    ]);
    expect(results[1]).toEqual({ agentId: A2, ok: false, reason: "error" });
    expect(results.filter((r) => r.ok).map((r) => r.agentId)).toEqual([A1, A1]);
  });

  const good = { agentId: A1, limit: 1 };
  it.each([
    ["no entry list", { batch: [good] }],
    ["an entry list that is not an array", { requests: A1 }],
    ["an entry that is not an object", { requests: [good, null] }],
    ["an Agent id that is a path", { requests: [good, { agentId: "../a", limit: 1 }] }],
    ["no Agent id", { requests: [good, { limit: 1 }] }],
    ["no limit", { requests: [good, { agentId: A1 }] }],
    ["a limit of 0", { requests: [good, { agentId: A1, limit: 0 }] }],
    ["a limit over 1000", { requests: [good, { agentId: A1, limit: 1001 }] }],
    ["a limit that is not an integer", { requests: [good, { agentId: A1, limit: 1.5 }] }],
    ["a negative offset", { requests: [good, { agentId: A1, limit: 1, offset: -1 }] }],
    ["an unknown order", { requests: [good, { agentId: A1, limit: 1, order: "recent" }] }],
    [
      "a cursor in creation order",
      {
        requests: [
          good,
          { agentId: A1, limit: 1, before: { lastActiveAt: STAMP, sessionId: "s" } },
        ],
      },
    ],
    [
      "a cursor beside an offset",
      {
        requests: [
          good,
          {
            agentId: A1,
            limit: 1,
            order: "activity",
            offset: 0,
            before: { lastActiveAt: STAMP, sessionId: "s" },
          },
        ],
      },
    ],
    [
      "a cursor whose stamp is not a date",
      {
        requests: [
          good,
          {
            agentId: A1,
            limit: 1,
            order: "activity",
            before: { lastActiveAt: "yesterday", sessionId: "s" },
          },
        ],
      },
    ],
    [
      "a cursor whose id is not a valid id",
      {
        requests: [
          good,
          {
            agentId: A1,
            limit: 1,
            order: "activity",
            before: { lastActiveAt: STAMP, sessionId: "../s" },
          },
        ],
      },
    ],
    [
      "a cursor in the query's string form",
      {
        requests: [good, { agentId: A1, limit: 1, order: "activity", before: `${STAMP},s` }],
      },
    ],
    ["an unknown category", { requests: [good, { agentId: A1, limit: 1, category: "all" }] }],
    [
      "an empty Workspace group",
      { requests: [good, { agentId: A1, limit: 1, workspaceGroup: " " }] },
    ],
    [
      "a flag that is not a boolean",
      { requests: [good, { agentId: A1, limit: 1, withCounts: "1" }] },
    ],
  ])("refuses the whole request with a 400 for %s", async (_, body) => {
    const res = await api.post(batchPath(), body);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("bad_request");
  });

  it("answers 256 entries, and refuses 257 with a 400", async () => {
    const full = await batch(Array.from({ length: 256 }, () => ({ agentId: A2, limit: 1 })));
    expect(full.results).toHaveLength(256);
    expect(full.results.every((r) => r.ok && r.sessions.length === 1)).toBe(true);
    const over = await api.post(batchPath(), {
      requests: Array.from({ length: 257 }, () => ({ agentId: A2, limit: 1 })),
    });
    expect(over.status).toBe(400);
  });

  it("is a 401 without a session, and a 404 project_not_found for a user outside the Project", async () => {
    const anonymous = await t.app.request(batchPath(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requests: [good] }),
    });
    expect(anonymous.status).toBe(401);
    const { cookie } = await provisionUser(t.app, "bob");
    const outsider = await apiClient(t.app, cookie).post(batchPath(), { requests: [good] });
    expect(outsider.status).toBe(404);
    expect(((await outsider.json()) as { error: { code: string } }).error.code).toBe(
      "project_not_found",
    );
  });
});
