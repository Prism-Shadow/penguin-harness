/**
 * The proposals module. It holds the proposal service and contributes the built-in proposal
 * Actions; CompanyActionRegistry (registry-module.ts) declares the Action slot, owns every write
 * route, and runs what the plugins and the organizations' company workflows contribute to it.
 * The slot owner is created after its contributors (a code-half contribution orders it), so it
 * depends on them and never the reverse.
 */
import type { Hono } from "hono";
import { Bind, Component, Use } from "@prismshadow/penguin-core/plugin";
import type { ClassCtx } from "@prismshadow/penguin-core/plugin";
import type {
  AgentLifecycle,
  Log,
  OrgGateway,
  Paths,
  PluginConfig,
} from "@prismshadow/penguin-server/plugin";
import { ProposalService } from "./service.js";
import { ROUTES_ID, proposalRoutes } from "./routes.js";
import { proposalCode } from "./builtin-actions.js";
import { retireListeners, type RetireListener } from "./org-retire.js";
import type { Act, NoticeResult } from "./action-model.js";
import type { ProposalRoadmapLinks, RoadmapModeratorOf } from "./ports.js";

/** The page contribution's id, as the manifest names it. */
export const PAGE_ID = "company-proposals.page";

/**
 * The proposals module: the service over the organization gateway, the settings store and the
 * data root, its read routes on the HttpModule.routes slot, its page on the web slot, and its
 * built-in Actions — every write — on the Action registry's slot. Its manifest is generated
 * into ifaces.json from here.
 */
