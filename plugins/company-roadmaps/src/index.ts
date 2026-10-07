/**
 * @prismshadow/penguin-plugin-company-roadmaps — roadmaps for company mode.
 *
 * A PLUGIN PACKAGE, not part of the harness: a Project lists it in its config and the harness
 * resolves it from the installation. It compiles against the type-only
 * `@prismshadow/penguin-core/plugin` and `@prismshadow/penguin-server/plugin` surfaces and
 * bundles its own copy of Hono for the routes.
 *
 * A roadmap is what a discussion among several employees settles into: a body written as a
 * paper, and the proposals (brief and owner, stacked on one another) and roadmaps it leads to.
 * The discussion happens in an organization channel, an ordinary one: the roadmap's members are
 * its members, and the organization delivers its messages to their desks as it does any
 * channel's. The plugin keeps the channel's members in step with the roadmap's through the
 * organization gateway (members.ts) and otherwise only reads it (room.ts). Establishing a roadmap ends the
 * discussion; a proposal item's last approval (the moderator's and another member's by default)
 * creates its proposal in company-proposals — through that plugin's module, wired below — and
 * links it. Every write is a roadmap Action contributed to company-proposals' Action registry
 * (builtin-actions.ts); the routes here are the reads.
 */
import type { Hono } from "hono";
import { Bind, Component, Use } from "@prismshadow/penguin-core/plugin";
import type { ClassCtx, Plugin } from "@prismshadow/penguin-core/plugin";
import type { OrgGateway, Paths } from "@prismshadow/penguin-server/plugin";
import { RoadmapService } from "./service.js";
import {
  ModeratorRegistration,
  ProposalCreator,
  ProposalRoadmapsRegistration,
  proposalRoadmapLinks,
  roadmapModerators,
} from "./proposals.js";
import { ROUTES_ID, roadmapRoutes } from "./routes.js";
import { roadmapCode } from "./builtin-actions.js";
import { ROADMAP_NOTICE_IDS } from "./notices.js";
import { PAGE_ROUTES_ID, pageRoutes } from "./page.js";
import {
  retireListeners,
  retireRegistered,
  type OrgRef,
  type RetireListener,
} from "./org-retire.js";

export * from "./public.js";

/**
 * The plugin's main module: the service over the organization gateway and the data root, its
 * routes on the HttpModule.routes slot, and its Actions on company-proposals' registry. Its
 * manifest is generated into ifaces.json from here.
 */
