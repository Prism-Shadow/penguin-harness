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
import type { AgentArchiveImportResponse, AgentArchivePreview } from "../api/types.js";
import type { Clock, Log, Paths } from "../hmr/capabilities.js";
import { HttpError } from "../http/errors.js";
import { summarizeAgents } from "../http/routes/agent-summary.js";
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
import { planArchive, zipStream } from "./export.js";
import { importAgentArchive } from "./import.js";
import { archiveTooLarge } from "./limits.js";
import { partsFromQuery } from "./manifest.js";

/** What this route group reaches — bound by its module (AgentArchiveRoutes below). */
export interface AgentArchiveRouteDeps {
  root: string;
  now: () => Date;
  log: (line: string) => void;
  access: Access;
  agentConfigService: AgentConfig;
  agentService: AgentLifecycle;
  snapshots: Snapshots;
  workbenches: Pick<Workbenches, "whileReleased">;
  traceIndex: TraceIndex;
  traceStore: TraceIndexStore;
  traces: Traces;
  sessionsRepo: SessionIndex;
  /** The cached runtimes an overwrite invalidates. */
  runtimes: Pick<SessionManager, "invalidateAgentRuntimes">;
  /** How an imported Agent is answered: the same card the Agents list shows. */
  summary: AgentSummaryDeps;
}

/** Why an export past what an import accepts is refused, in the preview's terms. */
function refusalMessage(refusal: NonNullable<AgentArchivePreview["refusal"]>): string {
  switch (refusal.reason) {
    case "entries":
      return `The selection holds more than the ${refusal.limit} entries an import accepts; select fewer Traces.`;
    case "inflated":
      return `The selection is larger than the ${refusal.limit / (1024 * 1024)}MiB an import accepts; select fewer Traces or parts.`;
    case "entry":
      return `${refusal.subject} is larger than the ${refusal.limit / (1024 * 1024)}MiB an import accepts for one file; leave its part out.`;
  }
}

export function agentArchiveRoutes(deps: AgentArchiveRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/:agentId/archive/preview", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.access.requireProjectAccess(c.var.user.userId, projectId);
    await deps.agentConfigService.requireExists(projectId, agentId);
    const parts = partsFromQuery((name) => c.req.query(name));
    const { preview } = await planArchive(deps, projectId, agentId, parts);
    return c.json(preview satisfies AgentArchivePreview);
  });

  app.get("/:agentId/archive", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const agentId = requireValidId(c, "agentId");
    deps.access.requireProjectAccess(c.var.user.userId, projectId);
    await deps.agentConfigService.requireExists(projectId, agentId);
    const parts = partsFromQuery((name) => c.req.query(name));
    const plan = await planArchive(deps, projectId, agentId, parts);
    // Every export imports: a selection past what an import accepts is refused here.
    if (plan.preview.refusal !== undefined) {
      throw archiveTooLarge(refusalMessage(plan.preview.refusal));
    }
    return new Response(zipStream(plan, deps.log), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${plan.fileName}"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
      },
    });
  });

  app.post("/import", async (c) => {
    const projectId = requireValidId(c, "projectId");
    const overwrite = c.req.query("overwrite") === "1";
    // Replacing an Agent's State is a Project-level management operation: owner only.
    if (overwrite) deps.access.requireProjectOwner(c.var.user.userId, projectId);
    else deps.access.requireProjectAccess(c.var.user.userId, projectId);
    const agentIdQuery = c.req.query("agentId");
    const outcome = await importAgentArchive(deps, {
      projectId,
      ...(agentIdQuery !== undefined && agentIdQuery !== "" ? { agentId: agentIdQuery } : {}),
      overwrite,
      body: c.req.raw.body,
    });
    const { agentId, ...result } = outcome;
    const item = (await deps.agentService.listAgents(projectId)).find((a) => a.agentId === agentId);
    if (item === undefined) {
      throw new HttpError(500, "internal", "The imported Agent is missing from the list.");
    }
    const [agent] = await summarizeAgents(deps.summary, projectId, [item]);
    return c.json({ agent: agent!, ...result } satisfies AgentArchiveImportResponse, 201);
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
  @Use() private readonly log!: Log;
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
      log: (line) => this.log.line(line),
      access: this.access,
      agentConfigService: this.agentConfig,
      agentService: this.agents,
      snapshots: this.snapshots,
      workbenches: this.workbenches,
      traceIndex: this.traceIndex,
      traceStore: this.traceStore,
      traces: this.traces,
      sessionsRepo: this.sessionsRepo,
      runtimes: this.manager as SessionManager,
      summary: {
        agentApi: this.agentApi,
        manager: this.manager as SessionManager,
        orgService: this.orgService,
        sessionService: this.sessionService as SessionService,
      },
    });
  }
}
