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
  ROLE_TREE,
  expandRoleGrant,
  normalizeRouteId,
  parseRefinedGrant,
  resolveHttpRouteId,
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
import { AgentAuthSessionsRepo } from "../src/db/repos/agent-auth-sessions.js";
import { AgentAuthSessions, AgentAuthPermissions } from "../src/mechanisms/agent-auth.js";
import { HttpModule, endpointOf } from "../src/http/app.js";
import type { AppEnv } from "../src/auth/middleware.js";
import { requireHuman } from "../src/auth/middleware.js";
import {
  DEFAULT_ATTACHMENT_MAX_MB,
  DEFAULT_ATTACHMENT_TOTAL_MB,
} from "@prismshadow/penguin-library-setting/attachment-limits";
import type { Db } from "../src/hmr/capabilities.js";

/** A Db double over an in-memory schema-less store: the repo runs raw SQL, so a real sqlite. */
function dbDouble(): Db {
  const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE agent_auth_sessions (
      token_hash TEXT PRIMARY KEY, project_id TEXT NOT NULL, agent_id TEXT NOT NULL,
      role TEXT NOT NULL, generation INTEGER NOT NULL, created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL, last_used_at TEXT
    );
    CREATE TABLE agent_auth_generations (
      project_id TEXT NOT NULL, agent_id TEXT NOT NULL, generation INTEGER NOT NULL,
      role TEXT NOT NULL, allowed_apis TEXT NOT NULL DEFAULT '[]', PRIMARY KEY (project_id, agent_id)
    );
  `);
  return {
    prepare: (sql: string) => sqlite.prepare(sql) as never,
    exec: (sql: string) => sqlite.exec(sql),
  } as unknown as Db;
}

function service() {
  const db = dbDouble();
  const repo = wire(AgentAuthSessionsRepo, {});
  (repo as unknown as { db: Db }).db = db;
  const provider = wire(AgentAuthPermissionProvider, {});
  (provider as unknown as { agentAuthSessions: AgentAuthSessions }).agentAuthSessions = repo;
  const auth = wire(AgentAuthService, {});
  const a = auth as unknown as {
    agentAuthSessions: AgentAuthSessions;
    agentAuthPermissions: AgentAuthPermissions;
  };
  a.agentAuthSessions = repo;
  a.agentAuthPermissions = provider;
  return { auth, repo };
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

    // Every role node in ROLE_TREE expands cleanly without cycles, and the union of all nodes
    // covers every route id in ALL_HTTP_ROUTE_IDS.
    const covered = new Set<string>();
    for (const roleId of AGENT_AUTH_ROLES) {
      const node = ROLE_TREE[roleId];
      expect(node).toBeDefined();
      for (const r of expandRoleGrant(roleId).apiIds) {
        covered.add(r);
      }
    }
    for (const routeId of ALL_HTTP_ROUTE_IDS) {
      expect(covered.has(routeId)).toBe(true);
    }

    // Composite roles nest monotonically: readonly < general < system-maintainer.
    const readonlyIds = new Set(expandRoleGrant("readonly").apiIds);
    const generalIds = new Set(expandRoleGrant("general").apiIds);
    const maintainerIds = new Set(expandRoleGrant("system-maintainer").apiIds);
    for (const id of readonlyIds) expect(generalIds.has(id)).toBe(true);
    for (const id of generalIds) expect(maintainerIds.has(id)).toBe(true);
    expect(expandRoleGrant("general").crossAgent).toBe(false);
    expect(expandRoleGrant("system-maintainer").crossAgent).toBe(true);
    expect(expandRoleGrant("system-maintainer").agentApi).toBe(true);
  });

  it("resolves group sub-routes to fine-grained route ids and normalizes agents.messaging.<channel>", () => {
    expect(resolveHttpRouteId("sessions.agents", "GET", "/")).toBe("agent.list");
    expect(resolveHttpRouteId("sessions.agents", "DELETE", "/:agentId")).toBe("agent.delete");
    expect(resolveHttpRouteId("org", "POST", "/:orgId/tickets/:ticketId/start")).toBe(
      "org.ticket.start",
    );
    expect(resolveHttpRouteId("agents.feishu", "GET", "/")).toBe("agents.messaging.feishu.get");
    expect(resolveHttpRouteId("agents.messaging.feishu", "PUT", "/")).toBe(
      "agents.messaging.feishu.update",
    );
    expect(
      resolveHttpRouteId("messaging.session-routes", "GET", "/:sessionId/messaging/feishu"),
    ).toBe("agents.messaging.feishu.get");
    expect(
      resolveHttpRouteId("messaging.session-routes", "POST", "/:sessionId/messaging/wechat/scan"),
    ).toBe("agents.messaging.wechat.scanStart");
    expect(resolveHttpRouteId("messaging.accounts", "GET", "/accounts")).toBe(
      "messaging.listAccounts",
    );
    expect(resolveHttpRouteId("messaging.account-holders", "GET", "/account-holders")).toBe(
      "messaging.listAccountHolders",
    );
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
    // .read tier inherited by agent.maintain remains unconditional (no refiner needed for GET)
    expect(selfExpanded.routeRefiners["agent.config.get"]).toBeUndefined();
    // .maintain write routes carry the @self refiner
    expect(selfExpanded.routeRefiners["agent.config.update"]).toEqual(["self"]);

    // An unconditional grant for the same route supersedes a refined grant
    const overridden = expandRoleGrant("agent.maintain@withAsk", ["agent.config.update"]);
    expect(overridden.routeRefiners["agent.config.update"]).toBeUndefined();
    expect(overridden.routeRefiners["agent.avatar.update"]).toEqual(["withAsk"]);
  });
});

describe("the agent auth service", () => {
  it("issues a session, expands tree roles and extra grants per route id, and hot-reloads on generation bump", () => {
    const { auth, repo } = service();
    const { token } = auth.issueSession("p", "a", NOW);
    // Default role is general: includes session.maintain (session.list, session.runTask) but not session.delete.
    expect(auth.allowsEndpoint("p", "a", "session.list")).toBe(true);
    expect(auth.allowsEndpoint("p", "a", "penguin.session.list")).toBe(true);
    expect(auth.allowsEndpoint("p", "a", "session.delete")).toBe(false);

    // Narrow to session.read + an extra sub-role (workspace.read) + one explicit route (session.delete).
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

    // The admin role spans every endpoint.
    repo.bumpGeneration("p", "a", "admin", [], 2);
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

    const http = wire(HttpModule, {
      config: { trustProxy: false },
      log: { line: () => {} },
      auth: {
        sessionTtlMs: 1000,
        authenticateApiToken: (t: string) =>
          t === "root-token"
            ? { user: { userId: "admin", isAdmin: true }, via: "token" }
            : null,
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
        findById: (userId: string) =>
          userId === "u1" ? { userId: "u1", isAdmin: true } : null,
      },
    });
    http.setup({
      contributions: {
        routes: [
          {
            id: "session.list",
            from: "test",
            data: {
              method: "GET",
              prefix: "/api/projects/:projectId/agents/:agentId/sessions",
              auth: "user",
              order: 250,
            },
            code: endpointOf(sessionsGroup, "GET", "/"),
          },
          {
            id: "session.create",
            from: "test",
            data: {
              method: "POST",
              prefix: "/api/projects/:projectId/agents/:agentId/sessions",
              auth: "user",
              order: 250,
            },
            code: endpointOf(sessionsGroup, "POST", "/"),
          },
          {
            id: "sessions.agent-config",
            from: "test",
            data: {
              prefix: "/api/projects/:projectId/agents/:agentId/config",
              auth: "user",
              order: 245,
            },
            code: agentConfigGroup,
          },
        ],
      },
    } as unknown as ClassCtx);

    const req = (method: string, path: string, bearer: string) =>
      http.http.fetch(
        new Request(`http://localhost${path}`, {
          method,
          headers: {
            authorization: `Bearer ${bearer}`,
            origin: "http://localhost",
            ...(method !== "GET" ? { "content-type": "application/json" } : {}),
          },
          ...(method !== "GET" ? { body: "{}" } : {}),
        }),
      );

    // session.read grants session.list for p1, refuses p2, and refuses session.create
    const rList = await req("GET", "/api/projects/p1/agents/a1/sessions", token);
    expect(rList.status).toBe(200);
    expect(await rList.json()).toEqual({ ok: "list", projectId: "p1" });

    const rOtherProject = await req("GET", "/api/projects/p2/agents/a1/sessions", token);
    expect(rOtherProject.status).toBe(403);

    const rCreateDenied = await req("POST", "/api/projects/p1/agents/a1/sessions", token);
    expect(rCreateDenied.status).toBe(403);

    // Group sub-route resolution: general grants agent.config.get and agent.config.update on self (a1),
    // but refuses mutating another agent (a2) without crossAgent.
    repo.bumpGeneration("p1", "a1", "general", [], 2);
    const rSelfPut = await req("PUT", "/api/projects/p1/agents/a1/config", token);
    expect(rSelfPut.status).toBe(200);

    const rOtherAgentGet = await req("GET", "/api/projects/p1/agents/a2/config", token);
    expect(rOtherAgentGet.status).toBe(200);

    const rOtherAgentPut = await req("PUT", "/api/projects/p1/agents/a2/config", token);
    expect(rOtherAgentPut.status).toBe(403);

    // system-maintainer has crossAgent + agentApi: passes both cross-agent PUT and requireHuman POST
    repo.bumpGeneration("p1", "a1", "system-maintainer", [], 3);
    const rMaintainerOtherPut = await req("PUT", "/api/projects/p1/agents/a2/config", token);
    expect(rMaintainerOtherPut.status).toBe(200);

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

    // Custom refiner overriding @self for agent.config.update only (for instance, allowing a1 to also manage "a2-buddy"
    // or any target carrying header `x-buddy-grant: allow` inspected via the 3rd `request` parameter)
    @Component({
      contributes: {
        "HttpModule.authRefiners": [
          {
            id: "self",
            scope: ["agent.config.update"],
          },
        ],
      },
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

    // Narrowly-scoped custom refiner to test session mismatch when applied outside its declared scope
    @Component({
      contributes: {
        "HttpModule.authRefiners": [
          {
            id: "scheduleOnly",
            scope: ["schedule."],
          },
        ],
      },
    })
    class AuthScheduleOnlyRefiner {
      @Bind("scheduleOnly") readonly refiner: AuthRefiner = this;
      async authenticate(
        _ctx: AuthRefinerContext,
        _action: AuthRefinerAction,
        _request: Request,
      ): Promise<boolean> {
        return true;
      }
    }

    let askApprovalDecision = false;
    const origAuthenticate = agentAuth.authenticate.bind(agentAuth);
    const wrappedAgentAuth = {
      authenticate: (bearer: string, now: Date) => {
        const res = origAuthenticate(bearer, now);
        if (res === null) return null;
        return {
          ...res,
          askApproval: async () => askApprovalDecision,
        };
      },
    };

    const agentConfigGroup = new Hono<AppEnv>();
    agentConfigGroup.get("/", (c) => c.json({ ok: "getConfig", agentId: c.req.param("agentId") }));
    agentConfigGroup.put("/", (c) => c.json({ ok: "putConfig", agentId: c.req.param("agentId") }));

    const scheduleGroup = new Hono<AppEnv>();
    scheduleGroup.put("/:name", (c) =>
      c.json({ ok: "putSchedule", agentId: c.req.param("agentId") }),
    );

    const http = wire(HttpModule, {
      config: { trustProxy: false },
      log: { line: () => {} },
      auth: {
        sessionTtlMs: 1000,
        authenticateApiToken: () => null,
        authenticateWithMeta: () => null,
        sessionIsLive: () => false,
      },
      agentAuth: wrappedAgentAuth,
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
        findById: (userId: string) =>
          userId === "u1" ? { userId: "u1", isAdmin: true } : null,
      },
    });
    http.setup({
      contributions: {
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
            code: new AuthWithAskRefiner(),
          },
          {
            id: "self",
            from: "AuthSelfRefiner",
            data: {
              scope: ["agent.", "schedule."],
              order: 1001,
            },
            code: new AuthSelfRefiner(),
          },
        ],
        routes: [
          {
            id: "sessions.agent-config",
            from: "test",
            data: {
              prefix: "/api/projects/:projectId/agents/:agentId/config",
              auth: "user",
              order: 245,
            },
            code: agentConfigGroup,
          },
          {
            id: "schedules",
            from: "test",
            data: {
              prefix: "/api/projects/:projectId/agents/:agentId/schedule",
              auth: "user",
              order: 246,
            },
            code: scheduleGroup,
          },
        ],
      },
    } as unknown as ClassCtx);

    const req = (method: string, path: string, extraHeaders?: Record<string, string>) =>
      http.http.fetch(
        new Request(`http://localhost${path}`, {
          method,
          headers: {
            authorization: `Bearer ${token}`,
            origin: "http://localhost",
            ...(method !== "GET" ? { "content-type": "application/json" } : {}),
            ...extraHeaders,
          },
          ...(method !== "GET" ? { body: "{}" } : {}),
        }),
      );

    // 1. Priority override via `HttpModule.authRefiners` slot list: [AuthMyRefiner, AuthWithAskRefiner, AuthSelfRefiner]
    // AuthMyRefiner overrides @self for agent.config.update (allowing a2-buddy or x-buddy-grant header via `request`),
    // while schedule.upsert falls back to AuthSelfRefiner.
    repo.bumpGeneration("p1", "a1", "none", ["agent.maintain@self", "schedule.maintain@self"], 1);
    expect((await req("PUT", "/api/projects/p1/agents/a1/config")).status).toBe(200);
    expect(observedRequestMethod).toBe("PUT");
    expect((await req("PUT", "/api/projects/p1/agents/a2-buddy/config")).status).toBe(200);
    expect((await req("PUT", "/api/projects/p1/agents/a3-stranger/config")).status).toBe(403);
    expect(
      (
        await req("PUT", "/api/projects/p1/agents/a3-stranger/config", {
          "x-buddy-grant": "allow",
        })
      ).status,
    ).toBe(200);
    expect(observedRequestHeader).toBe("allow");
    // Fallback to AuthSelfRefiner on schedule.upsert: a2-buddy is denied because AuthMyRefiner's scope only covers agent.config.update
    expect((await req("PUT", "/api/projects/p1/agents/a1/schedule/daily")).status).toBe(200);
    expect((await req("PUT", "/api/projects/p1/agents/a2-buddy/schedule/daily")).status).toBe(403);

    // 2. @withAsk: GET (inherited .read tier) succeeds without asking; PUT requires askApproval === true
    repo.bumpGeneration("p1", "a1", "agent.maintain@withAsk", [], 2);
    askApprovalDecision = false;
    expect((await req("GET", "/api/projects/p1/agents/a2/config")).status).toBe(200);
    expect((await req("PUT", "/api/projects/p1/agents/a1/config")).status).toBe(403);
    askApprovalDecision = true;
    expect((await req("PUT", "/api/projects/p1/agents/a1/config")).status).toBe(200);

    // 3. Undefined refiner -> immediate reject (403 auth_refiner_undefined)
    repo.bumpGeneration("p1", "a1", "agent.maintain@nonExistentRefiner", [], 3);
    const rUndefined = await req("PUT", "/api/projects/p1/agents/a1/config");
    expect(rUndefined.status).toBe(403);
    const bodyUndefined = (await rUndefined.json()) as { error: { code: string; message: string } };
    expect(bodyUndefined.error.code).toBe("auth_refiner_undefined");
    expect(bodyUndefined.error.message).toContain(ADMIN_REPAIR_INSTRUCTION);

    // 4. Session refiner mismatch -> 403 auth_refiner_mismatch with admin repair prompt
    repo.bumpGeneration("p1", "a1", "agent.maintain@scheduleOnly", [], 4);
    const rMismatch = await req("PUT", "/api/projects/p1/agents/a1/config");
    expect(rMismatch.status).toBe(403);
    const bodyMismatch = (await rMismatch.json()) as { error: { code: string; message: string } };
    expect(bodyMismatch.error.code).toBe("auth_refiner_mismatch");
    expect(bodyMismatch.error.message).toContain(ADMIN_REPAIR_INSTRUCTION);

    // Direct unit check on AuthRefinerRegistry
    const reg = new AuthRefinerRegistry([AuthMyRefiner, AuthWithAskRefiner, AuthSelfRefiner]);
    expect(reg.has("self")).toBe(true);
    expect(reg.has("withAsk")).toBe(true);
    expect(reg.has("missing")).toBe(false);
  });
});