@Component({
  contributes: {
    "CompanyActionRegistry.actions": [
      {
        id: "company-roadmaps.action.open",
        kind: "action",
        key: "roadmap.open",
        subjects: ["organization"],
        params: {
          name: "string",
          employees: "string[]",
          "channelId?": "string",
          "brief?": "string",
          "parent?": "number.integer",
        },
        description: "Open a roadmap over a room, or one it opens for itself.",
      },
      {
        id: "company-roadmaps.action.draft",
        kind: "action",
        key: "roadmap.draft",
        subjects: ["roadmap"],
        params: {
          "record?": "string",
          "body?": "string",
          "items?": "object[]",
        },
        description: "Keep a roadmap's draft: its record, body and items.",
      },
      {
        id: "company-roadmaps.action.item-add",
        kind: "action",
        key: "roadmap.item.add",
        subjects: ["roadmap"],
        // One item, as an element of roadmap.draft's items; the run checks it the same way.
        params: {
          key: "string",
          kind: "string",
          title: "string",
          brief: "string",
          "owner?": "string",
          "employees?": "string[]",
          "cites?": "string[]",
          "stackedOn?": "unknown",
          "proposal?": "unknown",
        },
        description: "Add one item to a discussing roadmap's draft, leaving the rest as it is.",
      },
      {
        id: "company-roadmaps.action.item-remove",
        kind: "action",
        key: "roadmap.item.remove",
        subjects: ["roadmap"],
        params: {
          key: "string",
        },
        description:
          "Remove one item from a discussing roadmap's draft, unless it stands for a proposal.",
      },
      {
        id: "company-roadmaps.action.establish",
        kind: "action",
        key: "roadmap.establish",
        subjects: ["roadmap"],
        description:
          "Establish a roadmap: roadmap items derive their roadmaps, proposal items become briefs.",
      },
      {
        id: "company-roadmaps.action.item-approve",
        kind: "action",
        key: "roadmap.item.approve",
        subjects: ["item"],
        description:
          "Approve a proposal item's brief in one of the approval roles; the last creates its proposal.",
      },
      {
        id: "company-roadmaps.action.item-link",
        kind: "action",
        key: "roadmap.item.link",
        subjects: ["item"],
        params: {
          proposal: "number.integer",
        },
        description: "Link a proposal to a proposal item.",
      },
      {
        id: "company-roadmaps.action.adopt",
        kind: "action",
        key: "roadmap.adopt",
        subjects: ["roadmap"],
        params: {
          proposal: "number.integer",
          title: "string",
          owner: "string",
          "brief?": "string",
        },
        description: "Take an existing proposal into a roadmap as a proposal item.",
      },
      {
        id: "company-roadmaps.action.reopen",
        kind: "action",
        key: "roadmap.reopen",
        subjects: ["roadmap"],
        params: {
          reason: "string",
        },
        description: "Reopen an established roadmap: the room discusses again.",
      },
      {
        id: "company-roadmaps.action.rename",
        kind: "action",
        key: "roadmap.rename",
        subjects: ["roadmap"],
        params: {
          name: "string",
        },
        description: "Rename a roadmap.",
      },
      {
        id: "company-roadmaps.action.room",
        kind: "action",
        key: "roadmap.room",
        subjects: ["roadmap"],
        params: {
          channelId: "string",
        },
        description: "Bind the room of a derived roadmap waiting for one.",
      },
      {
        id: "company-roadmaps.action.members",
        kind: "action",
        key: "roadmap.members",
        subjects: ["roadmap"],
        params: {
          employees: "string[]",
          moderator: "string",
        },
        description: "Replace a roadmap's members and name its moderator; the room follows.",
      },
      {
        id: "company-roadmaps.subjects",
        kind: "subject",
        subjects: ["roadmap", "item"],
      },
      // The notices the writes send (notices.ts): replaceable, run only as a write's notice.
      {
        id: "company-roadmaps.notify.room-joined",
        kind: "action",
        key: "notify.roadmap.room_joined",
        subjects: ["roadmap"],
        params: { to: "string[]", text: "string", runId: "string" },
        description: "Tell an employee the roadmap's room it is in, and how to take part there.",
      },
      {
        id: "company-roadmaps.notify.derived",
        kind: "action",
        key: "notify.roadmap.derived",
        subjects: ["roadmap"],
        params: { to: "string[]", text: "string", runId: "string" },
        description: "Tell a derived roadmap's moderator its room is open, or to open one.",
      },
      {
        id: "company-roadmaps.notify.item-approved",
        kind: "action",
        key: "notify.roadmap.item_approved",
        subjects: ["item"],
        params: { to: "string[]", text: "string", runId: "string" },
        description: "Tell an item's owner its proposal was created (or rewritten) on approval.",
      },
      {
        id: "company-roadmaps.notify.base-linked",
        kind: "action",
        key: "notify.roadmap.base_linked",
        subjects: ["item"],
        params: { to: "string[]", text: "string", runId: "string" },
        description: "Tell the owner of a stacked item the number of its base's proposal.",
      },
      {
        id: "company-roadmaps.notify.approval-requested",
        kind: "action",
        key: "notify.roadmap.approval_requested",
        subjects: ["roadmap"],
        params: { to: "string[]", text: "string", runId: "string" },
        description: "Ask the moderator, at its desk, for its approvals of the briefs.",
      },
      {
        id: "company-roadmaps.notify.reopened",
        kind: "action",
        key: "notify.roadmap.reopened",
        subjects: ["roadmap"],
        params: { to: "string[]", text: "string", runId: "string" },
        description: "Tell every member the roadmap is discussed again, and why.",
      },
    ],
    "HttpModule.routes": [
      {
        id: "company-roadmaps.routes",
        prefix: "/api/projects/:projectId/organizations/:orgId/roadmaps",
        auth: "user",
        order: 141,
      },
      {
        // The page's own group: a prefix without parameters, since the iframe's src is data
        // and cannot name the organization (page.ts). These literals repeat PAGE_ROUTES_ID and
        // PAGE_PREFIX, and a test holds the copies together.
        id: "company-roadmaps.page-routes",
        prefix: "/api/company-roadmaps",
        auth: "user",
        order: 142,
      },
    ],
    "WebModule.pages": [
      {
        // The entry after the handbook: a company-mode page (its row follows the organization's
        // own six), drawn by the web app from this key and served whole by this plugin.
        id: "company-roadmaps.page",
        key: "roadmaps",
        path: "roadmaps/:number?",
        nav: "org",
        admin: false,
        renderer: { iframe: { src: "/api/company-roadmaps/page", namespace: "company-roadmaps" } },
      },
    ],
    "WebModule.quickStarts": [
      {
        id: "company-roadmaps.quick-start",
        prompt:
          "Explain how roadmaps work in this organization — how an item is drafted in its room, who has to approve it, and how an established item becomes a delegated proposal — then list the roadmaps this organization has and where each one stands.",
        promptZh:
          "讲一讲这个组织里的路线图是怎么运转的——条目如何在讨论室里起草、需要谁批准、确立后的条目如何变成委托出去的提案——再列出这个组织现有的路线图以及各自进展到哪一步。",
      },
    ],
  },
  context: { version: 1 },
})
export class CompanyRoadmapsPlugin {
  @Use("CompanyModule") private readonly gateway!: OrgGateway;
  @Use("RuntimeModule") private readonly paths!: Paths;
  @Use("CompanyProposalsPlugin") private readonly proposals!: ProposalCreator;
  @Use("CompanyProposalsPlugin") private readonly moderatorSeat!: ModeratorRegistration;
  @Use("CompanyProposalsPlugin") private readonly linksSeat!: ProposalRoadmapsRegistration;
  @Bind(ROUTES_ID) routes!: Hono;
  @Bind(PAGE_ROUTES_ID) page!: Hono;
  // The code halves of the contributions to CompanyActionRegistry.actions (builtin-actions.ts).
  @Bind("company-roadmaps.action.open") openAction!: unknown;
  @Bind("company-roadmaps.action.draft") draftAction!: unknown;
  @Bind("company-roadmaps.action.item-add") itemAddAction!: unknown;
  @Bind("company-roadmaps.action.item-remove") itemRemoveAction!: unknown;
  @Bind("company-roadmaps.action.establish") establishAction!: unknown;
  @Bind("company-roadmaps.action.item-approve") itemApproveAction!: unknown;
  @Bind("company-roadmaps.action.item-link") itemLinkAction!: unknown;
  @Bind("company-roadmaps.action.adopt") adoptAction!: unknown;
  @Bind("company-roadmaps.action.reopen") reopenAction!: unknown;
  @Bind("company-roadmaps.action.rename") renameAction!: unknown;
  @Bind("company-roadmaps.action.room") roomAction!: unknown;
  @Bind("company-roadmaps.action.members") membersAction!: unknown;
  @Bind("company-roadmaps.subjects") subjects!: unknown;
  @Bind("company-roadmaps.notify.room-joined") roomJoinedNotice!: unknown;
  @Bind("company-roadmaps.notify.derived") derivedNotice!: unknown;
  @Bind("company-roadmaps.notify.item-approved") itemApprovedNotice!: unknown;
  @Bind("company-roadmaps.notify.base-linked") baseLinkedNotice!: unknown;
  @Bind("company-roadmaps.notify.approval-requested") approvalRequestedNotice!: unknown;
  @Bind("company-roadmaps.notify.reopened") reopenedNotice!: unknown;

