/**
 * What makes a workflow an organization's company workflow (company-workflows.ts): the
 * interfaces it is written against, what this plugin publishes into its tree — `CompanyHost` as
 * `Host`, and the Action registry's slot as module `CompanyActionRegistry` — and the words of its
 * `.harness/README.md`. The loader is the server's (WorkflowLoader), the same one an Agent's
 * workflows go through.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { OrgView, WorkflowLoadRequest } from "@prismshadow/penguin-server/plugin";
import {
  ActionRefusal,
  type CompanyDeployResult,
  type CompanyOrganization,
} from "./action-model.js";
import { liveRuns } from "./action-live.js";
import { deployProcess } from "./deploy.js";

/** An interface table, as the loader takes a plugin's. */
export type IfaceTable = NonNullable<WorkflowLoadRequest["table"]>;

const PKG = "@prismshadow/penguin-plugin-company-proposals";
/** What a company workflow's root requires as `host`, from module `Host`. */
export const COMPANY_HOST_IFACE = `${PKG}#CompanyHost`;
/** The interface declaring the registry's slot: what the sink module provides. */
export const COMPANY_ACTIONS_IFACE = `${PKG}#CompanyActions`;
export const HOST_MODULE = "Host";
export const REGISTRY_MODULE = "CompanyActionRegistry";
export const SLOT_KEY = `${REGISTRY_MODULE}.actions`;
/** The entry whose declarations a company workflow imports its types from. */
export const DEPLOY_TYPES_MODULE = `${PKG}/deploy`;

/** A company workflow's default export, in terms of the rendered `CompanyHost`. */
export const COMPANY_PACKAGE_TYPES = `
export interface WorkflowModuleCtx<Use> {
  use: Use;
  /** Runs when the tree is disposed (a reload, a removal, the plugin going away). */
  effect(dispose: () => void): void;
}
/** What a module answers: its provided apis, and the code half of each contribution, by its id. */
export interface WorkflowModuleInstance {
  api?: Record<string, unknown>;
  bind?: Record<string, unknown>;
}
export interface WorkflowRootModule {
  create(ctx: WorkflowModuleCtx<{ host: CompanyHost }>): WorkflowModuleInstance;
}
/** Any other module of the package: what it uses is whatever its own manifest requires. */
export interface WorkflowModule {
  create(ctx: WorkflowModuleCtx<Record<string, unknown>>): WorkflowModuleInstance;
}
/** The default export of index.ts: \`export default { … } satisfies WorkflowPackage\`. */
export interface WorkflowPackage {
  modules: { Workflow: WorkflowRootModule; [name: string]: WorkflowRootModule | WorkflowModule };
}
`;

