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
import type { TraceIndex } from "../../mechanisms/traces.js";
import type { ErrorLog } from "../../mechanisms/observability.js";
import type { Schedules, SessionIndex } from "../../mechanisms/sessions.js";
import type { Access } from "../../mechanisms/projects.js";
import type { AgentApi } from "../../mechanisms/agent-api.js";
import type { UserDraftsStore } from "../../mechanisms/account-data.js";
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
      ...(directory !== undefined ? { directory } : {}),
    });
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
    const deletion = await deleteAgentEverywhere(deps, projectId, agentId);
    return c.json({ deletion } satisfies AgentDeleteResponse, 202);
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
