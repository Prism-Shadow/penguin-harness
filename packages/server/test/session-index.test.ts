/**
 * Integration tests for the Session index: creation (default model / workspace
 * guard), listing (DB union Trace directory discovery), PATCH approval mode,
 * and createdAt parsing.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sessionMeta, userText } from "@prismshadow/penguin-core";
import type { SessionMetaPayload } from "@prismshadow/penguin-core";
import type {
  ProjectCreateResponse,
  SessionCreateResponse,
  SessionResponse,
  SessionsResponse,
} from "../src/api/types.js";
import { sessionIdCreatedAt } from "../src/services/session-service.js";
import { apiClient, createTestApp, provisionUser, writeTraceFile } from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("session-index", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;
  let projectId: string;
  const base = () => `/api/projects/${projectId}/agents/default_agent/sessions`;

  beforeEach(async () => {
    t = await createTestApp();
    const { cookie } = await provisionUser(t.app, "alice");
    api = apiClient(t.app, cookie);
    const created = (await (
      await api.post("/api/projects", { projectId: "alice-index", name: "test project" })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
  });
  afterEach(async () => {
    await t.cleanup();
  });

  async function configureModels(): Promise<void> {
    const res = await api.put(`/api/projects/${projectId}/models`, {
      defaultModel: { provider: "anthropic", modelId: "claude-sonnet-4-6" },
      models: [{ provider: "anthropic", modelId: "claude-sonnet-4-6", contextWindow: 128000 }],
    });
    expect(res.status).toBe(200);
  }

  it("creating a Session with no default model configured → 400 no_default_model", async () => {
    // A newly created Project comes with a default model preset: first replace
    // the whole table to clear it (omitting defaultModel + the original default
    // absent from models = removes default_model), then verify the
    // no-default-model error path.
    const cleared = await api.put(`/api/projects/${projectId}/models`, {
      models: [{ provider: "custom", modelId: "m-no-default" }],
    });
    expect(cleared.status).toBe(200);
    const res = await api.post(base(), {});
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("no_default_model");
  });

  it("creating a Session when the model has no usable credential → 400 model_credential_missing", async () => {
    // A model using the OpenAI protocol: the SDK requires a credential as soon as
    // the client is constructed. Clear the environment variable key so none is
    // available — the error must carry an **error code** (the frontend renders
    // localized text from the code, not by parsing the message text).
    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      await api.put(`/api/projects/${projectId}/models`, {
        defaultModel: { provider: "custom", modelId: "no-key-model" },
        models: [{ provider: "custom", modelId: "no-key-model", clientType: "openai" }],
      });
      const res = await api.post(base(), {});
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe("model_credential_missing");
      // The raw SDK message (littered with the env var name) must not leak.
      expect(body.error.message).not.toMatch(/OPENAI_API_KEY/);
      expect(body.error.message).toContain("no-key-model");
    } finally {
      if (prev !== undefined) process.env.OPENAI_API_KEY = prev;
    }
  });

  it("creating a Session: auto temp Workspace by default, allow-all default, shows in the list", async () => {
    await configureModels();
    const res = await api.post(base(), {});
    expect(res.status).toBe(201);
    const { session } = (await res.json()) as SessionCreateResponse;
    expect(session.sessionId).toMatch(/^session-\d{4}-/);
    expect(session.modelId).toBe("claude-sonnet-4-6");
    expect(session.approvalMode).toBe("allow-all");
    expect(session.status).toBe("idle");
    expect(session.hasTrace).toBe(false);
    // The temporary Workspace lives inside this Agent's workspaces directory.
    expect(session.workspace).toContain(
      path.join(projectId, "agents", "default_agent", "workspaces"),
    );

    const list = (await (await api.get(base())).json()) as SessionsResponse;
    expect(list.sessions.map((s) => s.sessionId)).toContain(session.sessionId);
  });

  it("schedule-created Session: source derives from session_meta (registry), never from the DB row; user sessions carry none", async () => {
    await configureModels();
    // The scheduler goes through SessionService.createSession directly (no HTTP route exposes source).
    const info = await t.deps.sessionService.createSession({
      projectId,
      agentId: "default_agent",
      source: "schedule",
    });
    expect(info.source).toBe("schedule");
    // The index row stores no origin: session_meta is the single source of truth.
    const row = t.deps.sessionsRepo.findById(info.sessionId);
    expect(row && "source" in row).toBe(false);
    expect(t.deps.sessionSources.get(info.sessionId)).toBe("schedule");

    // A user-created session (HTTP) has no source, and the list surfaces both accordingly.
    const res = await api.post(base(), {});
    expect(res.status).toBe(201);
    const { session: plain } = (await res.json()) as SessionCreateResponse;
    const list = (await (await api.get(base())).json()) as SessionsResponse;
    expect(list.sessions.find((s) => s.sessionId === info.sessionId)?.source).toBe("schedule");
    expect(list.sessions.find((s) => s.sessionId === plain.sessionId)?.source).toBeUndefined();
  });

  it("source survives a restart via the Trace head: an indexed row unknown to this process derives it lazily from session_meta", async () => {
    await configureModels();
    // Simulate a Session created by a previous process: the index row exists, but the
    // in-process registry has never seen it — only its Trace's session_meta knows the origin.
    const sid = "session-2026-07-02-09-00-00-feedc0de";
    t.deps.sessionsRepo.insert({
      sessionId: sid,
      projectId,
      agentId: "default_agent",
      provider: "custom",
      modelId: "m-x",
      workspace: "/tmp/w-restart",
      approvalMode: "allow-all",
      title: null,
      createdAt: "2026-07-02T09:00:00.000Z",
    });
    const meta: SessionMetaPayload = {
      session_id: sid,
      model_id: "m-x",
      provider: "custom",
      model_context_window: 1000,
      system_prompt: "",
      tools: [],
      thinking_level: "default",
      agent_state: "/tmp/a",
      workspace: "/tmp/w-restart",
      source: "subagent",
    };
    await writeTraceFile(t.root, projectId, "default_agent", "2026-07-02", sid, 1, [
      sessionMeta(meta),
      userText("child work"),
    ]);
    const list = (await (await api.get(base())).json()) as SessionsResponse;
    expect(list.sessions.find((s) => s.sessionId === sid)?.source).toBe("subagent");
    // The single-session endpoint derives it the same way (and the second read hits the registry).
    const single = (await (await api.get(`/api/sessions/${sid}`)).json()) as SessionResponse;
    expect(single.session.source).toBe("subagent");
  });

  it("adoption derives source from the Trace meta, narrowing junk values to user-created", async () => {
    await configureModels();
    // Discovered (no index row) with a valid origin: adoption records it.
    const adopted = "session-2026-07-03-10-00-00-0badf00d";
    const sourced: SessionMetaPayload = {
      session_id: adopted,
      model_id: "m-cli",
      provider: "custom",
      model_context_window: 1000,
      system_prompt: "",
      tools: [],
      thinking_level: "default",
      agent_state: "/tmp/a",
      workspace: "/tmp/w-cli",
      source: "schedule",
    };
    await writeTraceFile(t.root, projectId, "default_agent", "2026-07-03", adopted, 1, [
      sessionMeta(sourced),
      userText("adopted"),
    ]);
    // Discovered with a junk source (untrusted on-disk data): narrowed to user-created.
    const junk = "session-2026-07-03-11-00-00-0badf00e";
    const junkMeta = {
      ...sourced,
      session_id: junk,
      source: "weird-origin",
    } as unknown as SessionMetaPayload;
    await writeTraceFile(t.root, projectId, "default_agent", "2026-07-03", junk, 1, [
      sessionMeta(junkMeta),
      userText("junk"),
    ]);
    const list = (await (await api.get(base())).json()) as SessionsResponse;
    expect(list.sessions.find((s) => s.sessionId === adopted)?.source).toBe("schedule");
    expect(list.sessions.find((s) => s.sessionId === junk)?.source).toBeUndefined();
  });

  it("list paging: limit/offset slice the newest-first list; absent params keep the full list; invalid values 400", async () => {
    await configureModels();
    // Three sessions with distinct createdAt ordering (insert directly for deterministic times).
    const mk = (n: number) => ({
      sessionId: `session-2026-07-0${n}-08-00-00-aaaa000${n}`,
      projectId,
      agentId: "default_agent",
      provider: "custom",
      modelId: "m-page",
      workspace: `/tmp/w-${n}`,
      approvalMode: "allow-all" as const,
      title: null,
      createdAt: `2026-07-0${n}T08:00:00.000Z`,
    });
    for (const n of [1, 2, 3]) t.deps.sessionsRepo.insert(mk(n));

    const ids = async (qs: string) => {
      const res = await api.get(`${base()}${qs}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as SessionsResponse;
      return body.sessions.map((s) => s.sessionId);
    };
    const all = await ids("");
    expect(all).toEqual([mk(3).sessionId, mk(2).sessionId, mk(1).sessionId]); // newest first, unpaged
    expect(await ids("?limit=2")).toEqual(all.slice(0, 2));
    expect(await ids("?limit=2&offset=2")).toEqual(all.slice(2));
    expect(await ids("?limit=2&offset=9")).toEqual([]); // past the end: empty page, not an error
    // The sidebar's limit+1 trick: one extra row answers "has more" without an envelope change.
    expect((await ids("?limit=3")).length).toBe(3);

    for (const bad of ["?limit=0", "?limit=-1", "?limit=abc", "?limit=1001", "?offset=1"]) {
      expect((await api.get(`${base()}${bad}`)).status, bad).toBe(400);
    }
    expect((await api.get(`${base()}?limit=2&offset=-1`)).status).toBe(400);
  });

  it("category filter: each sidebar bucket lists only its rows, paging applies within the category, counts return full totals", async () => {
    await configureModels();
    // Two active user Sessions + one archived (HTTP), two schedule-created (service, one
    // then archived — archived must win over the origin), and one subagent Session whose
    // source only exists in its Trace head (cold-registry derivation during the walk).
    const mkUser = async () =>
      ((await (await api.post(base(), {})).json()) as SessionCreateResponse).session.sessionId;
    const activeA = await mkUser();
    const activeB = await mkUser();
    const archivedC = await mkUser();
    expect((await api.patch(`/api/sessions/${archivedC}`, { archived: true })).status).toBe(200);
    const mkSchedule = async () =>
      (
        await t.deps.sessionService.createSession({
          projectId,
          agentId: "default_agent",
          source: "schedule",
        })
      ).sessionId;
    const scheduleD = await mkSchedule();
    const archivedScheduleF = await mkSchedule();
    expect((await api.patch(`/api/sessions/${archivedScheduleF}`, { archived: true })).status).toBe(
      200,
    );
    const subagentE = "session-2026-07-02-09-30-00-cafe0001";
    t.deps.sessionsRepo.insert({
      sessionId: subagentE,
      projectId,
      agentId: "default_agent",
      provider: "custom",
      modelId: "m-x",
      workspace: "/tmp/w-sub",
      approvalMode: "allow-all",
      title: null,
      createdAt: "2026-07-02T09:30:00.000Z",
    });
    await writeTraceFile(t.root, projectId, "default_agent", "2026-07-02", subagentE, 1, [
      sessionMeta({
        session_id: subagentE,
        model_id: "m-x",
        provider: "custom",
        model_context_window: 1000,
        system_prompt: "",
        tools: [],
        thinking_level: "default",
        agent_state: "/tmp/a",
        workspace: "/tmp/w-sub",
        source: "subagent",
      }),
      userText("child work"),
    ]);

    const list = async (qs: string) => {
      const res = await api.get(`${base()}${qs}`);
      expect(res.status, qs).toBe(200);
      return (await res.json()) as SessionsResponse;
    };
    const idSet = (body: SessionsResponse) => new Set(body.sessions.map((s) => s.sessionId));

    expect(idSet(await list("?category=active"))).toEqual(new Set([activeA, activeB]));
    expect(idSet(await list("?category=schedule"))).toEqual(new Set([scheduleD]));
    expect(idSet(await list("?category=subagent"))).toEqual(new Set([subagentE]));
    expect(idSet(await list("?category=archived"))).toEqual(
      new Set([archivedC, archivedScheduleF]),
    );

    // Paging applies within the category: the two archived rows page one at a time.
    const page1 = await list("?category=archived&limit=1&offset=0");
    const page2 = await list("?category=archived&limit=1&offset=1");
    expect(page1.sessions).toHaveLength(1);
    expect(page2.sessions).toHaveLength(1);
    expect(new Set([...idSet(page1), ...idSet(page2)])).toEqual(
      new Set([archivedC, archivedScheduleF]),
    );
    expect((await list("?category=archived&limit=1&offset=2")).sessions).toEqual([]);

    // counts=1 returns totals over the whole list, not the returned page — with or without a filter.
    const counted = await list("?category=active&counts=1&limit=1");
    expect(counted.sessions).toHaveLength(1);
    expect(counted.counts).toEqual({ active: 2, subagent: 1, schedule: 1, archived: 2 });
    const full = await list("?counts=1");
    expect(full.sessions).toHaveLength(6);
    expect(full.counts).toEqual({ active: 2, subagent: 1, schedule: 1, archived: 2 });
    expect((await list("")).counts).toBeUndefined();

    // Junk values are rejected, never silently unfiltered.
    expect((await api.get(`${base()}?category=weird`)).status).toBe(400);
    expect((await api.get(`${base()}?counts=yes`)).status).toBe(400);
  });

  it("half a model reference is 400: the missing half is never inferred", async () => {
    await configureModels();
    // Only modelId: even though it names the one configured model, the provider is never
    // filled in for the caller — a reference is submitted as a pair or not at all.
    const onlyModel = await api.post(base(), { modelId: "claude-sonnet-4-6" });
    expect(onlyModel.status).toBe(400);
    const onlyProvider = await api.post(base(), { provider: "anthropic" });
    expect(onlyProvider.status).toBe(400);
    // The complete pair works, and so does omitting both (Project default).
    expect(
      (await api.post(base(), { provider: "anthropic", modelId: "claude-sonnet-4-6" })).status,
    ).toBe(201);
    expect((await api.post(base(), {})).status).toBe(201);
  });

  it("an explicit Workspace only needs to exist; it may live outside the Project directory", async () => {
    await configureModels();
    const inside = path.join(t.root, projectId, "my-workdir");
    await fs.mkdir(inside, { recursive: true });
    const ok = await api.post(base(), { workspace: inside });
    expect(ok.status).toBe(201);
    const { session } = (await ok.json()) as SessionCreateResponse;
    expect(session.workspace).toBe(await fs.realpath(inside));

    // An existing directory outside the Project directory is likewise allowed (reachability is left to file permissions).
    const outside = path.join(t.root, "not-a-project");
    await fs.mkdir(outside, { recursive: true });
    const okOutside = await api.post(base(), { workspace: outside });
    expect(okOutside.status).toBe(201);

    // A nonexistent directory is still 400 (not auto-created).
    expect(
      (await api.post(base(), { workspace: path.join(t.root, projectId, "ghost") })).status,
    ).toBe(400);
  });

  it("list union: Trace directory discovery finds unmanaged Sessions and backfills index rows", async () => {
    await configureModels();
    const discovered = "session-2026-07-01-08-30-00-deadbeef";
    const meta: SessionMetaPayload = {
      session_id: discovered,
      model_id: "cli-model",
      provider: "custom",
      model_context_window: 1000,
      system_prompt: "",
      tools: [],
      thinking_level: "default",
      agent_state: "/tmp/a",
      workspace: "/tmp/cli-workspace",
    };
    await writeTraceFile(t.root, projectId, "default_agent", "2026-07-01", discovered, 1, [
      sessionMeta(meta),
      userText("cli session"),
    ]);

    const list = (await (await api.get(base())).json()) as SessionsResponse;
    const found = list.sessions.find((s) => s.sessionId === discovered);
    expect(found).toBeDefined();
    expect(found!.modelId).toBe("cli-model");
    expect(found!.workspace).toBe("/tmp/cli-workspace");
    expect(found!.approvalMode).toBe("allow-all");
    expect(found!.hasTrace).toBe(true);
    expect(found!.createdAt).toBe(sessionIdCreatedAt(discovered));

    // Already indexed: visible via the single-lookup endpoint.
    const single = await api.get(`/api/sessions/${discovered}`);
    expect(single.status).toBe(200);
  });

  it("DELETE Session: clears the index row and every Trace shard; the list doesn't resurrect it; re-delete 404", async () => {
    await configureModels();
    const { session } = (await (await api.post(base(), {})).json()) as SessionCreateResponse;
    const sessionId = session.sessionId;
    // Create a Trace spanning multiple dated shards: deletion must clear all of
    // them, or the listing's directory discovery would resurrect the session.
    const meta: SessionMetaPayload = {
      session_id: sessionId,
      model_id: "anthropic/claude-sonnet-4-6",
      provider: "custom",
      model_context_window: 1000,
      system_prompt: "",
      tools: [],
      thinking_level: "default",
      agent_state: "/tmp/a",
      workspace: session.workspace,
    };
    const f1 = await writeTraceFile(
      t.root,
      projectId,
      "default_agent",
      "2026-07-01",
      sessionId,
      1,
      [sessionMeta(meta), userText("round one")],
    );
    const f2 = await writeTraceFile(
      t.root,
      projectId,
      "default_agent",
      "2026-07-02",
      sessionId,
      2,
      [sessionMeta(meta), userText("round two")],
    );

    const del = await api.delete(`/api/sessions/${sessionId}`);
    expect(del.status).toBe(204);

    await expect(fs.stat(f1)).rejects.toThrow();
    await expect(fs.stat(f2)).rejects.toThrow();

    const list = (await (await api.get(base())).json()) as SessionsResponse;
    expect(list.sessions.map((s) => s.sessionId)).not.toContain(sessionId);
    expect((await api.delete(`/api/sessions/${sessionId}`)).status).toBe(404);
    expect((await api.get(`/api/sessions/${sessionId}`)).status).toBe(404);
  });

  it("DELETE Session: the Workspace directory is not removed (user-supplied directories must survive)", async () => {
    await configureModels();
    const inside = path.join(t.root, projectId, "keep-me");
    await fs.mkdir(inside, { recursive: true });
    const { session } = (await (
      await api.post(base(), { workspace: inside })
    ).json()) as SessionCreateResponse;

    expect((await api.delete(`/api/sessions/${session.sessionId}`)).status).toBe(204);
    expect((await fs.stat(inside)).isDirectory()).toBe(true);
  });

  it("the list is sorted by createdAt descending", async () => {
    await configureModels();
    const older = "session-2020-01-01-00-00-00-00000001";
    await writeTraceFile(t.root, projectId, "default_agent", "2020-01-01", older, 1, [
      sessionMeta({
        session_id: older,
        model_id: "m",
        provider: "custom",
        model_context_window: 1,
        system_prompt: "",
        tools: [],
        thinking_level: "default",
        agent_state: "/a",
        workspace: "/w",
      }),
    ]);
    const created = (await (await api.post(base(), {})).json()) as SessionCreateResponse;
    const list = (await (await api.get(base())).json()) as SessionsResponse;
    expect(list.sessions[0]!.sessionId).toBe(created.session.sessionId);
    expect(list.sessions[list.sessions.length - 1]!.sessionId).toBe(older);
  });

  it("PATCH approval mode persists and reads back", async () => {
    await configureModels();
    const { session } = (await (await api.post(base(), {})).json()) as SessionCreateResponse;
    // Change from the default allow-all to a different mode, to confirm it's actually persisted.
    const patched = await api.patch(`/api/sessions/${session.sessionId}`, {
      approvalMode: "always-ask",
    });
    expect(patched.status).toBe(200);
    const got = (await (
      await api.get(`/api/sessions/${session.sessionId}`)
    ).json()) as SessionResponse;
    expect(got.session.approvalMode).toBe("always-ask");
    // An invalid mode returns 400.
    expect(
      (await api.patch(`/api/sessions/${session.sessionId}`, { approvalMode: "sometimes" })).status,
    ).toBe(400);
  });

  it("insertOrIgnore is idempotent: concurrent first discovery of one Session doesn't throw on the UNIQUE constraint", async () => {
    const row = {
      sessionId: "session-2026-07-02-00-00-00-11223344",
      projectId,
      agentId: "default_agent",
      modelId: "cli-model",
      provider: "custom",
      workspace: "/tmp/w",
      approvalMode: "always-ask" as const,
      title: null,
      createdAt: new Date().toISOString(),
    };
    t.deps.sessionsRepo.insertOrIgnore(row);
    // A second insert with different fields for the same id: silently ignored, no throw, first-inserted value is kept.
    expect(() =>
      t.deps.sessionsRepo.insertOrIgnore({ ...row, modelId: "other-model" }),
    ).not.toThrow();
    expect(t.deps.sessionsRepo.findById(row.sessionId)!.modelId).toBe("cli-model");
  });

  it("sessionIdCreatedAt: invalid formats return null", () => {
    expect(sessionIdCreatedAt("session-2026-07-01-08-30-00-deadbeef")).toBe(
      new Date(2026, 6, 1, 8, 30, 0).toISOString(),
    );
    expect(sessionIdCreatedAt("not-a-session")).toBeNull();
  });
});
