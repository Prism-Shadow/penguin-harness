/**
 * Company-mode routes' assembly, bound to the server's own mechanisms (services+routes restack
 * S20): the route factory lives in @prismshadow/penguin-library-organization/routes — this
 * file only binds the ports it takes and contributes the group.
 */
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import type { Hono } from "hono";
import type { AppEnv } from "../../auth/middleware.js";
import type { Settings } from "@prismshadow/penguin-library-setting";
import type { ProjectLifecycle } from "@prismshadow/penguin-library-project";
import type { AgentConfig, AgentLifecycle } from "../../mechanisms/agents.js";
import type { Workbenches } from "../../mechanisms/workbenches.js";
import type { Sessions } from "../../runtime/session-manager.js";
import type { UserDraftsStore } from "@prismshadow/penguin-library-auth";
import type { Schedules, SessionIndex } from "@prismshadow/penguin-library-session";
import type { ErrorLog } from "@prismshadow/penguin-library-observability";
import type { AgentApi } from "@prismshadow/penguin-library-agent-api";
import type { OrgService } from "../../runtime/organization/service.js";
import { organizationRoutes } from "@prismshadow/penguin-library-organization/routes";
import {
  refuseUndeletable,
  removeAgents,
} from "../../services/agent-deletion.js";
import type { AgentDeletionDeps } from "../../services/agent-deletion.js";

@Component({
  contributes: {
    "HttpModule.routes": [
      {
        id: "OrgRoutes.routes",
        prefix: "/api/projects/:projectId/organizations",
        auth: "user",
        order: 145,
      },
    ],
  },
})
export class OrgRoutes {
  @Use() private readonly orgService!: OrgService;
  @Use() private readonly projectService!: ProjectLifecycle;
  @Use() private readonly settings!: Settings;
  // What deleting an employee's Agent with its organization reaches.
  @Use() private readonly agentConfig!: AgentConfig;
  @Use() private readonly agents!: AgentLifecycle;
  @Use() private readonly manager!: Sessions;
  @Use() private readonly workbenches!: Workbenches;
  @Use() private readonly drafts!: UserDraftsStore;
  @Use() private readonly sessionsRepo!: SessionIndex;
  @Use() private readonly traceIndex!: TraceIndex;
  @Use() private readonly schedulesRepo!: Schedules;
  @Use() private readonly errorsRepo!: ErrorLog;
  @Use() private readonly agentApi!: AgentApi;
  @Bind("OrgRoutes.routes") routes!: Hono<AppEnv>;
  setup() {
    // The Agent machinery the delete runs through (services/agent-deletion): its deps stay
    // server-side, bound here; the org delete reaches them through the port the factory takes.
    const agentDeletionDeps: AgentDeletionDeps = {
      agentConfigService: this.agentConfig,
      agentService: this.agents,
      orgService: this.orgService,
      manager: this.manager,
      workbenches: this.workbenches,
      drafts: this.drafts,
      sessionsRepo: this.sessionsRepo,
      traceIndex: this.traceIndex,
      schedulesRepo: this.schedulesRepo,
      errorsRepo: this.errorsRepo,
      agentApi: this.agentApi,
    };
    this.routes = organizationRoutes({
      orgService: this.orgService,
      projectService: this.projectService,
      serverSettingsRepo: this.settings,
      agentDeletion: {
        agentConfigService: {
          exists: (projectId, agentId) => this.agentConfig.exists(projectId, agentId),
          isBuiltinAgent: (projectId, agentId) =>
            this.agentConfig.isBuiltinAgent(projectId, agentId),
        },
        agentDeletion: {
          refuseUndeletable: (projectId, agentId) =>
            refuseUndeletable(agentDeletionDeps, projectId, agentId),
          removeAgents: (projectId, agentIds) =>
            removeAgents(agentDeletionDeps, projectId, agentIds),
        },
      },
    });
  }
}
