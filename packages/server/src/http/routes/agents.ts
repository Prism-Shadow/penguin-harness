/**
 * Agent routes:
 * GET|POST /api/projects/:p/agents, DELETE /:agentId (owner only), and
 * GET /api/projects/:p/agent-deletions/:deletionId (owner only), how far a delete's background
 * removal has got.
 * The list is the union of DB entries and directory scan results, including active
 * Session count, total Session count, config last-modified time, the Agent's author, whether
 * its API switch is on, and the organizations of the Project that employ it. Listing first
 * gives an employee without an author `author: company` (agent-author-migration.ts).
 * An employed Agent is not deleted: DELETE answers 409 `agent_employed`, naming each
 * organization and title, until the employee has left every one of them. The whole delete
 * chain, that guard included, is services/agent-deletion.ts, which the organization delete
 * runs too for the employees it takes with it.
 */
import { Hono } from "hono";
import { AGENT_AUTHORS } from "@prismshadow/penguin-core";
import type {
  AgentCreateResponse,
  AgentDeleteResponse,
  AgentDeletionResponse,
  AgentsResponse,
  AgentSummary,
} from "../../api/types.js";
import type { AppEnv } from "../../auth/middleware.js";
import type { OrgService } from "../../runtime/organization/service.js";
import { HttpError } from "../errors.js";
import {
  badRequest,
  optionalBoolean,
  optionalEnum,
  optionalString,
  optionalStringArray,
  readJson,
  requireProjectDir,
  requireString,
  requireValidId,
} from "../validate.js";
import type { SessionManager } from "../../runtime/session-manager.js";
import type { SessionService } from "../../services/session-service.js";
import type { AgentConfig, AgentLifecycle } from "../../mechanisms/agents.js";
import type { TraceIndex } from "@prismshadow/penguin-library-trace";
import type { ErrorLog } from "@prismshadow/penguin-library-observability";
import type { Schedules, SessionIndex } from "@prismshadow/penguin-library-session";
import type { Access } from "@prismshadow/penguin-library-project";
import type { AgentApi } from "@prismshadow/penguin-library-agent-api";
import type { UserDraftsStore } from "@prismshadow/penguin-library-auth";
import type { AgentAuth } from "../../mechanisms/agent-auth.js";
import { UpgradeRequestDecisionError } from "../../auth/agent-auth-service.js";
import type { AgentAuthRole } from "../../auth/agent-roles.js";
import { DEFAULT_AGENT_AUTH_ROLE } from "../../auth/agent-roles.js";
import type { Workbenches } from "../../mechanisms/workbenches.js";
import { deleteAgentEverywhere } from "../../services/agent-deletion.js";
import { migrateEmployeeAuthors } from "../../services/agent-author-migration.js";

/** What this route group reaches — bound by its module (src/modules). */
export interface AgentsRouteDeps {
  agentApi: AgentApi;
  agentConfigService: AgentConfig;
  agentService: AgentLifecycle;
  errorsRepo: ErrorLog;
  manager: SessionManager;
  access: Access;
  orgService: Pick<OrgService, "employmentCensus" | "employersOf">;
  schedulesRepo: Schedules;
  sessionService: SessionService;
  sessionsRepo: SessionIndex;
  traceIndex: TraceIndex;
  workbenches: Pick<Workbenches, "releaseAgent">;
  /** Users' unsent drafts, which go with the Agent's Sessions. */
  drafts: Pick<UserDraftsStore, "deleteByAgent">;
  /** The Agent auth service: initializes, queries, updates, and revokes the Agent's role grant. */
  agentAuth: AgentAuth;
}

/** Window size in days for the card's activity sparkline (last 30 days, including today). */
const ACTIVITY_DAYS = 30;

