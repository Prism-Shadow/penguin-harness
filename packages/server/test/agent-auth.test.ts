/**
 * The Agent auth service over its repo, the declarative role tree (`ROLE_TREE`), and the HTTP
 * surface's route-id gate: the grant a session runs under is expanded from the role tree and
 * extra grants at the Agent's CURRENT generation, so a role or grant change hot-reloads without
 * re-issue and no stale grant outlives one request.
 */
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { Bind, Component, wire } from "@prismshadow/penguin-core/kernel";
import type { ClassCtx } from "@prismshadow/penguin-core/kernel";
import { AgentAuthService, AgentAuthPermissionProvider } from "../src/auth/agent-auth-service.js";
import {
  AGENT_AUTH_ROLES,
  ALL_HTTP_ROUTE_IDS,
  DEFAULT_ROLE_REGISTRY,
  ROLE_TREE,
  RoleRegistry,
  expandRoleGrant,
  matchesRouteGrant,
  normalizeRouteId,
  parseRefinedGrant,
} from "../src/auth/agent-roles.js";
import {
  ADMIN_REPAIR_INSTRUCTION,
  AuthRefinerRegistry,
  AuthSelfRefiner,
  AuthWithAskRefiner,
  type AuthRefiner,
  type AuthRefinerAction,
  type AuthRefinerContext,
} from "../src/auth/auth-refiners.js";
import {
  AuthRoleSessionsRepo,
  authRoleSessionTokenHash,
} from "../src/db/repos/auth-role-sessions.js";
import { AuthRoleSessions, AgentAuthPermissions } from "../src/mechanisms/agent-auth.js";
import { HttpModule, endpointOf, type HttpRoute } from "../src/http/app.js";
import type { AppEnv } from "../src/auth/middleware.js";
import { requireHuman } from "../src/auth/middleware.js";
import {
  DEFAULT_ATTACHMENT_MAX_MB,
  DEFAULT_ATTACHMENT_TOTAL_MB,
} from "@prismshadow/penguin-library-setting/attachment-limits";
import type { Db } from "../src/hmr/capabilities.js";

function dbDouble(): Db {
  const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE auth_role_sessions (
      token_hash TEXT PRIMARY KEY, subject_id TEXT NOT NULL,
      subject_kind TEXT NOT NULL DEFAULT 'agent', user_id TEXT,
      project_id TEXT, agent_id TEXT,
      role TEXT NOT NULL, generation INTEGER NOT NULL, created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL, last_used_at TEXT
    );
    CREATE TABLE auth_generations (
      subject_id TEXT PRIMARY KEY, subject_kind TEXT NOT NULL DEFAULT 'agent',
      user_id TEXT, project_id TEXT, agent_id TEXT,
      generation INTEGER NOT NULL, role TEXT NOT NULL,
      allowed_apis TEXT NOT NULL DEFAULT '[]'
    );
  `);
  return {
    prepare: (sql: string) => sqlite.prepare(sql) as never,
    exec: (sql: string) => sqlite.exec(sql),
  } as unknown as Db;
}

function service() {
  const db = dbDouble();
  const repo = wire(AuthRoleSessionsRepo, {});
  (repo as unknown as { db: Db }).db = db;
  const provider = wire(AgentAuthPermissionProvider, {});
  (provider as unknown as { authRoleSessions: AuthRoleSessions }).authRoleSessions = repo;
  const auth = wire(AgentAuthService, {});
  const a = auth as unknown as {
    authRoleSessions: AuthRoleSessions;
    agentAuthPermissions: AgentAuthPermissions;
  };
  a.authRoleSessions = repo;
  a.agentAuthPermissions = provider;
  return { auth, repo };
}

function routeEntry(
  id: string,
  method: "GET" | "POST" | "PUT" | "DELETE",
  prefix: string,
  code: HttpRoute,
  opts: { from?: string; order?: number; role?: string } = {},
) {
  return {
    id,
    from: opts.from ?? "test",
    data: {
      method,
      prefix,
      auth: "user" as const,
      order: opts.order ?? 250,
      ...(opts.role ? { role: opts.role } : {}),
    },
    code,
  };
}

function buildTestHttp(
  agentAuth: AgentAuthService,
  contributions: Record<string, unknown>,
  onLog?: (msg: string) => void,
) {
  const http = wire(HttpModule, {
    config: { trustProxy: false },
    log: { line: onLog ?? (() => {}) },
    auth: {
      sessionTtlMs: 1000,
      authenticateApiToken: (t: string) =>
        t === "root-token" ? { user: { userId: "admin", isAdmin: true }, via: "token" } : null,
      authenticateWithMeta: () => null,
      sessionIsLive: () => false,
    },
    agentAuth,
    errors: { record: () => {} },
    settings: {
      getAttachmentLimitsMb: () => ({
        attachmentMaxMb: DEFAULT_ATTACHMENT_MAX_MB,
        attachmentTotalMb: DEFAULT_ATTACHMENT_TOTAL_MB,
      }),
    },
    access: {},
    projects: {
      findById: (projectId: string) =>
        projectId === "p1" ? { projectId: "p1", ownerUserId: "u1", createdAt: "" } : null,
    },
    users: {
      findById: (userId: string) => (userId === "u1" ? { userId: "u1", isAdmin: true } : null),
    },
  });
  http.setup({ contributions } as unknown as ClassCtx);
  const req = (
    method: string,
    path: string,
    bearer: string,
    extraHeaders?: Record<string, string>,
  ) =>
    http.http.fetch(
      new Request(`http://localhost${path}`, {
        method,
        headers: {
          authorization: `Bearer ${bearer}`,
          origin: "http://localhost",
          ...(method !== "GET" ? { "content-type": "application/json" } : {}),
          ...extraHeaders,
        },
        ...(method !== "GET" ? { body: "{}" } : {}),
      }),
    );
  return { http, req };
}

const NOW = new Date("2026-11-19T00:00:00Z");

