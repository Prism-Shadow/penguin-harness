/**
 * The Agent auth service over its repo, the declarative role tree (`ROLE_TREE`), and the HTTP
 * surface's route-id gate: the grant a session runs under is expanded from the role tree and
 * extra grants at the Agent's CURRENT generation, so a role or grant change hot-reloads without
 * re-issue and no stale grant outlives one request.
 */
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { wire } from "@prismshadow/penguin-core/kernel";
import type { ClassCtx } from "@prismshadow/penguin-core/kernel";
import { AgentAuthService, AgentAuthPermissionProvider } from "../src/auth/agent-auth-service.js";
import {
  AGENT_AUTH_ROLES,
  ALL_HTTP_ROUTE_IDS,
  ROLE_TREE,
  expandRoleGrant,
  resolveHttpRouteId,
} from "../src/auth/agent-roles.js";
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

  it("resolves group sub-routes to fine-grained route ids", () => {
    expect(resolveHttpRouteId("sessions.agents", "GET", "/")).toBe("agent.list");
    expect(resolveHttpRouteId("sessions.agents", "DELETE", "/:agentId")).toBe("agent.delete");
    expect(resolveHttpRouteId("org", "POST", "/:orgId/tickets/:ticketId/start")).toBe(
      "org.ticket.start",
    );
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