  setup({ effect }: ClassCtx) {
    const service = new RoadmapService({
      gateway: this.gateway,
      proposals: this.proposals,
      root: this.paths.root,
    });
    effect(() => {
      void service.stop();
    });
    this.routes = roadmapRoutes(service);
    this.page = pageRoutes();
    const code = roadmapCode(service);
    this.openAction = code["company-roadmaps.action.open"];
    this.draftAction = code["company-roadmaps.action.draft"];
    this.itemAddAction = code["company-roadmaps.action.item-add"];
    this.itemRemoveAction = code["company-roadmaps.action.item-remove"];
    this.establishAction = code["company-roadmaps.action.establish"];
    this.itemApproveAction = code["company-roadmaps.action.item-approve"];
    this.itemLinkAction = code["company-roadmaps.action.item-link"];
    this.adoptAction = code["company-roadmaps.action.adopt"];
    this.reopenAction = code["company-roadmaps.action.reopen"];
    this.renameAction = code["company-roadmaps.action.rename"];
    this.roomAction = code["company-roadmaps.action.room"];
    this.membersAction = code["company-roadmaps.action.members"];
    this.subjects = code["company-roadmaps.subjects"];
    this.roomJoinedNotice = code[ROADMAP_NOTICE_IDS.room_joined];
    this.derivedNotice = code[ROADMAP_NOTICE_IDS.derived];
    this.itemApprovedNotice = code[ROADMAP_NOTICE_IDS.item_approved];
    this.baseLinkedNotice = code[ROADMAP_NOTICE_IDS.base_linked];
    this.approvalRequestedNotice = code[ROADMAP_NOTICE_IDS.approval_requested];
    this.reopenedNotice = code[ROADMAP_NOTICE_IDS.reopened];
    // company-proposals asks who moderates a roadmap (the default guard of `proposal.author`).
    effect(this.moderatorSeat.provideRoadmapModerators(roadmapModerators(service)));
    // company-proposals asks which roadmaps each proposal belongs to (ProposalItem.roadmaps).
    effect(this.linksSeat.provideProposalRoadmaps(proposalRoadmapLinks(service)));
    // An organization being deleted: its writes awaited, its connection closed (org-retire.ts).
    const retire: RetireListener = (org) => service.retire(org.projectId, org.orgId);
    retireListeners.add(retire);
    effect(() => {
      retireListeners.delete(retire);
    });
  }
}

/** The retirement's contribution id, as the manifest names it. */
export const RETIRE_ID = "company-roadmaps.retirement";

/**
 * The retirement, as a node of its own: it contributes to the organization module, so it must
 * not require the gateway that module provides (a cycle, which the tree refuses to boot). It
 * hands the organization to the retirement the service registered (org-retire.ts).
 */
@Component({
  contributes: {
    "OrganizationModule.retirements": [
      {
        id: "company-roadmaps.retirement",
        description: "Closes the organization's roadmaps database once its writes in flight land.",
      },
    ],
  },
})
export class RoadmapsRetirement {
  @Bind(RETIRE_ID) retire!: (org: OrgRef) => Promise<void>;

  setup() {
    this.retire = retireRegistered;
  }
}

const plugin: Plugin = {
  modules: [CompanyRoadmapsPlugin, RoadmapsRetirement],
};

export default plugin;
