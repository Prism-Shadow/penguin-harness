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
 * employees, routes.ts the API, deploy.ts the organization's deploy scripts and their runs. The page is the web app's own `OrgProposalsPage` renderer,
 * declared here as a company-mode page so it appears — with its nav row — only while the
 * plugin is installed.
 */
import type { Hono } from "hono";
import { Bind, Component, Use } from "@prismshadow/penguin-core/plugin";
import type { ClassCtx, Plugin } from "@prismshadow/penguin-core/plugin";
import type {
  AgentLifecycle,
  Log,
  OrgGateway,
  Paths,
  PluginConfig,
} from "@prismshadow/penguin-server/plugin";
import { ProposalService } from "./service.js";
import { DeployService } from "./deploy.js";
import { ROUTES_ID, proposalRoutes } from "./routes.js";
import {
  retireListeners,
  retireRegistered,
  type OrgRef,
  type RetireListener,
} from "./org-retire.js";

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
export { defaultRules } from "./guards.js";
export type { Caller, ProposalRules } from "./guards.js";
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
  DEPLOY_SCRIPTS_FILE,
  DEPLOY_TIMEOUT_MS,
  DeployService,
  OUTPUT_LIMIT,
  RUNS_KEPT,
  SCRIPT_ID,
} from "./deploy.js";
export type { DeployDeps, DeployRequest, DeployScope } from "./deploy.js";
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

/** The page contribution's id, as the manifest names it. */
export const PAGE_ID = "company-proposals.page";

/**
 * The plugin's one module: the service over the organization gateway, the settings store
 * and the data root, its routes on the HttpModule.routes slot, its page on the web slot.
 * Its manifest is generated into ifaces.json from here.
 */
@Component({
  contributes: {
    "HttpModule.routes": [
      {
        id: "company-proposals.routes",
        prefix: "/api/projects/:projectId/organizations/:orgId/proposals",
        auth: "user",
        order: 140,
      },
    ],
    "WebModule.pages": [
      {
        id: "company-proposals.page",
        key: "org-proposals",
        path: "proposals/:number?",
        nav: "org",
        admin: false,
        renderer: { builtin: "OrgProposalsPage" },
      },
    ],
    "PluginConfigProvider.groups": [
      {
        // A manifest is data: these literals repeat config.ts's CONFIG_GROUP, TEST_GROUP_LINE
        // and DEFAULT_TEST_GROUPS, and a test holds the two copies together.
        id: "company-proposals",
        title: "Company proposals",
        titleZh: "公司提案",
        description:
          "Proposals in company mode. The settings apply to every organization on this server.",
        descriptionZh: "公司模式下的提案。设置对本服务器上的所有组织生效。",
        properties: {
          testGroups: {
            type: "list",
            title: "Test groups",
            titleZh: "测试分组",
            description:
              "One group per line, as `id: what it covers`. A proposal's tests may only use these groups, and the proposal page shows them in this order.",
            descriptionZh:
              "每行一个分组，写作 `id: 覆盖范围`。提案的测试只能使用这些分组，提案页按此顺序展示。",
            pattern: "^[a-z0-9_-]{1,32}: \\S.*$",
            patternErrorMessage:
              "lines must read `id: description` (id: lower-case letters, digits, - or _)",
            default: [
              "unit: one module in isolation, no I/O",
              "integration: several modules together, real storage or network",
              "e2e: the product end to end, through its UI or CLI",
              "bench: performance measurements",
            ],
          },
          deliveryRepo: {
            type: "string",
            title: "Delivery repository",
            titleZh: "交付仓库",
            description:
              "`owner/repo` the impl PRs are opened on. The PR graph reads its open PRs; while this is empty it reads the shared workspace's GitHub remote that holds the most impl PRs (`origin` otherwise), on the stack base below, or the repository's default branch when that is empty.",
            descriptionZh:
              "impl PR 开在哪个仓库（`owner/repo`）。PR 关系图读它的 open PR；留空时改读共享工作区里登记 impl PR 最多的那个 GitHub remote（都没有则取 `origin`），基座取下面的栈底分支，栈底分支留空时取该仓库的默认分支。",
            placeholder: "owner/repo",
            default: "",
          },
          deliveryBase: {
            type: "string",
            title: "Stack base branch",
            titleZh: "栈底分支",
            description: "The branch the bottom PR of the stack is based on.",
            descriptionZh: "栈最底那张 PR 的 base 分支。",
            default: "dev",
          },
          origins: {
            type: "list",
            title: "Origins",
            titleZh: "各 origin",
            description:
              "Other repositories the graph annotates, one per line as `name=owner/repo`: each node shows that repository's PR on the same branch and how its head stands. While this is empty, the shared workspace's other GitHub remotes.",
            descriptionZh:
              "关系图要标注的其他仓库，每行一个，写作 `name=owner/repo`：每个节点标出该仓库在同名分支上的 PR 及其 head 的关系。留空时取共享工作区的其余 GitHub remote。",
            pattern: "^[a-z0-9_-]{1,32}=[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$",
            patternErrorMessage: "lines must read `name=owner/repo`",
            default: [],
          },
          graphRefreshMinutes: {
            type: "number",
            title: "PR graph refresh (minutes)",
            titleZh: "PR 关系图刷新间隔（分钟）",
            description:
              "How stale the PR graph may grow: a read older than this probes the delivery repository again (doubling up to 30 minutes while nothing changes). The page's refresh button reads it at once.",
            descriptionZh:
              "PR 关系图最多陈旧多久：超过这个时间的读取会重新探测交付仓库（无变化时间隔逐次加倍，最长 30 分钟）。页面上的刷新按钮立即刷新。",
            minimum: 1,
            maximum: 30,
            default: 5,
          },
        },
      },
    ],
    "WebModule.quickStarts": [
      {
        id: "company-proposals.quick-start",
        prompt:
          "Explain how proposals work in this organization — who delegates one, who writes it, who builds it and how the person reviews it — and walk me through the `penguin org proposal` commands an author, an implementer and a tester use.",
        promptZh:
          "讲一讲这个组织里的提案是怎么运转的——谁委托、谁写、谁实施、人怎么审——并带我过一遍作者、实施者与测试者各自会用到的 `penguin org proposal` 命令。",
      },
    ],
  },
  context: { version: 1 },
})
export class CompanyProposalsPlugin {
  @Use("CompanyModule") private readonly gateway!: OrgGateway;
  @Use("AgentsModule") private readonly agents!: AgentLifecycle;
  @Use("RuntimeModule") private readonly paths!: Paths;
  @Use("RuntimeModule") private readonly log!: Log;
  @Use("PluginConfigModule") private readonly pluginConfig!: PluginConfig;
  @Bind(ROUTES_ID) routes!: Hono;
  private service!: ProposalService;

