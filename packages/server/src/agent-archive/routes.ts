/**
 * Agent archive routes, mounted at /api/projects/:projectId/agents (api/types.ts, "Agent
 * archive", has the wire contract):
 *
 *   GET  /:agentId/archive?<parts>          member: the zip, streamed
 *   GET  /:agentId/archive/preview?<parts>  member: what that zip would hold
 *   POST /import?agentId=&overwrite=1       member; owner with overwrite: a zip or an old
 *                                           `.tar.gz` Agent State package, as the raw body
 */
import { Hono } from "hono";
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import type { AppEnv } from "../auth/middleware.js";
import type { Clock, Paths } from "../hmr/capabilities.js";
import { HttpError } from "../http/errors.js";
import { requireValidId } from "../http/validate.js";
import type { AgentApi } from "../mechanisms/agent-api.js";
import type { AgentConfig, AgentLifecycle, Snapshots } from "../mechanisms/agents.js";
import type { Access } from "../mechanisms/projects.js";
import type { SessionIndex } from "../mechanisms/sessions.js";
import type { TraceIndex, TraceIndexStore, Traces } from "../mechanisms/traces.js";
import type { Workbenches } from "../mechanisms/workbenches.js";
import type { OrgService } from "../runtime/organization/service.js";
import { Sessions as ManagerIface, SessionServiceIface } from "../runtime/session-manager.js";
import type { SessionManager } from "../runtime/session-manager.js";
import type { SessionService } from "../services/session-service.js";
import type { AgentSummaryDeps } from "../http/routes/agent-summary.js";
import { partsFromQuery } from "./manifest.js";

/** What this route group reaches — bound by its module (AgentArchiveRoutes below). */
export interface AgentArchiveRouteDeps {
  root: string;
  now: () => Date;
  access: Access;
  agentConfigService: AgentConfig;
  agentService: AgentLifecycle;
  snapshots: Snapshots;
  workbenches: Pick<Workbenches, "whileReleased">;
  traceIndex: TraceIndex;
  traceStore: TraceIndexStore;
  traces: Traces;
  sessionsRepo: SessionIndex;
  /** How an imported Agent is answered: the same card the Agents list shows. */
  summary: AgentSummaryDeps;
}

function notYet(): never {
  throw new HttpError(501, "not_implemented", "The Agent archive is not implemented yet.");
}

export function agentArchiveRoutes(deps: AgentArchiveRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/:agentId/archive/preview", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.access.requireProjectAccess(c.var.user.userId, projectId);
    await deps.agentConfigService.requireExists(projectId, agentId);
    partsFromQuery((name) => c.req.query(name));
    return notYet();
  });

  app.get("/:agentId/archive", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.access.requireProjectAccess(c.var.user.userId, projectId);
    await deps.agentConfigService.requireExists(projectId, agentId);
    partsFromQuery((name) => c.req.query(name));
    return notYet();
  });

  app.post("/import", (c) => {
    const projectId = requireValidId(c, "projectId");
    const overwrite = c.req.query("overwrite") === "1";
    if (overwrite) deps.access.requireProjectOwner(c.var.user.userId, projectId);
    else deps.access.requireProjectAccess(c.var.user.userId, projectId);
    return notYet();
  });

  return app;
}

@Component({
  contributes: {
    "HttpModule.routes": [
      {
        id: "agent-archive",
        prefix: "/api/projects/:projectId/agents",
        auth: "user",
        order: 145,
      },
    ],
  },
})
export class AgentArchiveRoutes {
  @Use() private readonly paths!: Paths;
  @Use() private readonly clock!: Clock;
  @Use() private readonly access!: Access;
  @Use() private readonly agentConfig!: AgentConfig;
  @Use() private readonly agents!: AgentLifecycle;
  @Use() private readonly snapshots!: Snapshots;
  @Use() private readonly workbenches!: Workbenches;
  @Use() private readonly traceIndex!: TraceIndex;
  @Use() private readonly traceStore!: TraceIndexStore;
  @Use() private readonly traces!: Traces;
  @Use() private readonly sessionsRepo!: SessionIndex;
  @Use() private readonly manager!: ManagerIface;
  @Use() private readonly sessionService!: SessionServiceIface;
  @Use() private readonly agentApi!: AgentApi;
  @Use() private readonly orgService!: OrgService;
  @Bind("agent-archive") routes!: Hono<AppEnv>;

  setup() {
    const clock = this.clock;
    this.routes = agentArchiveRoutes({
      root: this.paths.root,
      now: () => clock.now(),
      access: this.access,
      agentConfigService: this.agentConfig,
      agentService: this.agents,
      snapshots: this.snapshots,
      workbenches: this.workbenches,
      traceIndex: this.traceIndex,
      traceStore: this.traceStore,
      traces: this.traces,
      sessionsRepo: this.sessionsRepo,
      summary: {
        agentApi: this.agentApi,
        manager: this.manager as SessionManager,
        orgService: this.orgService,
        sessionService: this.sessionService as SessionService,
      },
    });
  }
}
