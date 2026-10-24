/**
 * The mocked API covers every endpoint the Web App calls: the app's own endpoint wrappers
 * (`packages/web/src/api/endpoints.ts`) are imported with the network layer swapped, as the
 * gallery swaps it, and every one is called against the mock. An endpoint the mock does not
 * route answers with the `gallery_unmocked` code and nothing else does, so that code — and a
 * handler that throws anything but the app's `ApiError` — is what fails here. The URL helpers
 * (file content, downloads) are checked the same way through the fetch path.
 * Transferring a draft's browser pages reports the unavailable browser, as opening a page
 * does: the gallery hosts no desktop browser and must not report a successful transfer.
 * The Agent plugin listing agrees with the installed Skills, hooks and MCP listings, and
 * refuses an unknown Agent with 404.
 */
import { describe, expect, it } from "vitest";
import * as api from "../../web/src/api/endpoints";
import { runTry } from "../../web/src/features/agents/api-try-log";
import type { TryAction } from "../../web/src/features/agents/api-try-log";
import { ApiError, UNMOCKED } from "../src/app/mock/errors";
import { IDS } from "../src/app/mock/ids";
import { answerAsResponse } from "../src/app/mock/fetch-shim";
import { router } from "../src/app/mock/routes";
import { resetStore } from "../src/app/mock/store";

type AnyFn = (...args: unknown[]) => unknown;

/** Every function the wrappers module exports, the key-auth descriptors' included. */
function wrappers(): [name: string, fn: AnyFn][] {
  const found: [string, AnyFn][] = [];
  for (const [name, value] of Object.entries(api)) {
    if (typeof value === "function") found.push([name, value as AnyFn]);
    else if (typeof value === "object" && value !== null) {
      for (const [inner, fn] of Object.entries(value)) {
        if (typeof fn === "function") found.push([`${name}.${inner}`, fn as AnyFn]);
      }
    }
  }
  return found;
}

/** Dummy arguments: ids everywhere; a wrapper reading a field off one gets `undefined`, which its path tolerates. */
const ARGS = ["a", "b", "c", "d", "e", "f"];

