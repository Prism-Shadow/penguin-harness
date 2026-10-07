/**
 * A Session's source on the server: what kind of conversation each Session is, read from its
 * session_meta (never the index row), and the sessions list's three categories built on it.
 *
 * One app and one Project serve the file; each case works in an Agent of its own, which it
 * deletes on the way out.
 *
 * Scenarios:
 * - Given Sessions of every source, some archived, the list files `user` rows under `active`,
 *   every other source under `background`, and an archived row under `archived` whatever its
 *   source.
 * - Given a category the list no longer has (`subagent`, `schedule`, `benchmark`) or junk,
 *   the list is a 400, never an unfiltered page.
 * - Given the same rows, `counts=1` returns active / background / archived totals over the
 *   whole list whatever the page, the per-Workspace totals sum back to them, and a request
 *   without `counts=1` carries none.
 * - Given more background rows than a page, `category=background` pages by activity cursor,
 *   serving every background row exactly once and no other.
 * - Given a create request, `source: "cli"` creates a `cli` Session and the retired
 *   `benchmark` is accepted as `cli`; a source the server writes itself is a 400 that creates
 *   nothing.
 * - Given a Trace head from before the source was required, after a restart (a registry that
 *   has not seen it) one without a source lists as `active` and reads `user`, one with
 *   `benchmark` lists as `background` and reads `cli`; the startup sweep adopts them the same
 *   way.
 * - Given company mode opening a desk Session (no source, client `org`), the Session is
 *   `user` and keeps its `org` client; a child it spawns is `subagent`, in Background.
 * - Given the scheduler opening a Session, it is `schedule`, in Background.
 * (A fork is `user` whatever it was cut from: session-fork.test.ts.)
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { assistantText, sessionMeta, userText, withOrigin } from "@prismshadow/penguin-core";
import type {
  ProjectCreateResponse,
  SessionCreateResponse,
  SessionResponse,
  SessionsResponse,
} from "../src/api/types.js";
import { apiClient, createTestApp, provisionUser, waitFor, writeTraceFile } from "./helpers.js";
import type { TestApp } from "./helpers.js";
import { adoptSession, fakeSession } from "./fixtures/session.js";

describe("session source", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;
  let projectId: string;
  let agentId: string;
  let cases = 0;
  const base = () => `/api/projects/${projectId}/agents/${agentId}/sessions`;

  beforeAll(async () => {
    t = await createTestApp();
    const { cookie } = await provisionUser(t.app, "source_owner");
    api = apiClient(t.app, cookie);
    const created = (await (
      await api.post("/api/projects", { projectId: "source_owner-src", name: "Source project" })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
  });
  afterAll(async () => {
    await t.cleanup();
  });
  beforeEach(async () => {
    agentId = `case_${++cases}`;
    expect((await api.post(`/api/projects/${projectId}/agents`, { agentId })).status).toBe(201);
  });
  afterEach(async () => {
    await api.delete(`/api/projects/${projectId}/agents/${agentId}`);
  });

  async function configureModels(): Promise<void> {
    const res = await api.put(`/api/projects/${projectId}/models`, {
      defaultModel: { provider: "anthropic", modelId: "claude-sonnet-4-6" },
      models: [{ provider: "anthropic", modelId: "claude-sonnet-4-6", contextWindow: 128000 }],
    });
    expect(res.status).toBe(200);
  }

  const list = async (qs: string) => {
    const res = await api.get(`${base()}${qs}`);
    expect(res.status, qs).toBe(200);
    return (await res.json()) as SessionsResponse;
  };
  const ids = (body: SessionsResponse) => body.sessions.map((s) => s.sessionId);
  const sourceIn = (body: SessionsResponse, sessionId: string) =>
    body.sessions.find((s) => s.sessionId === sessionId)?.source;

  /**
   * A Session created by an earlier process: its index row, and a Trace whose head carries
   * `source` exactly as given (undefined writes no key). Nothing in this process has seen the
   * meta, so the list reads it from the head — the path every row takes after a restart.
   */
  async function seed(
    n: number,
    source: unknown,
    opts: { workspace?: string; archived?: boolean; indexed?: boolean } = {},
  ): Promise<string> {
    const day = String(n).padStart(2, "0");
    // Unique per case as well: the in-process source registry outlives a deleted Agent (ids
    // are never reused in production), so a repeated id would be answered from a stale entry.
    const minute = String(cases).padStart(2, "0");
    const sessionId = `session-2026-07-${day}-09-${minute}-00-5eed${minute}${day}`;
    const stamp = `2026-07-${day}T09:00:00.000Z`;
    const workspace = opts.workspace ?? `/tmp/ws-source-${day}`;
    if (opts.indexed !== false) {
      t.deps.sessionsRepo.insert({
        sessionId,
        projectId,
        agentId,
        provider: "custom",
        modelId: "m-x",
        workspace,
        approvalMode: "allow-all",
        title: null,
        createdAt: stamp,
        lastActiveAt: stamp,
      });
      if (opts.archived) t.deps.sessionsRepo.setArchived(sessionId, stamp);
    }
    const meta = {
      session_id: sessionId,
      model_id: "m-x",
      provider: "custom",
      model_context_window: 1000,
      system_prompt: "",
      agent_state: "/tmp/a",
      workspace,
      ...(source !== undefined ? { source } : {}),
    };
    await writeTraceFile(t.root, projectId, agentId, `2026-07-${day}`, sessionId, 1, [
      sessionMeta(meta as Parameters<typeof sessionMeta>[0]),
      userText(`work ${n}`),
    ]);
    return sessionId;
  }

  /** One row of every source, a pre-source `user` row, a retired `benchmark` row, and two archived ones. */
  async function seedEverySource() {
    return {
      user: await seed(1, "user"),
      legacyUser: await seed(2, undefined),
      api: await seed(3, "api"),
      schedule: await seed(4, "schedule"),
      subagent: await seed(5, "subagent", { workspace: "/tmp/ws-source-shared" }),
      cli: await seed(6, "cli", { workspace: "/tmp/ws-source-shared" }),
      legacyBenchmark: await seed(7, "benchmark"),
      archivedUser: await seed(8, "user", { archived: true }),
      archivedSchedule: await seed(9, "schedule", { archived: true }),
    };
  }

  it("files user rows under active, every other source under background, and archived rows under archived whatever their source", async () => {
    const rows = await seedEverySource();
    expect(new Set(ids(await list("?category=active")))).toEqual(
      new Set([rows.user, rows.legacyUser]),
    );
    expect(new Set(ids(await list("?category=background")))).toEqual(
      new Set([rows.api, rows.schedule, rows.subagent, rows.cli, rows.legacyBenchmark]),
    );
    expect(new Set(ids(await list("?category=archived")))).toEqual(
      new Set([rows.archivedUser, rows.archivedSchedule]),
    );
  });

  it("refuses a category the list no longer has, or junk, rather than serving an unfiltered page", async () => {
    await seed(1, "subagent");
    for (const category of ["subagent", "schedule", "benchmark", "weird"]) {
      expect((await api.get(`${base()}?category=${category}`)).status, category).toBe(400);
    }
  });

  it("counts=1 totals active, background and archived over the whole list, broken down by Workspace", async () => {
    await seedEverySource();
    const counted = await list("?category=active&counts=1&limit=1");
    expect(counted.sessions).toHaveLength(1);
    expect(counted.counts).toEqual({ active: 2, background: 5, archived: 2 });
    // The two background rows sharing a Workspace are counted there together.
    expect(counted.workspaceCounts?.["/tmp/ws-source-shared"]).toEqual({
      active: 0,
      background: 2,
      archived: 0,
    });
    const summed = { active: 0, background: 0, archived: 0 };
    for (const ws of Object.values(counted.workspaceCounts ?? {})) {
      for (const key of Object.keys(summed) as (keyof typeof summed)[]) summed[key] += ws[key];
    }
    expect(summed).toEqual(counted.counts);
    expect((await list("?category=active")).counts).toBeUndefined();
  });

  it("pages category=background by activity cursor, serving every background row once and no other", async () => {
    const background: string[] = [];
    for (let n = 1; n <= 7; n++) {
      // Every third row is a person's conversation, interleaved with the background ones.
      if (n % 3 === 0) await seed(n, "user");
      else background.push(await seed(n, n % 2 === 0 ? "schedule" : "cli"));
    }
    const served: string[] = [];
    let below: { lastActiveAt: string; sessionId: string } | undefined;
    for (;;) {
      const cursor = below
        ? `&before=${encodeURIComponent(`${below.lastActiveAt},${below.sessionId}`)}`
        : "";
      const page = (await list(`?order=activity&category=background&limit=3${cursor}`)).sessions;
      served.push(...page.slice(0, 2).map((s) => s.sessionId));
      if (page.length <= 2) break;
      below = page[1];
    }
    // Newest activity first: the seeded stamps rise with n.
    expect(served).toEqual([...background].reverse());
  });

  it("creates a cli Session for source cli, and accepts the retired benchmark as cli", async () => {
    await configureModels();
    for (const source of ["cli", "benchmark"]) {
      const res = await api.post(base(), { source });
      expect(res.status, source).toBe(201);
      const { session } = (await res.json()) as SessionCreateResponse;
      expect(session.source, source).toBe("cli");
      expect(sourceIn(await list("?category=background"), session.sessionId), source).toBe("cli");
    }
  });

  it("refuses a source the server writes itself, creating nothing", async () => {
    await configureModels();
    for (const source of ["api", "schedule", "subagent", "user"]) {
      expect((await api.post(base(), { source })).status, source).toBe(400);
    }
    expect((await list("")).sessions).toEqual([]);
  });

  it("reads an old Trace head after a restart: no source lists as active user, benchmark as background cli", async () => {
    const legacyUser = await seed(1, undefined);
    const legacyBenchmark = await seed(2, "benchmark");
    const all = await list("");
    expect(sourceIn(all, legacyUser)).toBe("user");
    expect(sourceIn(all, legacyBenchmark)).toBe("cli");
    expect(ids(await list("?category=active"))).toEqual([legacyUser]);
    expect(ids(await list("?category=background"))).toEqual([legacyBenchmark]);
    // The single-session GET reads the same way.
    const single = (await (
      await api.get(`/api/sessions/${legacyBenchmark}`)
    ).json()) as SessionResponse;
    expect(single.session.source).toBe("cli");
  });

  it("adopts an unindexed old Trace with the same reading", async () => {
    const legacyUser = await seed(1, undefined, { indexed: false });
    const legacyBenchmark = await seed(2, "benchmark", { indexed: false });
    const junk = await seed(3, "weird-origin", { indexed: false });
    await t.deps.sessionService.adoptUnmanagedTraceSessions();
    const all = await list("");
    expect(sourceIn(all, legacyUser)).toBe("user");
    expect(sourceIn(all, legacyBenchmark)).toBe("cli");
    expect(sourceIn(all, junk)).toBe("user");
  });

  it("opens a company-mode desk Session as user, keeping its org client", async () => {
    await configureModels();
    // The organization runtime's call: no source, the "org" client.
    const desk = await t.deps.sessionService.createSession({ projectId, agentId, client: "org" });
    const got = (await (
      await api.get(`/api/sessions/${desk.sessionId}`)
    ).json()) as SessionResponse;
    expect(got.session.source).toBe("user");
    expect(got.session.client).toBe("org");
    expect(ids(await list("?category=active"))).toEqual([desk.sessionId]);
  });

  it("files a child a desk Session spawns under Background as subagent", async () => {
    const childId = "session-2026-07-20-09-00-00-c41d0001";
    const deskId = "session-2026-07-20-08-00-00-de5c0001";
    adoptSession(
      t.deps,
      fakeSession(deskId, {
        async *run() {
          // Core's spawn site writes the child's meta; it reaches the desk with its origin.
          yield withOrigin(
            sessionMeta({
              session_id: childId,
              model_id: "m-child",
              provider: "custom",
              model_context_window: 1000,
              system_prompt: "",
              agent_state: `${t.root}/${projectId}/agents/${agentId}/agent_state`,
              workspace: "/tmp/ws-desk",
              source: "subagent",
            }),
            childId,
          );
          yield withOrigin(assistantText("child done"), childId);
          yield assistantText("done");
        },
      }),
      { projectId, agentId, client: "org", workspace: "/tmp/ws-desk" },
    );
    await t.deps.manager.startTask(deskId, [userText("go")]);
    await waitFor(() => t.deps.manager.statusOf(deskId) === "idle");
    const background = await list("?category=background");
    expect(ids(background)).toEqual([childId]);
    expect(sourceIn(background, childId)).toBe("subagent");
    expect(background.sessions[0]!.client).toBe("org");
  });

  it("opens a scheduled task's Session as schedule, in Background", async () => {
    await configureModels();
    // The scheduler's call (new-session mode).
    const info = await t.deps.sessionService.createSession({
      projectId,
      agentId,
      source: "schedule",
    });
    expect(info.source).toBe("schedule");
    expect(sourceIn(await list("?category=background"), info.sessionId)).toBe("schedule");
    // Read from session_meta, never from the index row, which stores no source.
    const row = t.deps.sessionsRepo.findById(info.sessionId);
    expect(row !== null && "source" in row).toBe(false);
  });
});