describe("the agent role tree and route catalog", () => {
  it("expands domain tiers monotonically (session.read < session.maintain < session.all) and covers every registered HTTP route id", () => {
    const readSet = new Set(expandRoleGrant("session.read").apiIds);
    const maintainSet = new Set(expandRoleGrant("session.maintain").apiIds);
    const allSet = new Set(expandRoleGrant("session.all").apiIds);

    expect(readSet.has("session.get")).toBe(true);
    expect(readSet.has("session.runTask")).toBe(false);
    expect(maintainSet.has("session.get")).toBe(true);
    expect(maintainSet.has("session.runTask")).toBe(true);
    expect(maintainSet.has("session.delete")).toBe(false);
    expect(allSet.has("session.runTask")).toBe(true);
    expect(allSet.has("session.delete")).toBe(true);

    for (const id of readSet) expect(maintainSet.has(id)).toBe(true);
    for (const id of maintainSet) expect(allSet.has(id)).toBe(true);

    const covered = new Set<string>();
    for (const roleId of AGENT_AUTH_ROLES) {
      expect(ROLE_TREE[roleId]).toBeDefined();
      for (const r of expandRoleGrant(roleId).apiIds) covered.add(r);
    }
    for (const routeId of ALL_HTTP_ROUTE_IDS) expect(covered.has(routeId)).toBe(true);

    const readonlyIds = new Set(expandRoleGrant("readonly").apiIds);
    const generalIds = new Set(expandRoleGrant("general").apiIds);
    const maintainerIds = new Set(expandRoleGrant("system-maintainer").apiIds);
    for (const id of readonlyIds) expect(generalIds.has(id)).toBe(true);
    for (const id of generalIds) expect(maintainerIds.has(id)).toBe(true);
    expect(expandRoleGrant("general").routeRefiners["agent.config.update"]).toEqual(["self"]);
    expect(
      expandRoleGrant("system-maintainer").routeRefiners["agent.config.update"],
    ).toBeUndefined();
    expect(expandRoleGrant("system-maintainer").agentApi).toBe(true);
  });

  it("normalizes agents.messaging.<channel> route aliases", () => {
    expect(normalizeRouteId("agents.feishu.get")).toBe("agents.messaging.feishu.get");
    expect(normalizeRouteId("messaging.feishu.update")).toBe("agents.messaging.feishu.update");
    expect(expandRoleGrant("agents.messaging.read").apiIds).toContain(
      "agents.messaging.feishu.get",
    );
    expect(expandRoleGrant("agents.messaging.maintain").apiIds).toContain(
      "agents.messaging.feishu.update",
    );
  });

  it("parses <roleOrRoute>@<refinerId> and expands refined grants while keeping inherited .read tiers unconditional", () => {
    expect(parseRefinedGrant("agent.maintain@self")).toEqual({
      target: "agent.maintain",
      refinerId: "self",
    });
    expect(parseRefinedGrant("agent.maintain@withAsk")).toEqual({
      target: "agent.maintain",
      refinerId: "withAsk",
    });

    const selfExpanded = expandRoleGrant("agent.maintain@self");
    expect(selfExpanded.apiIds).toContain("agent.config.get");
    expect(selfExpanded.apiIds).toContain("agent.config.update");
    expect(selfExpanded.routeRefiners["agent.config.get"]).toBeUndefined();
    expect(selfExpanded.routeRefiners["agent.config.update"]).toEqual(["self"]);

    const overridden = expandRoleGrant("agent.maintain@withAsk", ["agent.config.update"]);
    expect(overridden.routeRefiners["agent.config.update"]).toBeUndefined();
    expect(overridden.routeRefiners["agent.avatar.update"]).toEqual(["withAsk"]);
  });
});

describe("the agent auth service", () => {
  it("issues a session, expands tree roles and extra grants per route id, and hot-reloads on generation bump", () => {
    const { auth, repo } = service();
    const { token } = auth.issueSession("p", "a", NOW);
    expect(auth.allowsEndpoint("p", "a", "session.list")).toBe(true);
    expect(auth.allowsEndpoint("p", "a", "penguin.session.list")).toBe(true);
    expect(auth.allowsEndpoint("p", "a", "session.delete")).toBe(false);

    repo.bumpGeneration("p", "a", "session.read", ["workspace.read", "session.delete"], 1);
    expect(auth.allowsEndpoint("p", "a", "session.list")).toBe(true);
    expect(auth.allowsEndpoint("p", "a", "session.runTask")).toBe(false);
    expect(auth.allowsEndpoint("p", "a", "workspace.readFile")).toBe(true);
    expect(auth.allowsEndpoint("p", "a", "workspace.writeFile")).toBe(false);
    expect(auth.allowsEndpoint("p", "a", "session.delete")).toBe(true);

    const ctx = auth.authenticate(token, NOW)!;
    expect(ctx.grant.role).toBe("session.read");
    expect(ctx.grant.generation).toBe(1);
    expect(ctx.grant.allEndpoints).toBe(false);
    expect(ctx.grant.apiIds).toBeInstanceOf(Set);
    const cachedGrant = auth.currentGrant("p", "a")!;
    expect(auth.currentGrant("p", "a")).toBe(cachedGrant);
    expect(auth.authenticate(token, NOW)!.grant.apiIds).toBe(cachedGrant.apiIds);

    repo.bumpGeneration("p", "a", "admin", [], 2);
    expect(auth.currentGrant("p", "a")).not.toBe(cachedGrant);
    expect(auth.allowsEndpoint("p", "a", "admin.users.delete")).toBe(true);
  });

  it("refuses an unknown token and drops everything of an archived Agent", () => {
    const { auth } = service();
    const { token } = auth.issueSession("p", "a", NOW);
    expect(auth.authenticate("nope", NOW)).toBeNull();
    auth.revokeAll("p", "a");
    expect(auth.authenticate(token, NOW)).toBeNull();
    expect(auth.generationOf("p", "a")).toBeNull();
  });

  it("stores and re-derives role-bound sessions for human users (subject_kind = 'user') in the same auth_role_sessions and auth_generations tables", () => {
    const { repo } = service();
    const issued = repo.issue({
      userId: "alice",
      projectId: "p1",
      role: "readonly",
      apiIds: ["session.runTask"],
      generation: 0,
      now: NOW,
      ttlMs: 60_000,
    });
    const row = repo.findByTokenHash(authRoleSessionTokenHash(issued.token));
    expect(row).toMatchObject({
      subjectId: "user:p1/alice",
      subjectKind: "user",
      userId: "alice",
      projectId: "p1",
      agentId: "",
    });

    repo.bumpSubjectGeneration({
      userId: "alice",
      projectId: "p1",
      role: "general",
      apiIds: ["admin.settings.get"],
      generation: 1,
    });
    expect(repo.generationBySubject("user:p1/alice")).toMatchObject({
      subjectId: "user:p1/alice",
      subjectKind: "user",
      userId: "alice",
      projectId: "p1",
      generation: 1,
      role: "general",
      apiIds: ["admin.settings.get"],
    });

    repo.deleteBySubject("user:p1/alice");
    expect(repo.findByTokenHash(authRoleSessionTokenHash(issued.token))).toBeNull();
    expect(repo.generationBySubject("user:p1/alice")).toBeNull();
  });

  it("authorizes single routes and multi-endpoint groups by fine-grained route id, enforcing project and cross-agent scope", async () => {
    const { auth: agentAuth, repo } = service();
    const { token } = agentAuth.issueSession("p1", "a1", new Date());
    repo.bumpGeneration("p1", "a1", "session.read", [], 1);

    const sessionsGroup = new Hono<AppEnv>();
    sessionsGroup.get("/", (c) => c.json({ ok: "list", projectId: c.req.param("projectId") }));
    sessionsGroup.post("/", (c) => {
      requireHuman(c);
      return c.json({ ok: "create" });
    });

    const agentConfigGroup = new Hono<AppEnv>();
    agentConfigGroup.get("/", (c) => c.json({ ok: "getConfig", agentId: c.req.param("agentId") }));
    agentConfigGroup.put("/", (c) => c.json({ ok: "putConfig", agentId: c.req.param("agentId") }));

    const { req } = buildTestHttp(agentAuth, {
      routes: [
        routeEntry(
          "session.list",
          "GET",
          "/api/projects/:projectId/agents/:agentId/sessions",
          endpointOf(sessionsGroup, "GET", "/"),
        ),
        routeEntry(
          "session.create",
          "POST",
          "/api/projects/:projectId/agents/:agentId/sessions",
          endpointOf(sessionsGroup, "POST", "/"),
        ),
        routeEntry(
          "agent.config.get",
          "GET",
          "/api/projects/:projectId/agents/:agentId/config",
          endpointOf(agentConfigGroup, "GET", "/"),
        ),
        routeEntry(
          "agent.config.update",
          "PUT",
          "/api/projects/:projectId/agents/:agentId/config",
          endpointOf(agentConfigGroup, "PUT", "/"),
        ),
      ],
    });

    const rList = await req("GET", "/api/projects/p1/agents/a1/sessions", token);
    expect(rList.status).toBe(200);
    expect(await rList.json()).toEqual({ ok: "list", projectId: "p1" });
    expect((await req("GET", "/api/projects/p2/agents/a1/sessions", token)).status).toBe(403);
    expect((await req("POST", "/api/projects/p1/agents/a1/sessions", token)).status).toBe(403);

    repo.bumpGeneration("p1", "a1", "general", [], 2);
    expect((await req("PUT", "/api/projects/p1/agents/a1/config", token)).status).toBe(200);
    expect((await req("GET", "/api/projects/p1/agents/a2/config", token)).status).toBe(200);
    expect((await req("PUT", "/api/projects/p1/agents/a2/config", token)).status).toBe(403);

    repo.bumpGeneration("p1", "a1", "system-maintainer", [], 3);
    expect((await req("PUT", "/api/projects/p1/agents/a2/config", token)).status).toBe(200);
    const rMaintainerCreate = await req("POST", "/api/projects/p1/agents/a1/sessions", token);
    expect(rMaintainerCreate.status).toBe(200);
    expect(await rMaintainerCreate.json()).toEqual({ ok: "create" });
  });
});