export function agentsRoutes(deps: AgentsRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    // Defensive id validation: don't rely on the implicit invariant that requireProjectAccess always runs before path construction.
    const projectId = requireValidId(c, "projectId");
    deps.access.requireProjectAccess(c.var.user.userId, projectId);
    // One read of the Project's organizations for every Agent's employments, and for the
    // organizations whose chart cannot be read (who they employ is unknown) — before the
    // Agents are read, so an employee the migration just stamped lists with its new author.
    const { employments, unreadableCharts } = await deps.orgService.employmentCensus(projectId);
    await migrateEmployeeAuthors(deps.agentConfigService, projectId, Object.keys(employments));
    const items = await deps.agentService.listAgents(projectId);
    // One query for the whole list: which Agents have their API switch on (this server's web.db).
    const apiEnabled = new Set(deps.agentApi.enabledAgents(projectId));
    const agents: AgentSummary[] = await Promise.all(
      items.map(async (item) => {
        const stats = await deps.sessionService.sessionStats(
          projectId,
          item.agentId,
          ACTIVITY_DAYS,
        );
        const employed = Object.hasOwn(employments, item.agentId)
          ? employments[item.agentId]
          : undefined;
        return {
          ...item,
          activeSessionCount: deps.manager.activeCountForAgent(projectId, item.agentId),
          sessionCount: stats.sessionCount,
          sessionActivity: stats.activity,
          apiEnabled: apiEnabled.has(item.agentId),
          ...(employed !== undefined ? { employments: employed } : {}),
        };
      }),
    );
    return c.json({
      agents,
      ...(unreadableCharts.length > 0 ? { unreadableCharts } : {}),
    } satisfies AgentsResponse);
  });

  app.post("/", async (c) => {
    const projectId = requireValidId(c, "projectId");
    deps.access.requireProjectAccess(c.var.user.userId, projectId);
    const body = await readJson(c);
    const agentId = requireString(body, "agentId", { label: "agentId" });
    const name = optionalString(body, "name", { minLen: 1, maxLen: 100, label: "name" });
    const description = optionalString(body, "description", {
      maxLen: 2000,
      label: "description",
    });
    const author = optionalEnum(body, "author", AGENT_AUTHORS);
    // Library plugins to seed the new Agent with (the create dialog's picker); unknown names
    // are rejected before the Agent directory exists.
    const plugins = optionalStringArray(body, "plugins");
    // The library's default-install plugins join them unless the client sent its complete list.
    const defaultPlugins = optionalBoolean(body, "defaultPlugins");
    // Skills imported from a directory the user picked. The pair only means anything together, so
    // half of it is a bad request rather than a silently ignored field.
    const skillsDirectory = optionalString(body, "skillsDirectory", {
      minLen: 1,
      maxLen: 4096,
      label: "skillsDirectory",
    });
    const directorySkills = optionalStringArray(body, "directorySkills");
    let directory: { path: string; names: string[] } | undefined;
    if (skillsDirectory !== undefined || directorySkills !== undefined) {
      if (skillsDirectory === undefined || directorySkills === undefined) {
        throw badRequest("skillsDirectory and directorySkills must be sent together.");
      }
      // The same admission the discovery route applies, so the two entry points cannot disagree
      // on what a valid directory is: a relative path would otherwise resolve against the server
      // process's cwd instead of being rejected.
      directory = { path: await requireProjectDir(skillsDirectory), names: directorySkills };
    }
    const item = await deps.agentService.createAgent(projectId, agentId, {
      ...(name !== undefined ? { name } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(author !== undefined ? { author } : {}),
      ...(plugins !== undefined ? { plugins } : {}),
      ...(defaultPlugins !== undefined ? { defaultPlugins } : {}),
      ...(directory !== undefined ? { directory } : {}),
      // The creator brings the plugins' server modules along (PRFC-0031).
      actor: { userId: c.var.user.userId, isAdmin: c.var.user.isAdmin },
    });
    deps.agentAuth.issueSession(projectId, agentId, new Date());
    const agent: AgentSummary = {
      ...item,
      activeSessionCount: 0,
      sessionCount: 0,
      sessionActivity: Array.from({ length: ACTIVITY_DAYS }, () => 0),
      // A new Agent's API is off until its owner turns it on.
      apiEnabled: false,
    };
    return c.json({ agent } satisfies AgentCreateResponse, 201);
  });

  app.delete("/:agentId", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    // Deletion is a Project-level management operation: owner only.
    deps.access.requireProjectOwner(c.var.user.userId, projectId);
    const deletion = await deleteAgentEverywhere(
      { ...deps, agentAuth: deps.agentAuth },
      projectId,
      agentId,
    );
    return c.json({ deletion } satisfies AgentDeleteResponse, 202);
  });

  app.get("/:agentId/auth", (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.access.requireProjectAccess(c.var.user.userId, projectId);
    const current = deps.agentAuth.generationOf(projectId, agentId);
    const grant = deps.agentAuth.currentGrant(projectId, agentId);
    const refinedRoutes = grant?.routeRefiners ?? {};
    return c.json({
      projectId,
      agentId,
      role: grant?.role ?? current?.role ?? DEFAULT_AGENT_AUTH_ROLE,
      configuredRole: current?.role ?? DEFAULT_AGENT_AUTH_ROLE,
      generation: current?.generation ?? 0,
      apiIds: current?.apiIds ?? [],
      inheritedRoles: [...(grant?.inheritedRoles ?? [])],
      effectiveApiCount: grant?.apiIds.size ?? 0,
      allEndpoints: grant?.allEndpoints ?? false,
      agentApi: grant?.agentApi ?? false,
      unconditionalRoutes: [...(grant?.unconditionalRoutes ?? [])],
      refinedRoutes,
      temporaryGrants: deps.agentAuth.temporaryGrantsOf?.(projectId, agentId) ?? {
        onceGrants: [],
        agentSessionGrants: [],
      },
      upgradeRequests: deps.agentAuth.listUpgradeRequests?.(projectId, agentId) ?? [],
      mismatches: grant?.mismatches ?? { unknownRoles: [], unknownRoutes: [] },
      availableAgentRoles: deps.agentAuth.listAgentRoles?.() ?? [],
      roleTree: deps.agentAuth.roleTreeSnapshot?.() ?? {},
    });
  });

  app.put("/:agentId/auth", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.access.requireProjectOwner(c.var.user.userId, projectId);
    const body = await readJson(c);
    let definedRoleId: string | undefined;
    if (body.defineRole !== undefined) {
      if (
        body.defineRole === null ||
        typeof body.defineRole !== "object" ||
        Array.isArray(body.defineRole)
      ) {
        throw badRequest("defineRole must be an object.");
      }
      const def = body.defineRole as Record<string, unknown>;
      const defId = requireString(def, "id", { minLen: 1, maxLen: 200, label: "defineRole.id" });
      const defInherits = optionalStringArray(def, "inherits");
      const defWithAsk = optionalStringArray(def, "withAsk");
      const defRoutes = optionalStringArray(def, "routes");
      const defFlags = optionalStringArray(def, "flags") as
        ReadonlyArray<"allEndpoints" | "agentApi"> | undefined;
      const defDesc = optionalString(def, "description", {
        maxLen: 500,
        label: "defineRole.description",
      });
      const created = deps.agentAuth.defineAgentRole?.({
        id: defId,
        ...(defInherits !== undefined ? { inherits: defInherits } : {}),
        ...(defWithAsk !== undefined ? { withAsk: defWithAsk } : {}),
        ...(defRoutes !== undefined ? { routes: defRoutes } : {}),
        ...(defFlags !== undefined ? { flags: defFlags } : {}),
        ...(defDesc !== undefined ? { description: defDesc } : {}),
      });
      definedRoleId = created?.id ?? defId;
    }
    const current = deps.agentAuth.generationOf(projectId, agentId);
    const role =
      optionalString(body, "role", { minLen: 1, maxLen: 200, label: "role" }) ??
      definedRoleId ??
      current?.role ??
      DEFAULT_AGENT_AUTH_ROLE;
    const apiIds = optionalStringArray(body, "apiIds") ?? [];
    const inherits = optionalStringArray(body, "inherits");
    const withAsk = optionalStringArray(body, "withAsk");
    const updated = deps.agentAuth.updateGrant(
      projectId,
      agentId,
      role as AgentAuthRole,
      apiIds,
      new Date(),
      {
        ...(inherits !== undefined ? { inherits } : {}),
        ...(withAsk !== undefined ? { withAsk } : {}),
      },
    );
    const grant = deps.agentAuth.currentGrant(projectId, agentId);
    const refinedRoutes = grant?.routeRefiners ?? {};
    return c.json({
      projectId,
      agentId,
      role: grant?.role ?? updated.role,
      configuredRole: updated.role,
      generation: updated.generation,
      apiIds: updated.apiIds,
      inheritedRoles: [...(grant?.inheritedRoles ?? [])],
      effectiveApiCount: grant?.apiIds.size ?? 0,
      allEndpoints: grant?.allEndpoints ?? false,
      agentApi: grant?.agentApi ?? false,
      unconditionalRoutes: [...(grant?.unconditionalRoutes ?? [])],
      refinedRoutes,
      temporaryGrants: deps.agentAuth.temporaryGrantsOf?.(projectId, agentId) ?? {
        onceGrants: [],
        agentSessionGrants: [],
      },
      mismatches: grant?.mismatches ?? { unknownRoles: [], unknownRoutes: [] },
    });
  });

  app.post("/:agentId/auth/requests", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.access.requireProjectAccess(c.var.user.userId, projectId);
    const body = await readJson(c);
    const grants = optionalStringArray(body, "grants") ?? [];
    if (grants.length === 0) {
      throw badRequest("grants must be a non-empty array of role or route IDs.");
    }
    const reason = optionalString(body, "reason", { maxLen: 1000, label: "reason" });
    const routeId = optionalString(body, "routeId", { maxLen: 200, label: "routeId" });
    if (typeof deps.agentAuth.requestUpgrade !== "function") {
      throw new HttpError(501, "not_implemented", "Permission upgrade requests are not available.");
    }
    const request = deps.agentAuth.requestUpgrade({
      projectId,
      agentId,
      grants,
      ...(reason !== undefined ? { reason } : {}),
      ...(routeId !== undefined ? { routeId } : {}),
      ...(c.var.agentAuth?.tokenHash !== undefined ? { tokenHash: c.var.agentAuth.tokenHash } : {}),
      now: new Date(),
    });
    return c.json(
      {
        request,
        approvalChoices: [
          { id: "allowed_once", label: "1. allowed once" },
          { id: "allowed_for_agent", label: "2. allowed when use this agent" },
          { id: "always_allowed", label: "3. always allowed (write role)" },
        ],
      },
      201,
    );
  });

  app.post("/:agentId/auth/requests/:requestId/decide", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    const requestId = requireString({ requestId: c.req.param("requestId") }, "requestId", {
      minLen: 1,
      maxLen: 200,
      label: "requestId",
    });
    deps.access.requireProjectOwner(c.var.user.userId, projectId);
    const body = await readJson(c);
    const decision = requireString(body, "decision", {
      minLen: 1,
      maxLen: 100,
      label: "decision",
    });
    if (typeof deps.agentAuth.decideUpgradeRequest !== "function") {
      throw new HttpError(
        501,
        "not_implemented",
        "Permission upgrade decisions are not available.",
      );
    }
    let result;
    try {
      result = deps.agentAuth.decideUpgradeRequest({
        projectId,
        agentId,
        requestId,
        decision,
        now: new Date(),
      });
    } catch (err) {
      if (err instanceof UpgradeRequestDecisionError) {
        throw new HttpError(err.status, err.code, err.message);
      }
      throw err;
    }
    return c.json({
      request: result.request,
      role: result.grant?.role ?? DEFAULT_AGENT_AUTH_ROLE,
      generation: result.grant?.generation ?? 0,
      effectiveApiCount: result.grant?.apiIds.size ?? 0,
      temporaryGrants: deps.agentAuth.temporaryGrantsOf?.(projectId, agentId) ?? {
        onceGrants: [],
        agentSessionGrants: [],
      },
    });
  });

  return app;
}

/** GET /api/projects/:projectId/agent-deletions/:deletionId: where a delete's removal stands. */
export function agentDeletionsRoutes(
  deps: Pick<AgentsRouteDeps, "access" | "agentService">,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/:deletionId", (c) => {
    const projectId = requireValidId(c, "projectId");
    const deletionId = requireValidId(c, "deletionId");
    deps.access.requireProjectOwner(c.var.user.userId, projectId);
    const deletion = deps.agentService.agentDeletion(projectId, deletionId);
    if (deletion === null) {
      throw new HttpError(404, "agent_deletion_not_found", "No such deletion is in progress.");
    }
    return c.json({ deletion } satisfies AgentDeletionResponse);
  });

  return app;
}
