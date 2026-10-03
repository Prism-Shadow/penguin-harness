/**
 * @prismshadow/penguin-plugin-company-proposals — proposals for company mode.
 *
 * A PLUGIN PACKAGE, not part of the harness: a Project lists it in its config and the
 * harness resolves it from the installation (see the server's plugin/loader.ts). It compiles
 * against the type-only `@prismshadow/penguin-core/plugin` and
 * `@prismshadow/penguin-server/plugin` surfaces and bundles its own copy of Hono for the
 * routes.
 *
 * A proposal is a short, abstract, paragraph-commentable account of a change: a person
 * delegates it to an employee, that employee writes it while another builds it, the person
 * reads, comments in batches and approves, and the build lands as a pull request the
 * proposal links as material. The harness lends this package what it already has — the
 * organization (its people, an employee's desk and sessions, the Project's event
 * stream), the data root — through the organization gateway; what makes those a proposal
 * lives here: the organization's relational store (schema.ts, store.ts), markdown.ts the
 * document form, service.ts the state machine and the desk deliveries that drive the
 * employees, routes.ts the reads. Every write is an Action: action-model.ts the model and the
 * slot, action-registry.ts the registry that runs them and records each run (action-store.ts),
 * builtin-actions.ts the proposal Actions, deploy.ts what a company module's deploy Action is
 * lent. The modules are plugin.ts's. The page is the web app's own `OrgProposalsPage` renderer,
 * declared as a company-mode page so it appears — with its nav row — only while the plugin is
 * installed.
 */
import type { Plugin } from "@prismshadow/penguin-core/plugin";
import { CompanyActionRegistry, CompanyProposalsPlugin } from "./plugin.js";
import { ProposalsRetirement } from "./retirement-module.js";

export {
  COMPANY_DB,
  GRAPH_SCHEMA,
  PROPOSAL_SCHEMA,
  companyDbPath,
  openCompanyDb,
} from "./schema.js";
export { ProposalError } from "./domain.js";
export type { Project, Proposal, ProposalImpl, RegisteredDeployment } from "./domain.js";
export type * from "./ports.js";
export { SqliteProposalStore } from "./store-write.js";
export { SqliteGraphStore } from "./graph-store.js";
export { DEPLOYMENTS_FILE, DeploymentStore, deploymentsPath } from "./deploy-store.js";
export {
  afterPublish,
  batchOf,
  createKey,
  defaultAct,
  mergedOnWord,
  proposalGuards,
} from "./guards.js";
export type { Caller, PlannedImpl, WriteAct } from "./guards.js";
export * from "./action-model.js";
export { ActionIndex, execForms, hookCovers } from "./action-index.js";
export type { Bindings, Conflict, Contributed, Indexed } from "./action-index.js";
export { compileParams, compileType } from "./action-params.js";
export { ACTION_SCHEMA, ActionStore, writeStart } from "./action-store.js";
export type { Binding, RunEnd, RunFilter, RunStart, StoredRun } from "./action-store.js";
export { ActionRegistry } from "./action-registry.js";
export type { OrgScope, RegistryDeps, RunAnswer, RunRequest } from "./action-registry.js";
export {
  OUTPUT_LIMIT,
  PROCESS_TIMEOUT_MS,
  liveRuns,
  outputFrom,
  runningCount,
} from "./action-live.js";
export { BIND_ID, BIND_KEY, BIND_PARAMS } from "./action-bind.js";
export { ACTION_ROUTES_ID, actionRoutes } from "./action-routes.js";
export { viewOf } from "./action-views.js";
export {
  DEPLOY_REFRESH_ID,
  PROPOSAL_ACTION_IDS,
  SUBJECTS_ID,
  proposalCode,
  writeActOf,
} from "./builtin-actions.js";
export { branchCommit, changeRequestHead, proposalHead } from "./heads.js";
export type { HeadImpl, HeadScope } from "./heads.js";
export { GithubForge, NoForge } from "./forge.js";
export { LocalGitMirror, githubUrl, mirrorDir } from "./git-mirror.js";
export { GraphRefresher, intervalAfter } from "./graph-refresh.js";
export {
  ProposalDocumentError,
  linksToFile,
  parseProposalDocument,
  renderProposalDocument,
} from "./markdown.js";
export type { ProposalDocument } from "./markdown.js";
export {
  MATERIAL_KINDS,
  PLUGIN_NAME,
  SKILLS_PLUGIN,
  compareDatedVersions,
  ProposalService,
  slugOf,
} from "./service.js";
export type { ServiceDeps } from "./service.js";
export { ROUTES_ID, proposalRoutes } from "./routes.js";
export {
  DEPLOY_PARAMS,
  DEPLOY_SUBJECTS,
  DEPLOY_TIMEOUT_MS,
  argsOf,
  deployEnv,
  deployGuard,
  deployProcess,
} from "./deploy.js";
export { startProcess } from "./deploy-process.js";
export { RetiredOrgs, retireListeners, retireOrg, retireRegistered } from "./org-retire.js";
export type { OrgRef, RetireListener } from "./org-retire.js";
export type { DeployProcess, StartProcess } from "./deploy-process.js";
export {
  CONFIG_GROUP,
  DEFAULT_DELIVERY_BASE,
  DEFAULT_GRAPH_REFRESH_MINUTES,
  DEFAULT_TEST_GROUPS,
  ORIGIN_LINE,
  TEST_GROUP_LINE,
  graphConfigOf,
  testGroupsOf,
  undeclaredGroupsMessage,
} from "./config.js";
export type { GraphConfig } from "./config.js";
export { PrGraphReader, compareInMirror } from "./graph-reader.js";
export { inputsOf, layout, storedFacts } from "./pr-graph.js";
export { buildGraph, pullKey } from "./pr-chain.js";
export type { GraphInput, GraphProposal } from "./pr-chain.js";
export { checkScope, scopeBase, scopeStates, suggestPaths } from "./scope-check.js";
export {
  PARAGRAPH_GAP,
  locateQuote,
  markRanges,
  paragraphAtOffset,
  paragraphSpan,
  renderForAgent,
  sectionSource,
} from "./comments.js";

export {
  CompanyActionRegistry,
  CompanyProposalsPlugin,
  PAGE_ID,
  BUILTIN_MODULES,
} from "./plugin.js";

export { ProposalsRetirement, RETIRE_ID } from "./retirement-module.js";

const plugin: Plugin = {
  modules: [CompanyProposalsPlugin, CompanyActionRegistry, ProposalsRetirement],
};

export default plugin;
