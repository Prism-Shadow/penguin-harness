/**
 * Agent routes:
 * GET|POST /api/projects/:p/agents, DELETE /:agentId (owner only).
 * The list is the union of DB entries and directory scan results, including active
 * Session count, total Session count, config last-modified time, whether the Agent's API
 * switch is on, and the organizations of the Project that employ it.
 * An employed Agent is not deleted: DELETE answers 409 `agent_employed`, naming each
 * organization and title, until the employee has left every one of them. The guard is here
 * rather than in the Agent service because the organization runtime already depends on that
 * service; the route consumes both.
 */
import { Hono } from "hono";
import type {
  AgentCreateResponse,
  AgentsResponse,
  AgentSummary,
  Employment,
} from "../../api/types.js";
import type { AppEnv } from "../../auth/middleware.js";
import type { OrgService } from "../../runtime/organization/service.js";
import { HttpError } from "../errors.js";
import { settleWithin } from "../settle.js";
import {
  badRequest,
  optionalString,
  optionalStringArray,
  readJson,
  requireProjectDir,
  requireString,
  requireValidId,
} from "../validate.js";
import { readArchiveBase64 } from "./agent-transfer.js";
import type { SessionManager } from "../../runtime/session-manager.js";
import type { SessionService } from "../../services/session-service.js";
import type { AgentConfig, AgentLifecycle } from "../../mechanisms/agents.js";
import type { TraceIndex } from "../../mechanisms/traces.js";
import type { ErrorLog } from "../../mechanisms/observability.js";
import type { Schedules, SessionIndex } from "../../mechanisms/sessions.js";
import type { Access } from "../../mechanisms/projects.js";
import type { AgentApi } from "../../mechanisms/agent-api.js";

/** What this route group reaches — bound by its module (src/modules). */
export interface AgentsRouteDeps {
  agentApi: AgentApi;
  agentConfigService: AgentConfig;
  agentService: AgentLifecycle;
  errorsRepo: ErrorLog;
  manager: SessionManager;
  access: Access;
  orgService: Pick<OrgService, "employments" | "employersOf">;
  schedulesRepo: Schedules;
  sessionService: SessionService;
  sessionsRepo: SessionIndex;
  traceIndex: TraceIndex;
}

/** Window size in days for the card's activity sparkline (last 30 days, including today). */
const ACTIVITY_DAYS = 30;

/** The refusal of a delete while organizations employ the Agent: each one by name, id and title. */
function employedError(agentId: string, employers: readonly Employment[]): HttpError {
  const where = employers
    .map((e) => `organization "${e.orgName}" (${e.orgId}) as ${e.title}`)
    .join("; ");
  const leave = employers.length === 1 ? "the organization" : "these organizations";
  return new HttpError(
    409,
    "agent_employed",
    `Agent ${agentId} is an employee of ${where}; make it leave ${leave} before deleting it.`,
  );
}

export function agentsRoutes(deps: AgentsRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    // Defensive id validation: don't rely on the implicit invariant that requireProjectAccess always runs before path construction.
    const projectId = requireValidId(c, "projectId");
    deps.access.requireProjectAccess(c.var.user.userId, projectId);
    const items = await deps.agentService.listAgents(projectId);
    // One query for the whole list: which Agents have their API switch on (this server's web.db).
    const apiEnabled = new Set(deps.agentApi.enabledAgents(projectId));
    // And one read of the Project's organizations for every Agent's employments.
    const employments = await deps.orgService.employments(projectId);
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
    return c.json({ agents } satisfies AgentsResponse);
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
    // Optional snapshot seed: the new Agent starts from an exported package instead of the
    // default template (the service rejects combining it with seeding).
    const archive = body.dataBase64 === undefined ? undefined : readArchiveBase64(body);
    const item = await deps.agentService.createAgent(
      projectId,
      agentId,
      name,
      description,
      plugins,
      directory,
      archive,
    );
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
    await deps.agentConfigService.requireExists(projectId, agentId);
    // An employee is refused before anything is touched: deleting its Agent would leave the
    // organization's chart naming an Agent that is gone, and its desk naming a Session that is.
    // Leaving the organization is the way out, and it keeps the Agent.
    const employers = await deps.orgService.employersOf(projectId, agentId);
    if (employers.length > 0) throw employedError(agentId, employers);
    // Mark as deleting and converge active runs (beginAgentDeletion): any new Task during
    // this window gets 409, preventing the race where a new task recreates the directory
    // and revives the Agent between abort and rm. Abort cleanup writes the Trace
    // asynchronously; wait for it to finish before removing the directory, and clear the
    // deleting flag once deletion completes (success or failure).
    const runnings = deps.manager.beginAgentDeletion(projectId, agentId);
    try {
      await settleWithin(runnings, 5000);
      await deps.agentService.deleteAgent(projectId, agentId);
      deps.sessionsRepo.deleteByAgent(projectId, agentId);
      // Trace-index rows describe files the rm above just removed: drop them with the Agent.
      deps.traceIndex.removeAgent(projectId, agentId);
      // Per-Agent runtime state keyed on the now-removed sessions/agent: drop it so nothing is
      // orphaned (session ids are never reused, so a leftover row is dead weight). Usage records
      // are deliberately kept — historical stats survive Agent deletion (see deleteAgent).
      deps.schedulesRepo.deleteByAgent(projectId, agentId);
      deps.errorsRepo.deleteByAgent(projectId, agentId);
      // The Agent's API exposure goes with it: a later Agent created under the same id starts
      // off, and no key minted for this one opens it.
      deps.agentApi.deleteByAgent(projectId, agentId);
    } finally {
      deps.manager.endAgentDeletion(projectId, agentId);
    }
    return c.body(null, 204);
  });

  return app;
}
