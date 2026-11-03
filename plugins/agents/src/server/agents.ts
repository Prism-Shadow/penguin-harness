import type { AgentCreateResponse, AgentsResponse, AgentSummary, Employment } from "@prismshadow/penguin-server/api";
import type { AppEnv } from "@prismshadow/penguin-server/internal";

import type { SessionManager } from "@prismshadow/penguin-server/internal";
import type { SessionService } from "@prismshadow/penguin-server/internal";
import type { AgentConfig, AgentLifecycle } from "@prismshadow/penguin-server/internal";
import type { TraceIndex } from "@prismshadow/penguin-server/internal";
import type { ErrorLog } from "@prismshadow/penguin-server/internal";
import type { Schedules, SessionIndex } from "@prismshadow/penguin-server/internal";
import type { Access } from "@prismshadow/penguin-server/internal";
import type { AgentApi } from "@prismshadow/penguin-server/internal";


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
  workbenches: Pick<Workbenches, "releaseAgent">;
  /** Users' unsent drafts, which go with the Agent's Sessions. */
  drafts: Pick<UserDraftsStore, "deleteByAgent">;
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
    // Refused before any run is touched.
    refuseBuiltinDeletion(agentId);
    // An employee is refused before anything is touched: deleting its Agent would leave the
    // organization's chart naming an Agent that is gone, and its desk naming a Session that is.
    // Leaving the organization is the way out, and it keeps the Agent.
    const employers = await deps.orgService.employersOf(projectId, agentId);
    if (employers.length > 0) throw employedError(agentId, employers);
    // Mark as deleting and converge active runs (beginAgentDeletion): any new Task during
    // this window gets 409, preventing the race where a new task recreates the directory
    // and revives the Agent between abort and the move. Abort cleanup writes the Trace
    // asynchronously; wait for it to finish before moving the directory, and clear the
    // deleting flag once the move is done (success or failure).
    const runnings = deps.manager.beginAgentDeletion(projectId, agentId);
    let deletion: AgentDeletionInfo;
    try {
      await settleWithin(runnings, 5000);
      // What the server itself holds open in the folder lets go before it is moved.
      await deps.workbenches.releaseAgent(projectId, agentId);
      // One rename takes the folder out of every list and route; its contents are removed in
      // the background, which the answer reports and GET /agent-deletions/:id follows.
      deletion = await deps.agentService.deleteAgent(projectId, agentId);
      // Found through the Session index, so before its rows go.
      deps.drafts.deleteByAgent(projectId, agentId);
      deps.sessionsRepo.deleteByAgent(projectId, agentId);
      // Trace-index rows describe files that just left: drop them with the Agent.
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