  setup({ effect }: ClassCtx) {
    const service = new ProposalService({
      gateway: this.gateway,
      agents: this.agents,
      root: this.paths.root,
      log: this.log,
      pluginConfig: this.pluginConfig,
    });
    this.service = service;
    // The stores close and the graph refreshes stop with the App (a hot update starts anew).
    effect(() => {
      service.close();
    });
    const deploys = new DeployService({
      scope: (projectId, orgId, actor) => service.deployScope(projectId, orgId, actor),
      root: this.paths.root,
      log: (line) => this.log.line(line),
      onFinished: (projectId, orgId) => service.deployFinished(projectId, orgId),
    });
    this.routes = proposalRoutes(service, deploys);
    // An organization being deleted: its deploy runs, then the rest of what the service holds.
    const retire: RetireListener = (org) =>
      service.retire(org.projectId, org.orgId, () => deploys.retire(org.projectId, org.orgId));
    retireListeners.add(retire);
    effect(() => {
      retireListeners.delete(retire);
    });
  }

  /**
   * The proposal of an approved roadmap item: what company-roadmaps calls, by this module's
   * name, when an item's second approval lands (ProposalService.createFromRoadmap). Returns
   * the new proposal's number.
   */
  createFromRoadmap(
    projectId: string,
    orgId: string,
    req: {
      author: string;
      title: string;
      brief: string;
      delegatedBy: string;
      roadmap: { number: number; key: string };
    },
  ): Promise<number> {
    return this.service.createFromRoadmap(projectId, orgId, req);
  }

  /**
   * The brief of the proposal a roadmap item is linked to, rewritten when the item's changed
   * brief is approved again (ProposalService.rebriefFromRoadmap). Answers false, writing
   * nothing, when that proposal is merged or rejected: the roadmap creates a new one instead.
   */
  rebriefFromRoadmap(
    projectId: string,
    orgId: string,
    number: number,
    req: {
      owner: string;
      brief: string;
      delegatedBy: string;
      roadmap: { number: number; key: string };
    },
  ): Promise<boolean> {
    return this.service.rebriefFromRoadmap(projectId, orgId, number, req);
  }
}

/** The retirement's contribution id, as the manifest names it. */
export const RETIRE_ID = "company-proposals.retirement";

/**
 * The retirement, as a node of its own: it contributes to the organization module, so it must
 * not require the organization gateway that module provides (a cycle). It hands the
 * organization to the retirements the plugin's module registered (org-retire.ts).
 */
@Component({
  contributes: {
    "OrganizationModule.retirements": [
      {
        id: "company-proposals.retirement",
        description:
          "Stops the organization's PR graph refresh and deploy runs and closes its proposals database.",
      },
    ],
  },
})
export class ProposalsRetirement {
  @Bind(RETIRE_ID) retire!: (org: OrgRef) => Promise<void>;

  setup() {
    this.retire = retireRegistered;
  }
}

const plugin: Plugin = { modules: [CompanyProposalsPlugin, ProposalsRetirement] };

export default plugin;
