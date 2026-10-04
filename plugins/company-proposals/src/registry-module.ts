/**
 * CompanyActionRegistry: the Action registry of every organization — the slot
 * `CompanyActionRegistry.actions` (action-model.ts), the write routes, the Activity — and the
 * organizations' company workflows, loaded with the host's WorkflowLoader, whose contributions
 * take effect in their own organization (company-workflows.ts). What the plugins contribute to
 * the slot is built in; the `workflow.*` Actions are the registry's own (workflow-actions.ts).
 *
 * Built anew with every App: a hot update indexes what is contributed then and loads the
 * company workflows again; a run the old instance started ends there.
 */
import type { Hono } from "hono";
import { Bind, Component, Use } from "@prismshadow/penguin-core/plugin";
import type { ClassCtx } from "@prismshadow/penguin-core/plugin";
import type { Log, OrgGateway, Paths, WorkflowLoader } from "@prismshadow/penguin-server/plugin";
import { CompanyActions } from "./action-model.js";
import { ActionRegistry } from "./action-registry.js";
import { ACTION_ROUTES_ID, actionRoutes } from "./action-routes.js";
import type { Contributed } from "./action-index.js";
import { CompanyWorkflows } from "./company-workflows.js";
import { WORKFLOW_ROUTES_ID, workflowContributions, workflowRoutes } from "./workflow-actions.js";
import { runRetireListeners, type RetireListener } from "./org-retire.js";

@Component({
  contributes: {
    "HttpModule.routes": [
      {
        id: "company-proposals.action-routes",
        prefix: "/api/projects/:projectId/organizations/:orgId/actions",
        auth: "user",
        order: 139,
      },
      {
        id: "company-proposals.workflow-routes",
        prefix: "/api/projects/:projectId/organizations/:orgId/workflows",
        auth: "user",
        order: 138,
      },
    ],
  },
})
export class CompanyActionRegistry implements CompanyActions {
  @Use("CompanyModule") private readonly gateway!: OrgGateway;
  @Use("RuntimeModule") private readonly paths!: Paths;
  @Use("RuntimeModule") private readonly log!: Log;
  @Use("WorkflowsModule") private readonly loader!: WorkflowLoader;
  @Bind(ACTION_ROUTES_ID) routes!: Hono;
  @Bind(WORKFLOW_ROUTES_ID) workflowRoutes!: Hono;

  setup({ contributions, effect }: ClassCtx) {
    const log = (line: string) => this.log.line(line);
    const workflows = new CompanyWorkflows({ loader: this.loader, root: this.paths.root, log });
    // The `workflow.*` Actions report what the registry built over them leaves out: the
    // closure reads `registry` only when a run calls it, long after it is assigned.
    const registry: ActionRegistry = new ActionRegistry({
      gateway: this.gateway,
      root: this.paths.root,
      log,
      contributions: [
        ...((contributions.actions ?? []) as Contributed[]),
        ...workflowContributions(workflows, (org) => registry.skippedIn(org)),
      ],
      company: workflows,
    });
    effect(() => {
      registry.stop();
      workflows.stop();
    });
    // An organization being deleted: its runs stopped and its store closed, then its company
    // workflow trees dropped — before the proposal service closes its own (org-retire.ts).
    const retire: RetireListener = async (org) => {
      await registry.retire(org.projectId, org.orgId);
      await workflows.retire(org.projectId, org.orgId);
    };
    runRetireListeners.add(retire);
    effect(() => {
      runRetireListeners.delete(retire);
    });
    this.routes = actionRoutes(registry);
    this.workflowRoutes = workflowRoutes(registry, workflows);
  }
}