describe("the mocked API", () => {
  // One fresh store per wrapper rebuilds every fixture, the Self-evolution transcript and the
  // built-in Benchmarks included, so this case outlasts vitest's 5 s default on the Windows
  // runner; timed out, its loop would keep mutating the store the cases below share.
  it("routes every endpoint the app's wrappers name", { timeout: 30_000 }, async () => {
    const gaps: string[] = [];
    const crashes: string[] = [];
    for (const [name, fn] of wrappers()) {
      resetStore({ lang: "en", signedIn: true });
      let result: unknown;
      try {
        result = await fn(...ARGS);
      } catch (error) {
        if (error instanceof ApiError) {
          if (error.code === UNMOCKED) gaps.push(name);
          continue;
        }
        crashes.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      // A URL helper: the fetch path must answer it too.
      if (typeof result === "string" && result.startsWith("/api/")) {
        const response = await answerAsResponse("GET", result, undefined);
        const body =
          response.status >= 400 ? ((await response.json()) as { error: { code: string } }) : null;
        if (body?.error.code === UNMOCKED) gaps.push(name);
      }
    }
    expect(gaps, "wrappers with no mock route").toEqual([]);
    expect(crashes, "handlers that threw something other than an ApiError").toEqual([]);
    expect(wrappers().length).toBeGreaterThan(150);
  });

  it("answers the real ids with the fixtures, and unknown ids with 404", async () => {
    const store = resetStore({ lang: "zh", signedIn: true });
    const me = await api.getMe();
    expect(me.user.isAdmin).toBe(true);
    expect(me.companyMode).toBe(false);
    const projects = await api.listProjects();
    expect(projects.projects.map((p) => p.projectId)).toEqual([store.f.project.projectId]);
    const agents = await api.listAgents(store.f.project.projectId, null);
    expect(agents.agents.map((a) => a.agentId)).toEqual([
      IDS.agents.docs,
      IDS.agents.notes,
      IDS.agents.general,
    ]);
    const projectId = store.f.project.projectId;
    const agentId = IDS.agents.docs;
    expect(await api.getAgentPlugins(projectId, agentId, null)).toEqual({
      skills: (await api.getAgentSkills(projectId, agentId, null)).skills,
      hooks: (await api.getAgentHooks(projectId, agentId, null)).hooks,
      mcpServers: (await api.getAgentMcpServers(projectId, agentId, null)).servers,
      workbenches: [],
    });
    await expect(api.getAgentPlugins(projectId, "nope", null)).rejects.toMatchObject({
      status: 404,
    });
    await expect(api.getSession("nope")).rejects.toMatchObject({ status: 404, code: "not_found" });
  });

  it("pages a Session list per category with totals, own rows only", async () => {
    const store = resetStore({ lang: "en", signedIn: true });
    const project = store.f.project.projectId;
    const agent = store.f.agents[0]!.agentId;
    const first = await api.listSessions(
      project,
      agent,
      {
        offset: 0,
        limit: 3,
        category: "active",
        withCounts: true,
        excludeOrg: true,
      },
      null,
    );
    expect(first.sessions.length).toBe(3);
    expect(first.counts?.active).toBeGreaterThan(3);
    // Archived by hand, plus the scheduled run, the evaluation nobody kept and the Test Sessions
    // of the self-evolution round; the subagent is in no category, and the kept CLI run is one
    // of the active rows.
    expect(first.counts?.archived).toBe(3 + IDS.sessions.tests.length);
    expect(first.workspaceCounts).toBeDefined();
    const rest = await api.listSessions(
      project,
      agent,
      {
        offset: 3,
        limit: 100,
        category: "active",
      },
      null,
    );
    expect(rest.sessions.length).toBe(first.counts!.active - 3);
    // Newest first, and no row twice across the pages.
    const ids = [...first.sessions, ...rest.sessions].map((s) => s.sessionId);
    expect(new Set(ids).size).toBe(ids.length);
    const archived = await api.listSessions(
      project,
      agent,
      {
        offset: 0,
        limit: 10,
        category: "archived",
      },
      null,
    );
    expect(archived.sessions.every((s) => s.archived)).toBe(true);
    // An organization's desk Session reaches neither the user's own page nor its totals.
    const notes = await api.listSessions(
      project,
      store.f.agents[1]!.agentId,
      {
        offset: 0,
        limit: 10,
        withCounts: true,
        excludeOrg: true,
      },
      null,
    );
    expect(notes.sessions.some((s) => s.client === "org")).toBe(false);
    expect(notes.counts?.active).toBe(notes.sessions.length);
    // Without the flag too, as the server does: a company Session is in no category, so a
    // counted page leaves it out; only the plain list serves it.
    const counted = await api.listSessions(
      project,
      store.f.agents[1]!.agentId,
      {
        offset: 0,
        limit: 10,
        withCounts: true,
      },
      null,
    );
    expect(counted.sessions.some((s) => s.source === "company")).toBe(false);
    expect(counted.counts?.active).toBe(counted.sessions.length);
    const plain = await api.listSessions(project, store.f.agents[1]!.agentId, undefined, null);
    expect(plain.sessions.some((s) => s.source === "company")).toBe(true);
  });

  it("lists the archived rows by group, pages a group, and unarchives and deletes them", async () => {
    const store = resetStore({ lang: "en", signedIn: true });
    const groups = await api.listArchivedSessionGroups();
    const archived = 3 + IDS.sessions.tests.length;
    expect(groups.total).toBe(archived);
    expect(groups.groups.reduce((n, g) => n + g.count, 0)).toBe(archived);
    const temp = groups.groups.find((g) => g.workspace === "temp")!;
    const page = await api.listArchivedSessions({
      projectId: temp.projectId,
      workspace: temp.workspace,
      limit: 10,
    });
    expect(page.sessions.length).toBe(temp.count);
    expect(page.sessions.every((s) => s.archived)).toBe(true);
    const first = page.sessions[0]!.sessionId;
    expect(await api.unarchiveSessions({ sessionIds: [first] })).toEqual({ done: 1, missing: [] });
    expect(store.session(first)?.archived).toBe(false);
    expect((await api.listArchivedSessionGroups()).total).toBe(archived - 1);
    expect(await api.deleteSessions({ filter: { source: "schedule" } })).toEqual({
      done: 1,
      missing: [],
    });
    expect((await api.listArchivedSessionGroups()).total).toBe(archived - 2);
  });

  it("pages the list by last activity with a cursor, as the sidebar asks for it", async () => {
    const store = resetStore({ lang: "en", signedIn: true });
    const project = store.f.project.projectId;
    const agent = store.f.agents[0]!.agentId;
    const opts = { limit: 3, order: "activity" as const, category: "active" as const };
    const first = await api.listSessions(project, agent, opts, null);
    const rest = await api.listSessions(
      project,
      agent,
      {
        ...opts,
        limit: 100,
        before: first.sessions.at(-1)!,
      },
      null,
    );
    const all = await api.listSessions(project, agent, { ...opts, limit: 100 }, null);
    // The two pages are the whole list, in one order and with no row twice.
    expect([...first.sessions, ...rest.sessions].map((s) => s.sessionId)).toEqual(
      all.sessions.map((s) => s.sessionId),
    );
    const stamps = all.sessions.map((s) => s.lastActiveAt);
    expect(stamps).toEqual([...stamps].sort().reverse());
  });

  it("answers the sidebar's batch entry by entry as the list would, an unknown Agent absent", async () => {
    const store = resetStore({ lang: "en", signedIn: true });
    const project = store.f.project.projectId;
    const agent = store.f.agents[0]!.agentId;
    const opts = {
      limit: 3,
      order: "activity" as const,
      category: "active" as const,
      excludeOrg: true,
    };
    const listed = await api.listSessions(project, agent, { ...opts, withCounts: true }, null);
    const batch = await api.batchSessions(
      project,
      [
        { agentId: agent, ...opts, withCounts: true },
        { agentId: "no_such_agent", ...opts },
      ],
      null,
    );
    expect(batch.results).toEqual([
      { agentId: agent, ok: true, ...listed },
      { agentId: "no_such_agent", ok: false, reason: "absent" },
    ]);
  });

  it("serves a running Session's history with its live tail, and a finished one without", async () => {
    const store = resetStore({ lang: "en", signedIn: true });
    const running = store.f.sessions.find((s) => s.status === "running")!;
    const tail = await api.getMessages(running.sessionId, { kind: "tail", limit: 50 });
    expect(tail.page).toEqual({
      earlierTurns: 0,
      prior: expect.objectContaining({ elapsedMs: 0 }),
    });
    expect(tail.live).toBeDefined();
    expect(tail.live!.cursor).toMatch(/^g1-\d+$/);
    const done = store.f.sessions.find((s) => s.status === "idle")!;
    const full = await api.getMessages(done.sessionId);
    expect(full.live).toBeUndefined();
    expect(full.page).toBeUndefined();
    expect(full.messages[0]?.type).toBe("session_meta");
    const older = await api.getMessages(done.sessionId, {
      kind: "before",
      cursor: "1:0",
      limit: 50,
    });
    expect(older.messages).toEqual([]);
  });

  it("signs out on logout and back in on login, refusing the rest in between", async () => {
    resetStore({ lang: "en", signedIn: true });
    await api.logout();
    await expect(api.getMe()).rejects.toMatchObject({ status: 401 });
    await expect(api.getInstall()).resolves.toEqual({ installId: "gallery-demo" });
    await expect(api.login({ userId: "admin", password: "" })).rejects.toMatchObject({
      status: 401,
    });
    const signedIn = await api.login({ userId: "admin", password: "penguin" });
    expect(signedIn.user.userId).toBe("admin");
    await expect(api.getMe()).resolves.toMatchObject({ user: { userId: "admin" } });
  });

  it("mutates the store on writes the app shows", async () => {
    const store = resetStore({ lang: "en", signedIn: true });
    const project = store.f.project.projectId;
    const done = store.f.sessions.find((s) => s.status === "idle")!;
    const renamed = await api.patchSession(done.sessionId, { title: "Renamed" });
    expect(renamed.session.title).toBe("Renamed");
    await api.deleteSession(done.sessionId);
    expect(store.session(done.sessionId)).toBeUndefined();
    const created = await api.createSchedule(
      project,
      store.f.agents[0]!.agentId,
      {
        name: "hourly",
        prompt: "Check the corpus.",
        enabled: true,
        startAt: new Date().toISOString(),
        period: "1h",
      },
      null,
    );
    expect(created.status).toBe("active");
    expect(
      (await api.listSchedules(project, store.f.agents[0]!.agentId, null)).schedules.some(
        (s) => s.name === "hourly",
      ),
    ).toBe(true);
    const models = await api.putDefaultModel(project, {
      provider: "anthropic",
      modelId: "claude-sonnet-5",
    });
    expect(models.defaultModel).toEqual({ provider: "anthropic", modelId: "claude-sonnet-5" });
    expect(store.f.models.models.find((m) => m.isDefault)?.modelId).toBe("claude-sonnet-5");
  });

  it("keeps an Agent's API settings without reaching into an answer the app already holds", async () => {
    const store = resetStore({ lang: "en", signedIn: true });
    const project = store.f.project.projectId;
    const agent = store.f.agents[1]!.agentId;
    const before = await api.getAgentApi(project, agent, null);
    expect(before.api).toMatchObject({ enabled: false, keys: [] });
    const on = await api.putAgentApi(
      project,
      agent,
      { enabled: true, approvalMode: "read-only" },
      null,
    );
    expect(on.api).toMatchObject({ enabled: true, approvalMode: "read-only" });
    expect((await api.listAgents(project, null)).agents[1]!.apiEnabled).toBe(true);
    const created = await api.createAgentApiKey(project, agent, { name: "ci" }, null);
    // The app appends the new key to what it read: the earlier answers must not already hold it.
    expect(before.api.keys).toEqual([]);
    expect(on.api.keys).toEqual([]);
    expect(created.secret.startsWith(created.key.prefix)).toBe(true);
    await api.deleteAgentApiKey(project, agent, created.key.keyId, null);
    expect((await api.getAgentApi(project, agent, null)).api.keys).toEqual([]);
  });

  it("tells an Agent's API tab when the admin has turned the Agent API off server-wide", async () => {
    const store = resetStore({ lang: "en", signedIn: true });
    const project = store.f.project.projectId;
    const agent = store.f.agents[0]!.agentId;
    expect((await api.getAgentApi(project, agent, null)).serverEnabled).toBe(true);
    await api.adminPutSettings({ agentApiEnabled: false });
    expect((await api.getAgentApi(project, agent, null)).serverEnabled).toBe(false);
    expect((await api.putAgentApi(project, agent, { open: true }, null)).serverEnabled).toBe(false);
  });

  it("streams a Try run as the try route does, read by the SDK: the example run, then a continued one", async () => {
    const store = resetStore({ lang: "en", signedIn: true });
    const target = { projectId: store.f.project.projectId, agentId: store.f.agents[0]!.agentId };
    /** One Try run as the panel drives it: the actions it dispatched, by type. */
    const tryOnce = async (body: { input: string; session_id?: string }) => {
      const actions: TryAction[] = [];
      await runTry(target, (a) => actions.push(a), body, new AbortController().signal);
      const kinds = actions.flatMap((a) => {
        if (a.type !== "record") return [];
        const r = a.record;
        return [r.type === "session_meta" ? "session_meta" : (r.payload as { type: string }).type];
      });
      const done = actions.find((a) => a.type === "done");
      const session = actions.find((a) => a.type === "session");
      return { kinds, done, session };
    };

    const first = await tryOnce({ input: "What time is it now?" });
    expect(first.kinds.slice(0, 3)).toEqual(["session_meta", "task_begin", "text"]);
    expect(first.kinds).toContain("tool_call");
    expect(first.kinds).toContain("tool_call_output");
    expect(first.kinds.at(-1)).toBe("task_end");
    expect(first.done).toMatchObject({ result: { status: "completed", requests: 2 } });
    const sessionId = first.session?.type === "session" ? first.session.sessionId : "";

    const next = await tryOnce({ input: "And now?", session_id: sessionId });
    expect(next.kinds).toEqual([
      "task_begin",
      "text",
      "request_begin",
      "text",
      "token_usage",
      "request_end",
      "task_end",
    ]);
    expect(next.session).toMatchObject({ sessionId });
    expect(next.done).toMatchObject({ result: { status: "completed", sessionId } });
  });

  it("serves the group tables a new Project writes, and takes a protocol or a cleared key on any group", async () => {
    const store = resetStore({ lang: "en", signedIn: true });
    const project = store.f.project.projectId;
    const models = await api.getModels(project, null);
    // A gateway row stores nothing of its own and follows its group's table.
    expect(models.providers.openrouter?.baseUrl).toMatch(/^https:\/\//);
    const gateway = models.models.find((m) => m.provider === "openrouter")!;
    expect(gateway.credential?.baseUrl).toBeUndefined();
    expect(gateway.effective.baseUrlSource).toBe("provider");
    // Atria stores its own endpoint in custom, which has no table.
    const atria = models.models.find((m) => m.modelId === "Atria-Dawn")!;
    expect(atria.effective.baseUrlSource).toBe("model");
    // Every group takes a protocol, Penguin Go included.
    const go = await api.putProviderConnection(project, "penguin-go", {
      clientType: "openai-chat",
    });
    expect(go.providers["penguin-go"]?.clientType).toBe("openai-chat");
    // Disconnect clears the group key and leaves the group without one.
    const cleared = await api.putProviderConnection(project, "deepseek", { clearApiKey: true });
    expect(cleared.providers.deepseek?.apiKeyMasked).toBeUndefined();
  });

  it("serves a Workspace file with its version marker through the fetch path", async () => {
    const store = resetStore({ lang: "en", signedIn: true });
    const session = store.f.sessions[0]!.sessionId;
    const response = await answerAsResponse(
      "GET",
      api.workspaceFileUrl(session, "src/rag.ts"),
      undefined,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toMatch(/^".+"$/);
    expect(await response.text()).toContain("buildIndex");
    const missing = await answerAsResponse(
      "GET",
      api.workspaceFileUrl(session, "nope.txt"),
      undefined,
    );
    expect(missing.status).toBe(404);
  });

  it("refuses what needs a server behind it with one code the app turns into a toast", async () => {
    resetStore({ lang: "en", signedIn: true });
    await expect(api.createProject({ projectId: "x" })).rejects.toMatchObject({
      code: "demo_read_only",
    });
    await expect(api.startUpdateJob()).rejects.toMatchObject({ code: "demo_read_only" });
    await expect(api.adoptBuiltinBrowserSession("draft", "saved")).rejects.toMatchObject({
      status: 503,
      code: "browser_unavailable",
    });
  });

  it("names an unrouted request by the one code the coverage test looks for", async () => {
    const store = resetStore({ lang: "en", signedIn: true });
    await expect(
      router.dispatch(store, "GET", "/api/nothing/here", undefined),
    ).rejects.toMatchObject({
      status: 404,
      code: UNMOCKED,
    });
    // A machine's route is this server's route.
    const answer = await router.dispatch(store, "GET", "/server/gpu-box/api/me", undefined);
    expect(answer.kind).toBe("json");
  });
});