describe("auth refiners (<roleOrRoute>@<refinerId>)", () => {
  it("supports @self, @withAsk, priority-list override ([AuthMyRefiner, AuthWithAskRefiner, AuthSelfRefiner]), undefined rejection, and mismatch admin-repair prompt", async () => {
    const { auth: agentAuth, repo } = service();
    const { token } = agentAuth.issueSession("p1", "a1", new Date());

    let observedRequestMethod: string | undefined;
    let observedRequestHeader: string | null = null;

    @Component({
      contributes: { "HttpModule.authRefiners": [{ id: "self", scope: ["agent.config.update"] }] },
    })
    class AuthMyRefiner {
      @Bind("self") readonly refiner: AuthRefiner = this;
      async authenticate(
        ctx: AuthRefinerContext,
        action: AuthRefinerAction,
        request: Request,
      ): Promise<boolean> {
        observedRequestMethod = request.method;
        observedRequestHeader = request.headers.get("x-buddy-grant");
        const targetAgent = action.params.agentId;
        return (
          action.params.projectId === ctx.projectId &&
          (targetAgent === ctx.agentId ||
            targetAgent === "a2-buddy" ||
            request.headers.get("x-buddy-grant") === "allow")
        );
      }
    }

    @Component({
      contributes: { "HttpModule.authRefiners": [{ id: "scheduleOnly", scope: ["schedule."] }] },
    })
    class AuthScheduleOnlyRefiner {
      @Bind("scheduleOnly") readonly refiner: AuthRefiner = this;
      async authenticate(): Promise<boolean> {
        return true;
      }
    }

    let askApprovalDecision = false;
    const agentConfigGroup = new Hono<AppEnv>();
    agentConfigGroup.get("/", (c) => c.json({ ok: "getConfig", agentId: c.req.param("agentId") }));
    agentConfigGroup.put("/", (c) => c.json({ ok: "putConfig", agentId: c.req.param("agentId") }));
    const scheduleGroup = new Hono<AppEnv>();
    scheduleGroup.put("/:name", (c) =>
      c.json({ ok: "putSchedule", agentId: c.req.param("agentId") }),
    );

    const { req: baseReq } = buildTestHttp(agentAuth, {
      authRefiners: [
        {
          id: "self",
          from: "AuthMyRefiner",
          data: { scope: ["agent.config.update"] },
          code: new AuthMyRefiner(),
        },
        {
          id: "scheduleOnly",
          from: "AuthScheduleOnlyRefiner",
          data: { scope: ["schedule."] },
          code: new AuthScheduleOnlyRefiner(),
        },
        {
          id: "withAsk",
          from: "AuthWithAskRefiner",
          data: { scope: ["*"], order: 1000 },
          code: new AuthWithAskRefiner(async () => askApprovalDecision),
        },
        {
          id: "self",
          from: "AuthSelfRefiner",
          data: { scope: ["agent.", "schedule."], order: 1001 },
          code: new AuthSelfRefiner(),
        },
      ],
      routes: [
        routeEntry(
          "agent.config.get",
          "GET",
          "/api/projects/:projectId/agents/:agentId/config",
          endpointOf(agentConfigGroup, "GET", "/"),
        ),
        routeEntry(
          "agent.config.update",
          "PUT",
          "/api/projects/:projectId/agents/:agentId/config",
          endpointOf(agentConfigGroup, "PUT", "/"),
        ),
        routeEntry(
          "schedule.update",
          "PUT",
          "/api/projects/:projectId/agents/:agentId/schedule/:name",
          endpointOf(scheduleGroup, "PUT", "/:name"),
        ),
      ],
    });
    const req = (method: string, path: string, extra?: Record<string, string>) =>
      baseReq(method, path, token, extra);

    repo.bumpGeneration("p1", "a1", "none", ["agent.maintain@self", "schedule.maintain@self"], 1);
    expect((await req("PUT", "/api/projects/p1/agents/a1/config")).status).toBe(200);
    expect(observedRequestMethod).toBe("PUT");
    expect((await req("PUT", "/api/projects/p1/agents/a2-buddy/config")).status).toBe(200);
    expect((await req("PUT", "/api/projects/p1/agents/a3-stranger/config")).status).toBe(403);
    expect(
      (await req("PUT", "/api/projects/p1/agents/a3-stranger/config", { "x-buddy-grant": "allow" }))
        .status,
    ).toBe(200);
    expect(observedRequestHeader).toBe("allow");
    expect((await req("PUT", "/api/projects/p1/agents/a1/schedule/daily")).status).toBe(200);
    expect((await req("PUT", "/api/projects/p1/agents/a2-buddy/schedule/daily")).status).toBe(403);

    repo.bumpGeneration("p1", "a1", "agent.maintain@withAsk", [], 2);
    askApprovalDecision = false;
    expect((await req("GET", "/api/projects/p1/agents/a2/config")).status).toBe(200);
    expect((await req("PUT", "/api/projects/p1/agents/a1/config")).status).toBe(403);
    askApprovalDecision = true;
    expect((await req("PUT", "/api/projects/p1/agents/a1/config")).status).toBe(200);

    repo.bumpGeneration("p1", "a1", "agent.maintain@nonExistentRefiner", [], 3);
    const rUndefined = await req("PUT", "/api/projects/p1/agents/a1/config");
    expect(rUndefined.status).toBe(403);
    const bodyUndefined = (await rUndefined.json()) as { error: { code: string; message: string } };
    expect(bodyUndefined.error.code).toBe("auth_refiner_undefined");
    expect(bodyUndefined.error.message).toContain(ADMIN_REPAIR_INSTRUCTION);

    repo.bumpGeneration("p1", "a1", "agent.maintain@scheduleOnly", [], 4);
    const rMismatch = await req("PUT", "/api/projects/p1/agents/a1/config");
    expect(rMismatch.status).toBe(403);
    const bodyMismatch = (await rMismatch.json()) as { error: { code: string; message: string } };
    expect(bodyMismatch.error.code).toBe("auth_refiner_mismatch");
    expect(bodyMismatch.error.message).toContain(ADMIN_REPAIR_INSTRUCTION);

    const reg = new AuthRefinerRegistry([AuthMyRefiner, AuthWithAskRefiner, AuthSelfRefiner]);
    expect(reg.has("self")).toBe(true);
    expect(reg.has("withAsk")).toBe(true);
    expect(reg.has("missing")).toBe(false);
  });
});