@Component({
  contributes: {
    "CompanyActionRegistry.actions": [
      {
        id: "company-proposals.action.create",
        kind: "action",
        key: "proposal.create",
        subjects: ["organization"],
        params: {
          author: "string",
          brief: "string",
          "title?": "string",
        },
        description: "Start a proposal: delegate it to an employee, its author.",
      },
      {
        id: "company-proposals.action.publish",
        kind: "action",
        key: "proposal.publish",
        subjects: ["proposal"],
        params: {
          markdown: "string",
        },
        description: "Publish the next revision of a proposal.",
      },
      {
        id: "company-proposals.action.brief",
        kind: "action",
        key: "proposal.brief",
        subjects: ["proposal"],
        params: {
          brief: "string",
        },
        description: "Rewrite a proposal's brief.",
      },
      {
        id: "company-proposals.action.ready",
        kind: "action",
        key: "proposal.ready",
        subjects: ["proposal"],
        description: "Mark a proposal ready to be read.",
      },
      {
        id: "company-proposals.action.author",
        kind: "action",
        key: "proposal.author",
        subjects: ["proposal"],
        params: { author: "string" },
        description: "Hand a proposal to another author; revisions, comments and approvals stand.",
      },
      {
        id: "company-proposals.action.approve",
        kind: "action",
        key: "proposal.approve",
        subjects: ["proposal"],
        description: "Approve the current revision of a proposal.",
      },
      {
        id: "company-proposals.action.reject",
        kind: "action",
        key: "proposal.reject",
        subjects: ["proposal"],
        params: {
          reason: "string",
        },
        description: "Reject a proposal, with a reason.",
      },
      {
        id: "company-proposals.action.merged",
        kind: "action",
        key: "proposal.merged",
        subjects: ["proposal"],
        description: "Report a proposal's impl merged.",
      },
      {
        id: "company-proposals.action.implement",
        kind: "action",
        key: "proposal.implement",
        subjects: ["proposal"],
        params: {
          "agent?": "string",
          "message?": "string",
          "workspace?": "string",
        },
        description: "Open an implementation session for a proposal.",
      },
      {
        id: "company-proposals.action.impl",
        kind: "action",
        key: "proposal.impl",
        subjects: ["proposal"],
        params: {
          "head?": "object",
          "base?": "object",
          "url?": "string",
        },
        description: "Register a proposal's impl: its branch pair, its PR, or both.",
      },
      {
        id: "company-proposals.action.impl-adopt",
        kind: "action",
        key: "proposal.impl.adopt",
        subjects: ["organization"],
        description:
          "Give each proposal without an impl its latest PR material on the delivery repository.",
      },
      {
        id: "company-proposals.action.material",
        kind: "action",
        key: "proposal.material",
        subjects: ["proposal"],
        params: {
          kind: "string",
          url: "string",
          "label?": "string",
        },
        description: "Add a material to a proposal.",
      },
      {
        id: "company-proposals.action.feedback",
        kind: "action",
        key: "proposal.feedback",
        subjects: ["proposal"],
        params: {
          text: "string",
          "runtime?": "boolean",
        },
        description: "Send feedback to a proposal's author.",
      },
      {
        id: "company-proposals.action.discuss",
        kind: "action",
        key: "proposal.discuss",
        subjects: ["proposal"],
        description: "Open a discussion with a proposal's owner.",
      },
      {
        id: "company-proposals.action.conclude",
        kind: "action",
        key: "proposal.conclude",
        subjects: ["discussion"],
        params: {
          text: "string",
        },
        description: "Conclude a discussion: its conclusion goes to the owner's desk.",
      },
      {
        id: "company-proposals.action.comment",
        kind: "action",
        key: "proposal.comment",
        subjects: ["proposal"],
        // A passage (sectionId, start, end, quote) or a target (comment-targets.ts), never both.
        params: {
          "sectionId?": "string",
          "start?": "number.integer",
          "end?": "number.integer",
          "quote?": "string",
          "target?": "object",
          text: "string",
        },
        description:
          "Comment on a passage of a proposal, a scope or test entry, a changed file or changed lines (pending until sent).",
      },
      {
        id: "company-proposals.action.comment-edit",
        kind: "action",
        key: "proposal.comment.edit",
        subjects: ["comment"],
        params: {
          text: "string",
        },
        description: "Reword a pending comment.",
      },
      {
        id: "company-proposals.action.comment-withdraw",
        kind: "action",
        key: "proposal.comment.withdraw",
        subjects: ["comment"],
        description: "Withdraw a pending comment.",
      },
      {
        id: "company-proposals.action.request-changes",
        kind: "action",
        key: "proposal.requestChanges",
        subjects: ["proposal"],
        description: "Send the caller's pending comments as one batch.",
      },
      {
        id: "company-proposals.action.resolve",
        kind: "action",
        key: "proposal.resolve",
        subjects: ["comment"],
        params: {
          "text?": "string",
        },
        description: "Resolve a sent comment.",
      },
      {
        id: "company-proposals.action.target-register",
        kind: "action",
        key: "target.register",
        subjects: ["organization"],
        params: {
          id: "string",
          "url?": "string",
        },
        description: "Register a deploy target (a deployment) of the organization.",
      },
      {
        id: "company-proposals.subjects",
        kind: "subject",
        subjects: [
          "organization",
          "proposal",
          "comment",
          "discussion",
          "branch",
          "change_request",
          "target",
        ],
      },
      {
        // Once a deploy ended, the PR graph probes the deployments again.
        id: "company-proposals.hook.deploy-refresh",
        kind: "hook",
        key: "deploy.*",
        when: "after",
      },
    ],
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
  // The code halves of the contributions to CompanyActionRegistry.actions (builtin-actions.ts).
  @Bind("company-proposals.action.create") createAction!: unknown;
  @Bind("company-proposals.action.publish") publishAction!: unknown;
  @Bind("company-proposals.action.brief") briefAction!: unknown;
  @Bind("company-proposals.action.ready") readyAction!: unknown;
  @Bind("company-proposals.action.author") authorAction!: unknown;
  @Bind("company-proposals.action.approve") approveAction!: unknown;
  @Bind("company-proposals.action.reject") rejectAction!: unknown;
  @Bind("company-proposals.action.merged") mergedAction!: unknown;
  @Bind("company-proposals.action.implement") implementAction!: unknown;
  @Bind("company-proposals.action.impl") implAction!: unknown;
  @Bind("company-proposals.action.impl-adopt") implAdoptAction!: unknown;
  @Bind("company-proposals.action.material") materialAction!: unknown;
  @Bind("company-proposals.action.feedback") feedbackAction!: unknown;
  @Bind("company-proposals.action.discuss") discussAction!: unknown;
  @Bind("company-proposals.action.conclude") concludeAction!: unknown;
  @Bind("company-proposals.action.comment") commentAction!: unknown;
  @Bind("company-proposals.action.comment-edit") commentEditAction!: unknown;
  @Bind("company-proposals.action.comment-withdraw") commentWithdrawAction!: unknown;
  @Bind("company-proposals.action.request-changes") requestChangesAction!: unknown;
  @Bind("company-proposals.action.resolve") resolveAction!: unknown;
  @Bind("company-proposals.action.target-register") targetRegisterAction!: unknown;
  @Bind("company-proposals.subjects") subjects!: unknown;
  @Bind("company-proposals.hook.deploy-refresh") deployRefresh!: unknown;
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
    // An organization being deleted: what the service holds of it (org-retire.ts).
    const retire: RetireListener = (org) => service.retire(org.projectId, org.orgId);
    retireListeners.add(retire);
    effect(() => {
      retireListeners.delete(retire);
    });
    this.routes = proposalRoutes(service);
    const code = proposalCode(service);
    this.createAction = code["company-proposals.action.create"];
    this.publishAction = code["company-proposals.action.publish"];
    this.briefAction = code["company-proposals.action.brief"];
    this.readyAction = code["company-proposals.action.ready"];
    this.authorAction = code["company-proposals.action.author"];
    this.approveAction = code["company-proposals.action.approve"];
    this.rejectAction = code["company-proposals.action.reject"];
    this.mergedAction = code["company-proposals.action.merged"];
    this.implementAction = code["company-proposals.action.implement"];
    this.implAction = code["company-proposals.action.impl"];
    this.implAdoptAction = code["company-proposals.action.impl-adopt"];
    this.materialAction = code["company-proposals.action.material"];
    this.feedbackAction = code["company-proposals.action.feedback"];
    this.discussAction = code["company-proposals.action.discuss"];
    this.concludeAction = code["company-proposals.action.conclude"];
    this.commentAction = code["company-proposals.action.comment"];
    this.commentEditAction = code["company-proposals.action.comment-edit"];
    this.commentWithdrawAction = code["company-proposals.action.comment-withdraw"];
    this.requestChangesAction = code["company-proposals.action.request-changes"];
    this.resolveAction = code["company-proposals.action.resolve"];
    this.targetRegisterAction = code["company-proposals.action.target-register"];
    this.subjects = code["company-proposals.subjects"];
    this.deployRefresh = code["company-proposals.hook.deploy-refresh"];
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
   * brief is approved again (ProposalService.rebriefFromRoadmap), its author told through the
   * approval run's notices when given. Answers false, writing nothing, when that proposal is
   * merged or rejected: the roadmap creates a new one instead.
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
    notify?: Act["notify"],
  ): Promise<boolean> {
    return this.service.rebriefFromRoadmap(projectId, orgId, number, req, notify);
  }

  /** Who moderates a roadmap, provided by company-roadmaps while its App runs (ports.ts); answers the withdrawal. */
  provideRoadmapModerators(moderatorOf: RoadmapModeratorOf): () => void {
    return this.service.provideRoadmapModerators(moderatorOf);
  }

  /** Which roadmaps each proposal belongs to, provided by company-roadmaps while its App runs (ports.ts). */
  provideProposalRoadmaps(links: ProposalRoadmapLinks): () => void {
    return this.service.roadmapLinks.provide(links);
  }

  /** What the built-in proposal notices deliver (notify-actions.ts, ProposalService.deliverNotice). */
  deliverNotice(
    projectId: string,
    orgId: string,
    number: number,
    to: readonly string[],
    line: string,
    caller: { principal: string },
  ): Promise<NoticeResult> {
    return this.service.deliverNotice(projectId, orgId, number, to, line, caller);
  }
}