export const COMPANY_README = `# This company workflow, as the server loading it sees it

Written by the server; edits here are overwritten. \`plugin.d.ts\` and \`ifaces.json\` in this folder
are the types this workflow was written against — delete \`.harness/\` to take the running ones
afresh.

A company workflow customizes how its organization works: what it contributes to the Action
registry takes effect in this organization as soon as it loads, and only here.

## Files

- \`package.json\` — \`"type": "module"\`, and the manifest under \`penguin.modules\`: a module named
  \`Workflow\` that requires \`host\` (\`${COMPANY_HOST_IFACE}\`, from \`Host\`) and
  contributes to \`${SLOT_KEY}\`.
- \`index.ts\` — TypeScript. \`export default { modules: { Workflow: { create(ctx) { … return { bind:
  { "<contribution id>": code } } } } } } satisfies WorkflowPackage\`; \`WorkflowPackage\` from
  \`@prismshadow/penguin-server/plugin\` (it resolves to \`.harness/plugin.d.ts\`), the Action model
  (\`ActionCode\`, \`GuardCode\`, \`HookCode\`, \`RunContext\`) from \`${DEPLOY_TYPES_MODULE}\`. Both are
  TYPES: import them with \`import type\`. Nothing is installed beside the workflow, so what it does
  at run time goes through \`ctx.use.host\`.

## Contributions

One entry per contribution, its code bound under its id:

\`\`\`json
"contributes": {
  "${SLOT_KEY}": [
    { "id": "acme.deploy.staging", "kind": "action", "key": "deploy.staging",
      "subjects": ["proposal", "change_request", "branch"],
      "params": { "expectedHead?": "string", "args?": "string[]" }, "commit": true,
      "description": "Deploy the commit to staging." },
    { "id": "acme.approve", "kind": "guard", "key": "proposal.approve" },
    { "id": "acme.after-approve", "kind": "hook", "key": "proposal.approve", "when": "after" }
  ]
}
\`\`\`

- \`action\`: an Action of the organization. One whose key a built-in Action has takes its place.
- \`guard\`: replaces the guard of \`key\`; its code is \`(defaults) => (input) => …\`, handed the
  guard it replaces. Return to allow; throw an error carrying a 4xx \`status\` and a \`code\` to
  refuse.
- \`hook\`: runs \`before\` (it may refuse) or \`after\` the Action of \`key\`; \`deploy.*\` follows
  every key under \`deploy.\`.
- The \`workflow.*\` Actions — how the organization changes its workflows — are never replaced or
  hooked; such a contribution is left out.

A deploy's run calls \`host.deploy(ctx.runId, argv)\`: the argument vector, in the organization's
shared workspace, with the subject's commit in \`PENGUIN_DEPLOY_HEAD\` and the rest of the
\`PENGUIN_DEPLOY_*\` environment, stopped after an hour.

## Did it load

Writing the workflow (\`penguin org workflow put\`) loads it, and the run says whether it loaded and
why not; a version that does not load leaves the previous one in force. \`penguin org workflow ls\`
shows each workflow's state, \`penguin org workflow rollback\` restores an earlier version.
`;

/** The plugin package's directory: the nearest one above this module with its package.json. */
export function packageDir(): string | null {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    try {
      const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as {
        name?: unknown;
      };
      if (pkg.name === PKG) return dir;
    } catch {
      // Not here; one level up.
    }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

/** What the loader needs of this package: its interface table, and the deploy entry's declarations. */
export interface CompanyKind {
  /** The package's generated table; null when it is not built (no ifaces.json). */
  table: IfaceTable | null;
  typeModules: Record<string, string>;
}

export function companyKind(dir: string | null): CompanyKind {
  if (dir === null) return { table: null, typeModules: {} };
  let table: IfaceTable | null = null;
  try {
    const raw = JSON.parse(readFileSync(path.join(dir, "ifaces.json"), "utf8")) as IfaceTable;
    if (typeof raw.ifaces === "object" && raw.ifaces !== null) {
      table = { ifaces: raw.ifaces, types: raw.types ?? {} };
    }
  } catch {
    table = null;
  }
  const dts = path.join(dir, "dist", "deploy.d.ts");
  return { table, typeModules: existsSync(dts) ? { [DEPLOY_TYPES_MODULE]: dts } : {} };
}

/** The `CompanyHost` published into a company workflow of `org`. */
export function companyHost(org: OrgView, workflowId: string, log: (line: string) => void) {
  const orgKey = `${org.projectId}/${org.orgId}`;
  const organization: CompanyOrganization = {
    projectId: org.projectId,
    orgId: org.orgId,
    name: org.name,
    workspace: org.workspace,
  };
  return {
    organization: (): CompanyOrganization => ({ ...organization }),
    async deploy(runId: string, argv: string[]): Promise<CompanyDeployResult> {
      const live = typeof runId === "string" ? liveRuns().get(runId) : undefined;
      if (live === undefined || live.orgKey !== orgKey || live.ctx === undefined) {
        throw new ActionRefusal(
          404,
          "run_not_found",
          `No run ${String(runId)} of this organization is going: deploy from the run's own code, with ctx.runId.`,
        );
      }
      if (!Array.isArray(argv) || argv.some((a) => typeof a !== "string")) {
        throw new ActionRefusal(400, "bad_argv", "argv must be a list of strings.");
      }
      return deployProcess(live.ctx, live.ctx.key, argv);
    },
    log: (message: string) => log(`[company workflow ${orgKey}/${workflowId}] ${message}`),
  };
}