describe("extensible role registry, unified role->http bindings, no-wildcard enforcement, and sourceModule debug attribution", () => {
  it("allows modules and plugins to contribute roles, declare route role/roles, contribute unified role->http bindings, and rejects wildcards", () => {
    const registry = new RoleRegistry();
    registry.registerRoutes(
      [
        { id: "billing.invoices.list" },
        { id: "billing.invoices.create" },
        { id: "billing.invoices.delete" },
      ],
      "BillingRoutesModule",
    );
    registry.registerRoles(
      [
        { id: "billing.read", parents: ["readonly"] },
        {
          id: "billing.maintain",
          children: ["billing.read"],
          parents: ["general@self", "system-maintainer"],
        },
        { id: "billing.all", children: ["billing.maintain"], parents: ["admin"] },
        { id: "pluginA.extendReadonly", role: "readonly", routes: ["pluginA.status.get"] },
      ],
      "BillingRolesModule",
    );
    registry.registerRoleBindings(
      [
        {
          id: "billing.bind",
          bindings: {
            "billing.read": ["billing.invoices.list"],
            "billing.maintain": ["billing.invoices.create"],
            "billing.all": ["billing.invoices.delete"],
          },
        },
      ],
      "BillingBindingModule",
    );

    const readonlyGrant = registry.expandRoleGrant("readonly");
    expect(readonlyGrant.apiIds).toContain("billing.invoices.list");
    expect(readonlyGrant.apiIds).toContain("pluginA.status.get");
    expect(readonlyGrant.apiIds).not.toContain("billing.invoices.create");

    const generalGrant = registry.expandRoleGrant("general");
    expect(generalGrant.apiIds).toContain("billing.invoices.list");
    expect(generalGrant.apiIds).toContain("billing.invoices.create");
    expect(generalGrant.routeRefiners["billing.invoices.list"]).toBeUndefined();
    expect(generalGrant.routeRefiners["billing.invoices.create"]).toEqual(["self"]);

    expect(() => registry.registerRole("bad.role", { routes: ["billing.*"] }, "BadModule")).toThrow(
      /Wildcard pattern/,
    );
    expect(() =>
      registry.registerRoute({ id: "bad.route", role: "billing.*" }, "BadModule"),
    ).toThrow(/Wildcard pattern/);
    expect(() =>
      registry.registerRoleBinding(
        { role: "billing.read", routes: ["billing.invoices.*"] },
        "BadModule",
      ),
    ).toThrow(/Wildcard pattern/);
    expect(() => registry.expandRoleGrant("none", ["billing.*@withAsk"])).toThrow(
      /Wildcard pattern/,
    );
    expect(() => matchesRouteGrant(readonlyGrant.apiIds, "billing.*", undefined, registry)).toThrow(
      /Wildcard pattern/,
    );

    const debugInfo = registry.describeRouteAuthFailure(
      "billing.invoices.delete",
      "billing.read",
      "billing.invoices",
    );
    expect(debugInfo.sourceModule).toBe("BillingRoutesModule");
    expect(debugInfo.routeSourceModule).toBe("BillingRoutesModule");
    expect(debugInfo.roleSourceModules).toContain("BillingRolesModule");
    expect(debugInfo.bindingSourceModules).toContain("BillingBindingModule");
    expect(debugInfo.requiredRoles).toContain("billing.all");
  });

  it("wires HttpModule.roles, HttpModule.roleBindings, and HttpModule.routes (endpoints & role/roles) and records sourceModule on auth fail", async () => {
    const { auth: agentAuth } = service();
    const now = new Date();
    const { token } = agentAuth.issueSession("p1", "a1", now);

    const pluginGroup = new Hono<AppEnv>();
    pluginGroup.get("/", (c) => c.json({ ok: "list", agentId: c.req.param("agentId") }));
    pluginGroup.put("/", (c) => c.json({ ok: "update", agentId: c.req.param("agentId") }));
    pluginGroup.delete("/:itemId", (c) => {
      if (!c.var.user.isAdmin) return c.json({ error: "admin_gate_not_elevated" }, 403);
      return c.json({
        ok: "delete",
        agentId: c.req.param("agentId"),
        itemId: c.req.param("itemId"),
      });
    });
    const healthGroup = new Hono<AppEnv>();
    healthGroup.get("/", (c) => c.json({ ok: "plugin-health" }));

    const loggedLines: string[] = [];
    const { req: baseReq } = buildTestHttp(
      agentAuth,
      {
        roles: [
          { id: "myPlugin.read", from: "MyPluginRolesModule", data: { parents: ["readonly"] } },
          {
            id: "myPlugin.maintain",
            from: "MyPluginRolesModule",
            data: { children: ["myPlugin.read"], parents: ["general@self", "system-maintainer"] },
          },
          {
            id: "myPlugin.operator",
            from: "MyPluginRolesModule",
            data: { children: ["myPlugin.maintain"] },
          },
        ],
        roleBindings: [
          {
            id: "myPlugin.bindings",
            from: "MyPluginBindingsModule",
            data: {
              bindings: {
                "myPlugin.read": ["myPlugin.items.list"],
                "myPlugin.maintain": ["myPlugin.items.update"],
                "myPlugin.operator": ["myPlugin.items.delete"],
              },
            },
          },
        ],
        routes: [
          routeEntry(
            "myPlugin.items.list",
            "GET",
            "/api/projects/:projectId/agents/:agentId/my-plugin/items",
            endpointOf(pluginGroup, "GET", "/"),
            { from: "MyPluginRoutesModule", order: 600 },
          ),
          routeEntry(
            "myPlugin.items.update",
            "PUT",
            "/api/projects/:projectId/agents/:agentId/my-plugin/items",
            endpointOf(pluginGroup, "PUT", "/"),
            { from: "MyPluginRoutesModule", order: 600 },
          ),
          routeEntry(
            "myPlugin.items.delete",
            "DELETE",
            "/api/projects/:projectId/agents/:agentId/my-plugin/items/:itemId",
            endpointOf(pluginGroup, "DELETE", "/:itemId"),
            { from: "MyPluginRoutesModule", order: 600 },
          ),
          routeEntry(
            "myPlugin.health",
            "GET",
            "/api/my-plugin/health",
            endpointOf(healthGroup, "GET", "/"),
            { from: "MyPluginHealthModule", order: 601, role: "readonly" },
          ),
        ],
      },
      (msg) => loggedLines.push(msg),
    );
    const req = (method: string, path: string) => baseReq(method, path, token);

    expect(agentAuth.allowsEndpoint("p1", "a1", "myPlugin.items.list")).toBe(true);
    expect(agentAuth.allowsEndpoint("p1", "a1", "myPlugin.items.update")).toBe(true);
    expect(agentAuth.allowsEndpoint("p1", "a1", "myPlugin.items.delete")).toBe(false);
    expect(agentAuth.allowsEndpoint("p1", "a1", "myPlugin.health")).toBe(true);

    expect((await req("GET", "/api/my-plugin/health")).status).toBe(200);
    expect((await req("GET", "/api/projects/p1/agents/a2/my-plugin/items")).status).toBe(200);
    expect((await req("PUT", "/api/projects/p1/agents/a1/my-plugin/items")).status).toBe(200);

    const selfDenyRes = await req("PUT", "/api/projects/p1/agents/a2/my-plugin/items");
    expect(selfDenyRes.status).toBe(403);
    const selfDenyBody = (await selfDenyRes.json()) as {
      error: { code: string; message: string; details?: Record<string, string> };
    };
    expect(selfDenyBody.error.code).toBe("permission_required");
    expect(selfDenyBody.error.message).toContain("AuthSelfRefiner");
    expect(selfDenyBody.error.details?.sourceModule).toBe("AuthSelfRefiner");
    expect(selfDenyBody.error.details?.routeSourceModule).toBe("MyPluginRoutesModule");
    expect(
      loggedLines.some(
        (line) =>
          line.includes("[agent-auth] auth fail") &&
          line.includes("sourceModule=AuthSelfRefiner") &&
          line.includes("routeSource=MyPluginRoutesModule"),
      ),
    ).toBe(true);

    const roleDenyRes = await req("DELETE", "/api/projects/p1/agents/a1/my-plugin/items/item-1");
    expect(roleDenyRes.status).toBe(403);
    const roleDenyBody = (await roleDenyRes.json()) as {
      error: { code: string; message: string; details?: Record<string, string> };
    };
    expect(roleDenyBody.error.code).toBe("permission_required");
    expect(roleDenyBody.error.message).toContain("MyPluginRoutesModule");
    expect(roleDenyBody.error.details?.sourceModule).toBe("MyPluginRoutesModule");
    expect(roleDenyBody.error.details?.bindingSourceModule).toBe("MyPluginBindingsModule");
    expect(roleDenyBody.error.details?.requiredRoles).toBe("myPlugin.operator");
    expect(
      loggedLines.some(
        (line) =>
          line.includes("[agent-auth] auth fail") &&
          line.includes("sourceModule=MyPluginRoutesModule") &&
          line.includes("bindingSource=MyPluginBindingsModule"),
      ),
    ).toBe(true);

    const updated = agentAuth.updateGrant("p1", "a1", "myPlugin.operator", [], now);
    expect(updated.role).toBe("myPlugin.operator");
    expect(agentAuth.currentGrant("p1", "a1")?.role).toBe("myPlugin.operator");
    expect(agentAuth.allowsEndpoint("p1", "a1", "myPlugin.items.delete")).toBe(true);

    const delRes = await req("DELETE", "/api/projects/p1/agents/a2/my-plugin/items/item-99");
    expect(delRes.status).toBe(200);
    expect(await delRes.json()).toEqual({ ok: "delete", agentId: "a2", itemId: "item-99" });
  });

  it("attributes built-in domain roles and routes to their owning domain components rather than a central role table", () => {
    expect(DEFAULT_ROLE_REGISTRY.getRoleSourceModules("session.maintain")).toContain(
      "SessionApiRoutes",
    );
    expect(DEFAULT_ROLE_REGISTRY.getRoleSourceModules("agent.maintain")).toContain("AgentRoutes");
    expect(DEFAULT_ROLE_REGISTRY.getRoleSourceModules("org.maintain")).toContain("OrgRoutes");
    expect(DEFAULT_ROLE_REGISTRY.getRoleSourceModules("schedule.maintain")).toContain(
      "SchedulerRoutes",
    );
    expect(DEFAULT_ROLE_REGISTRY.getRoleSourceModules("plugin.maintain")).toContain("PluginRoutes");
    expect(DEFAULT_ROLE_REGISTRY.getRoleSourceModules("workbench.maintain")).toContain(
      "WorkbenchRoutes",
    );
    expect(DEFAULT_ROLE_REGISTRY.getRoleSourceModules("admin.all")).toContain("AdminRoutes");

    const sessionFailure = DEFAULT_ROLE_REGISTRY.describeRouteAuthFailure(
      "session.delete",
      "session.read",
    );
    expect(sessionFailure.sourceModule).toBe("SessionApiRoutes");
    expect(sessionFailure.routeSourceModule).toBe("SessionApiRoutes");
    expect(sessionFailure.bindingSourceModules).toContain("SessionApiRoutes");

    const orgFailure = DEFAULT_ROLE_REGISTRY.describeRouteAuthFailure(
      "org.create",
      "org.read",
      "org",
    );
    expect(orgFailure.sourceModule).toBe("OrgRoutes");
    expect(orgFailure.routeSourceModule).toBe("OrgRoutes");
    expect(orgFailure.bindingSourceModules).toContain("OrgRoutes");
  });

  function httpWithStandardRoutes(agentAuth: AgentAuthService, withAskRefiner: AuthWithAskRefiner) {
    const agentConfigGroup = new Hono<AppEnv>();
    agentConfigGroup.get("/", (c) => c.json({ ok: "getConfig", agentId: c.req.param("agentId") }));
    agentConfigGroup.put("/", (c) => c.json({ ok: "putConfig", agentId: c.req.param("agentId") }));
    const vaultGroup = new Hono<AppEnv>();
    vaultGroup.put("/", (c) => c.json({ ok: "putVault", agentId: c.req.param("agentId") }));
    const modelGroup = new Hono<AppEnv>();
    modelGroup.put("/", (c) => c.json({ ok: "putModels", projectId: c.req.param("projectId") }));

    return buildTestHttp(agentAuth, {
      authRefiners: [
        {
          id: "withAsk",
          from: "AuthWithAskRefiner",
          data: { scope: ["*"], order: 1000 },
          code: withAskRefiner,
        },
        {
          id: "self",
          from: "AuthSelfRefiner",
          data: { scope: ["agent.", "vault.", "schedule."], order: 1001 },
          code: new AuthSelfRefiner(),
        },
      ],
      routes: [
        routeEntry(
          "agent.config.get",
          "GET",
          "/api/projects/:projectId/agents/:agentId/config",
          endpointOf(agentConfigGroup, "GET", "/"),
          { role: "agent.read" },
        ),
        routeEntry(
          "agent.config.update",
          "PUT",
          "/api/projects/:projectId/agents/:agentId/config",
          endpointOf(agentConfigGroup, "PUT", "/"),
          { role: "agent.maintain" },
        ),
        routeEntry(
          "vault.update",
          "PUT",
          "/api/projects/:projectId/agents/:agentId/vault",
          endpointOf(vaultGroup, "PUT", "/"),
          { role: "vault.maintain" },
        ),
        routeEntry(
          "model.update",
          "PUT",
          "/api/projects/:projectId/models",
          endpointOf(modelGroup, "PUT", "/"),
          { role: "model.maintain" },
        ),
      ],
    });
  }

  it("supports AgentRole aggregation, general-with-ask workflow, suggestedWithAsk failure hints, and role mismatch fallback", async () => {
    const { auth: agentAuth } = service();
    const askLog: string[] = [];
    const { req } = httpWithStandardRoutes(
      agentAuth,
      new AuthWithAskRefiner((_ctx, action) => {
        askLog.push(`${action.routeId}:${action.params.agentId ?? "-"}`);
        return "allowed_once";
      }),
    );

    // 1. Default workflow `general-with-ask`: @self passes without prompting, cross-agent & vault fall back to @withAsk
    const { token } = agentAuth.issueSession("p1", "a1", new Date());
    agentAuth.updateGrant("p1", "a1", "general-with-ask", [], new Date());
    expect((await req("PUT", "/api/projects/p1/agents/a1/config", token)).status).toBe(200);
    expect(askLog).toEqual([]);

    expect((await req("PUT", "/api/projects/p1/agents/a2/config", token)).status).toBe(200);
    expect(askLog).toEqual(["agent.config.update:a2"]);

    expect((await req("PUT", "/api/projects/p1/agents/a1/vault", token)).status).toBe(200);
    expect(askLog).toEqual(["agent.config.update:a2", "vault.update:a1"]);

    // 2. User-defined AgentRole inheriting from the role tree + withAsk refiners
    agentAuth.defineAgentRole({
      id: "custom-operator",
      inherits: ["agent.read", "session.maintain"],
      withAsk: ["vault.maintain"],
      description: "Custom operator workflow",
    });
    agentAuth.updateGrant("p1", "a1", "custom-operator", [], new Date());
    const customGrant = agentAuth.currentGrant("p1", "a1")!;
    expect(customGrant.inheritedRoles).toContain("agent.read");
    expect(customGrant.inheritedRoles).toContain("session.maintain");
    expect(customGrant.routeRefiners?.["vault.update"]).toEqual(["withAsk"]);

    // 3. Clear rejection reason with suggestedWithAsk and upgradeRequestEndpoint
    const modelDenied = await req("PUT", "/api/projects/p1/models", token);
    expect(modelDenied.status).toBe(403);
    const modelErr = (await modelDenied.json()) as {
      error: { details?: Record<string, string> };
    };
    expect(modelErr.error.details?.reason).toBe("role_missing_route_grant");
    expect(modelErr.error.details?.suggestedWithAsk).toContain("model.maintain@withAsk");
    expect(modelErr.error.details?.suggestedUpgradeGrants).toContain("model.maintain");
    expect(modelErr.error.details?.upgradeRequestEndpoint).toBe(
      "/api/projects/p1/agents/a1/auth/requests",
    );

    // Switch to @withAsk using updateGrant options
    agentAuth.updateGrant("p1", "a1", "custom-operator", [], new Date(), {
      withAsk: ["model.maintain"],
    });
    expect((await req("PUT", "/api/projects/p1/models", token)).status).toBe(200);

    // 4. Role mismatch detection and safe fallback to readonly on unknown primary role
    agentAuth.updateGrant(
      "p1",
      "a1",
      "removed-plugin-role",
      ["unknown.maintain", "unknown.route"],
      new Date(),
    );
    const mismatchGrant = agentAuth.currentGrant("p1", "a1")!;
    expect(mismatchGrant.role).toBe("readonly");
    expect(mismatchGrant.mismatches).toEqual({
      hasMismatch: true,
      unknownPrimaryRole: true,
      fallbackRole: "readonly",
      unknownRoles: ["removed-plugin-role", "unknown.maintain"],
      unknownRoutes: ["unknown.route"],
    });
    // Readonly routes still work under fallback
    expect((await req("GET", "/api/projects/p1/agents/a1/config", token)).status).toBe(200);
    // Write routes fail and surface roleMismatch details
    const writeUnderFallback = await req("PUT", "/api/projects/p1/agents/a1/config", token);
    expect(writeUnderFallback.status).toBe(403);
    const fallbackErr = (await writeUnderFallback.json()) as {
      error: { details?: Record<string, string> };
    };
    expect(fallbackErr.error.details?.roleMismatch).toContain("removed-plugin-role");
  });

  it("supports Permission Upgrade Requests with 3 approval modes: allowed_once, allowed_for_agent, and always_allowed", async () => {
    const { auth: agentAuth } = service();
    let askMode: "allowed_once" | "allowed_for_agent" | "always_allowed" | "deny" = "deny";
    let askCount = 0;
    const { req } = httpWithStandardRoutes(
      agentAuth,
      new AuthWithAskRefiner(() => {
        askCount++;
        return askMode;
      }),
    );

    const { token } = agentAuth.issueSession("p1", "a1", new Date());
    agentAuth.updateGrant("p1", "a1", "general", [], new Date());

    // Initially vault.update is denied for role=general
    expect((await req("PUT", "/api/projects/p1/agents/a1/vault", token)).status).toBe(403);

    // Mode 1: Agent requests upgrade -> decided as "allowed_once"
    const req1 = agentAuth.requestUpgrade({
      projectId: "p1",
      agentId: "a1",
      grants: ["vault.maintain"],
      reason: "Need to rotate one secret",
      routeId: "vault.update",
    });
    expect(req1.status).toBe("pending");
    agentAuth.decideUpgradeRequest({
      projectId: "p1",
      agentId: "a1",
      requestId: req1.requestId,
      decision: "allowed_once",
    });
    expect(agentAuth.temporaryGrantsOf("p1", "a1").onceGrants).toHaveLength(1);

    // First call succeeds and consumes the once-grant
    expect((await req("PUT", "/api/projects/p1/agents/a1/vault", token)).status).toBe(200);
    expect(agentAuth.temporaryGrantsOf("p1", "a1").onceGrants).toHaveLength(0);
    // Second call is denied again
    expect((await req("PUT", "/api/projects/p1/agents/a1/vault", token)).status).toBe(403);

    // Mode 2: Interactive @withAsk returns "allowed_for_agent" (allowed when use this agent)
    agentAuth.updateGrant("p1", "a1", "general", ["vault.maintain@withAsk"], new Date());
    const genBeforeSessionGrant = agentAuth.generationOf("p1", "a1")!.generation;
    askMode = "allowed_for_agent";
    askCount = 0;

    // First call triggers @withAsk (askCount = 1) and records agent-session grant
    expect((await req("PUT", "/api/projects/p1/agents/a1/vault", token)).status).toBe(200);
    expect(askCount).toBe(1);
    expect(agentAuth.temporaryGrantsOf("p1", "a1").agentSessionGrants).toContain("vault.update");
    // Persisted DB generation was not rewritten
    expect(agentAuth.generationOf("p1", "a1")!.generation).toBe(genBeforeSessionGrant);

    // Subsequent calls in the same agent session succeed without re-asking!
    askMode = "deny";
    expect((await req("PUT", "/api/projects/p1/agents/a1/vault", token)).status).toBe(200);
    expect(askCount).toBe(1);

    // Downgrading / updating the agent's role clears temporary session grants
    agentAuth.updateGrant("p1", "a1", "general", [], new Date());
    expect(agentAuth.temporaryGrantsOf("p1", "a1").agentSessionGrants).toEqual([]);
    expect((await req("PUT", "/api/projects/p1/agents/a1/vault", token)).status).toBe(403);

    // Mode 3: Agent requests upgrade -> decided as "always_allowed" (writes to persistent role grant)
    const req3 = agentAuth.requestUpgrade({
      projectId: "p1",
      agentId: "a1",
      grants: ["vault.maintain"],
      reason: "Permanent secret manager agent",
    });
    agentAuth.decideUpgradeRequest({
      projectId: "p1",
      agentId: "a1",
      requestId: req3.requestId,
      decision: "always_allowed",
    });
    const persisted = agentAuth.generationOf("p1", "a1")!;
    expect(persisted.apiIds).toContain("vault.maintain");
    expect((await req("PUT", "/api/projects/p1/agents/a1/vault", token)).status).toBe(200);
    expect((await req("PUT", "/api/projects/p1/agents/a1/vault", token)).status).toBe(200);
  });

  it("enforces terminal state on upgrade requests, expands runtime-registered roles in allowed_once, and clears temporary grants when a session token expires or rotates", async () => {
    const { auth: agentAuth } = service();
    const runtimeGroup = new Hono<AppEnv>();
    runtimeGroup.post("/run", (c) =>
      c.json({ ok: "runtime-ran", projectId: c.req.param("projectId") }),
    );

    agentAuth.registerRole("role.runtime_plugin.maintain", {
      id: "role.runtime_plugin.maintain",
    });
    agentAuth.registerRoute(
      {
        id: "runtime_plugin.execute",
        role: "runtime_plugin.maintain",
      },
      "RuntimePluginModule",
    );
    agentAuth.registerRoleBinding(
      {
        role: "runtime_plugin.maintain",
        routes: ["runtime_plugin.execute"],
      },
      "RuntimePluginModule",
    );

    const { req } = buildTestHttp(agentAuth, {
      routes: [
        routeEntry(
          "runtime_plugin.execute",
          "POST",
          "/api/projects/:projectId/runtime/run",
          endpointOf(runtimeGroup, "POST", "/run"),
          { role: "runtime_plugin.maintain" },
        ),
      ],
    });

    const t0 = new Date("2026-11-22T00:00:00Z");
    const { token } = agentAuth.issueSession("p1", "a1", t0);

    // 1. Runtime-registered role is denied under default `general` role
    expect((await req("POST", "/api/projects/p1/runtime/run", token)).status).toBe(403);

    // 2. Request upgrade for runtime-registered role -> approve as allowed_once
    const upgReq = agentAuth.requestUpgrade({
      projectId: "p1",
      agentId: "a1",
      grants: ["runtime_plugin.maintain"],
      routeId: "runtime_plugin.execute",
      now: t0,
    });
    agentAuth.decideUpgradeRequest({
      projectId: "p1",
      agentId: "a1",
      requestId: upgReq.requestId,
      decision: "allowed_once",
      now: t0,
    });

    // Duplicate `allowed_once` decision or conflicting `deny` on an already decided request is rejected (409)
    expect(() =>
      agentAuth.decideUpgradeRequest({
        projectId: "p1",
        agentId: "a1",
        requestId: upgReq.requestId,
        decision: "allowed_once",
        now: t0,
      }),
    ).toThrow(/already been decided/);
    expect(() =>
      agentAuth.decideUpgradeRequest({
        projectId: "p1",
        agentId: "a1",
        requestId: upgReq.requestId,
        decision: "deny",
        now: t0,
      }),
    ).toThrow(/already been decided/);
    expect(agentAuth.temporaryGrantsOf("p1", "a1").onceGrants).toHaveLength(1);

    // First call to runtime route succeeds via runtime RoleRegistry expansion, second is denied
    expect((await req("POST", "/api/projects/p1/runtime/run", token)).status).toBe(200);
    expect((await req("POST", "/api/projects/p1/runtime/run", token)).status).toBe(403);

    // 3. Session-scoped temporary grant (`allowed_for_agent`) is cleared when session token expires / re-issues
    const sessionUpg = agentAuth.requestUpgrade({
      projectId: "p1",
      agentId: "a1",
      grants: ["runtime_plugin.maintain"],
      now: t0,
    });
    agentAuth.decideUpgradeRequest({
      projectId: "p1",
      agentId: "a1",
      requestId: sessionUpg.requestId,
      decision: "allowed_for_agent",
      now: t0,
    });
    // Idempotent repeat of `allowed_for_agent` returns the same decided request
    const idempotentRepeat = agentAuth.decideUpgradeRequest({
      projectId: "p1",
      agentId: "a1",
      requestId: sessionUpg.requestId,
      decision: "allowed_for_agent",
      now: t0,
    });
    expect(idempotentRepeat.request.status).toBe("approved");
    expect((await req("POST", "/api/projects/p1/runtime/run", token)).status).toBe(200);

    // Advance clock past 30-day session TTL -> authenticate returns null and clears temporary grants
    const afterExpiry = new Date(t0.getTime() + 31 * 24 * 60 * 60_000);
    expect(agentAuth.authenticate(token, afterExpiry)).toBeNull();
    expect(agentAuth.temporaryGrantsOf("p1", "a1").agentSessionGrants).toEqual([]);

    // Re-issuing a new session token via ensureSessionToken starts clean without stale temporary grants
    const rotatedToken = agentAuth.ensureSessionToken("p1", "a1", afterExpiry);
    expect(rotatedToken).not.toBe(token);
    expect((await req("POST", "/api/projects/p1/runtime/run", rotatedToken)).status).toBe(403);
  });

  it("prevents an in-flight request from a rotated session token from consuming a new session's once-grant or succeeding after async refiner wait", async () => {
    const { auth: agentAuth } = service();
    let releaseAsyncAsk!: (decision: "deny" | "allowed_for_agent" | "always_allowed") => void;
    let notifyEntered!: () => void;
    let enteredPromise = new Promise<void>((resolve) => {
      notifyEntered = resolve;
    });
    let gatePromise = new Promise<"deny" | "allowed_for_agent" | "always_allowed">((resolve) => {
      releaseAsyncAsk = resolve;
    });

    const { req } = httpWithStandardRoutes(
      agentAuth,
      new AuthWithAskRefiner(async () => {
        notifyEntered();
        return await gatePromise;
      }),
    );

    const t0 = new Date("2026-11-22T01:00:00Z");
    const { token: oldToken } = agentAuth.issueSession("p1", "a1", t0);
    agentAuth.updateGrant("p1", "a1", "general", ["vault.maintain@withAsk"], t0);

    // A pending upgrade request created under oldToken cannot be approved after rotation
    const staleUpgradeReq = agentAuth.requestUpgrade({
      projectId: "p1",
      agentId: "a1",
      grants: ["vault.maintain"],
      routeId: "vault.update",
      now: t0,
    });

    // Start an in-flight request using oldToken that blocks inside the async @withAsk refiner
    const inFlightOldRequest = req("PUT", "/api/projects/p1/agents/a1/vault", oldToken);
    await enteredPromise;

    // Rotate session while old request is still awaiting the async refiner
    const { token: newToken } = agentAuth.issueSession("p1", "a1", t0);
    expect(newToken).not.toBe(oldToken);

    // Approving the stale upgrade request from the old session is rejected (409), even for always_allowed
    expect(() =>
      agentAuth.decideUpgradeRequest({
        projectId: "p1",
        agentId: "a1",
        requestId: staleUpgradeReq.requestId,
        decision: "allowed_once",
        now: t0,
      }),
    ).toThrow(/no longer active/);
    expect(() =>
      agentAuth.decideUpgradeRequest({
        projectId: "p1",
        agentId: "a1",
        requestId: staleUpgradeReq.requestId,
        decision: "always_allowed",
        now: t0,
      }),
    ).toThrow(/no longer active/);

    // Create and approve a fresh allowed_once upgrade request for the NEW session
    const freshUpgradeReq = agentAuth.requestUpgrade({
      projectId: "p1",
      agentId: "a1",
      grants: ["vault.maintain"],
      routeId: "vault.update",
      now: t0,
    });
    agentAuth.decideUpgradeRequest({
      projectId: "p1",
      agentId: "a1",
      requestId: freshUpgradeReq.requestId,
      decision: "allowed_once",
      now: t0,
    });
    expect(agentAuth.temporaryGrantsOf("p1", "a1").onceGrants).toHaveLength(1);

    // Release the old in-flight request with "deny": it must not consume the new session's once-grant
    releaseAsyncAsk("deny");
    const oldRes = await inFlightOldRequest;
    expect(oldRes.status).toBe(401);
    expect(agentAuth.temporaryGrantsOf("p1", "a1").onceGrants).toHaveLength(1);

    // The new session token consumes its own once-grant and succeeds
    expect((await req("PUT", "/api/projects/p1/agents/a1/vault", newToken)).status).toBe(200);
    expect(agentAuth.temporaryGrantsOf("p1", "a1").onceGrants).toHaveLength(0);

    // Also verify that if an in-flight request resolves its async @withAsk with "always_allowed" AFTER rotation,
    // it neither persists the grant nor succeeds
    enteredPromise = new Promise<void>((resolve) => {
      notifyEntered = resolve;
    });
    gatePromise = new Promise<"deny" | "allowed_for_agent" | "always_allowed">((resolve) => {
      releaseAsyncAsk = resolve;
    });
    const inFlightAlwaysAllowed = req("PUT", "/api/projects/p1/agents/a1/vault", newToken);
    await enteredPromise;

    const { token: thirdToken } = agentAuth.issueSession("p1", "a1", t0);
    expect(thirdToken).not.toBe(newToken);
    const genBefore = agentAuth.generationOf("p1", "a1")!.generation;

    releaseAsyncAsk("always_allowed");
    expect((await inFlightAlwaysAllowed).status).toBe(401);
    expect(agentAuth.generationOf("p1", "a1")!.generation).toBe(genBefore);
    expect(agentAuth.generationOf("p1", "a1")!.apiIds).toEqual(["vault.maintain@withAsk"]);
  });
});
