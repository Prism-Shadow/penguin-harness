/**
 * The Agent auth service over its repo and the HTTP surface's route-id gate: the grant a
 * session runs under is per HTTP route id (both HTTP and CLI governed by the one check — CLI
 * commands reach the server over HTTP), re-derived at the Agent's CURRENT generation, so a
 * role or grant change hot-reloads without re-issue and no stale grant outlives one request.
 */
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { wire } from "@prismshadow/penguin-core/kernel";
import type { ClassCtx } from "@prismshadow/penguin-core/kernel";
import { AgentAuthService, AgentAuthPermissionProvider } from "../src/auth/agent-auth-service.js";
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

describe("the agent auth service", () => {
  it("issues a session and grants per route id; admin spans every endpoint", () => {
    const { auth, repo } = service();
    const { token } = auth.issueSession("p", "a", NOW);
    // general starts with an empty granted set: no endpoint passes.
    expect(auth.allowsEndpoint("p", "a", "penguin.session.list")).toBe(false);
    const ctx = auth.authenticate(token, NOW)!;
    expect(ctx.grant.role).toBe("general");
    expect(ctx.grant.allEndpoints).toBe(false);
    // Grant one route id; the same token re-derives it without re-issue.
    repo.bumpGeneration("p", "a", "general", ["penguin.session.list"], 1);
    expect(auth.allowsEndpoint("p", "a", "penguin.session.list")).toBe(true);
    expect(auth.allowsEndpoint("p", "a", "penguin.session.delete")).toBe(false);
    expect(auth.authenticate(token, NOW)!.grant.apiIds).toEqual(["penguin.session.list"]);
    // The admin role spans every endpoint, granted set aside.
    repo.bumpGeneration("p", "a", "admin", [], 2);
    expect(auth.allowsEndpoint("p", "a", "penguin.session.delete")).toBe(true);
  });

  it("refuses an unknown token and drops everything of an archived Agent", () => {
    const { auth } = service();
    const { token } = auth.issueSession("p", "a", NOW);
    expect(auth.authenticate("nope", NOW)).toBeNull();
    auth.revokeAll("p", "a");
    expect(auth.authenticate(token, NOW)).toBeNull();
    expect(auth.generationOf("p", "a")).toBeNull();
  });

  it("authorizes HTTP routes by their registered route id and enforces project scope", async () => {
    const { auth: agentAuth, repo } = service();
    const { token } = agentAuth.issueSession("p1", "a1", new Date());

    const sessionsGroup = new Hono<AppEnv>();
    sessionsGroup.get("/", (c) => c.json({ ok: "list", projectId: c.req.param("projectId") }));
    sessionsGroup.post("/", (c) => {
      requireHuman(c);
      return c.json({ ok: "create" });
    });

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
            id: "penguin.session.list",
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
            id: "penguin.session.create",
            from: "test",
            data: {
              method: "POST",
              prefix: "/api/projects/:projectId/agents/:agentId/sessions",
              auth: "user",
              order: 250,
            },
            code: endpointOf(sessionsGroup, "POST", "/"),
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
            ...(method === "POST" ? { "content-type": "application/json" } : {}),
          },
          ...(method === "POST" ? { body: "{}" } : {}),
        }),
      );

    // Unlisted route id in grant -> 403 permission_required
    const r1 = await req("GET", "/api/projects/p1/agents/a1/sessions", token);
    expect(r1.status).toBe(403);
    expect(await r1.json()).toMatchObject({ error: { code: "permission_required" } });

    // Grant penguin.session.list -> GET passes for p1, refused for p2
    repo.bumpGeneration("p1", "a1", "general", ["penguin.session.list"], 1);
    const r2 = await req("GET", "/api/projects/p1/agents/a1/sessions", token);
    expect(r2.status).toBe(200);
    expect(await r2.json()).toEqual({ ok: "list", projectId: "p1" });

    const rOtherProject = await req("GET", "/api/projects/p2/agents/a1/sessions", token);
    expect(rOtherProject.status).toBe(403);

    // POST penguin.session.create is not granted -> 403 permission_required
    const r3 = await req("POST", "/api/projects/p1/agents/a1/sessions", token);
    expect(r3.status).toBe(403);

    // system-maintainer with penguin.session.create passes requireHuman too
    repo.bumpGeneration("p1", "a1", "system-maintainer", ["penguin.session.create"], 2);
    const r4 = await req("POST", "/api/projects/p1/agents/a1/sessions", token);
    expect(r4.status).toBe(200);
    expect(await r4.json()).toEqual({ ok: "create" });
  });
});
