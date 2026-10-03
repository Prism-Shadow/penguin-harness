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
 * The discussion happens in an organization channel, borrowed as it is (room.ts reads it and
 * never writes it); every employee in the room gets its desk cloned for the room — a session of
 * its own opened through the organization gateway — and the room's messages reach those
 * sessions through the session runtime (service.ts's relay). Establishing a roadmap ends the
 * discussion; a proposal item's last approval (the moderator's and another member's by default)
 * creates its proposal in company-proposals — through that plugin's module, wired below — and
 * links it. Every write is a roadmap Action contributed to company-proposals' Action registry
 * (builtin-actions.ts); the routes here are the reads.
 */
import type { Hono } from "hono";
import { Bind, Component, Use } from "@prismshadow/penguin-core/plugin";
import type { ClassCtx, Plugin } from "@prismshadow/penguin-core/plugin";
import type {
  Log,
  MessagingTaskRunner,
  OrgChannelRef,
  OrgGateway,
  Paths,
  PluginConfig,
  SessionIndex,
} from "@prismshadow/penguin-server/plugin";
import { RoadmapService } from "./service.js";
import { ProposalCreator } from "./proposals.js";
import { ROUTES_ID, roadmapRoutes } from "./routes.js";
import { roadmapCode } from "./builtin-actions.js";
import { PAGE_ROUTES_ID, pageRoutes } from "./page.js";
import { claimListeners, roomClaim, type ClaimListener } from "./claim.js";
import {
  retireListeners,
  retireRegistered,
  type OrgRef,
  type RetireListener,
} from "./org-retire.js";

export { RoadmapError, orgDirOf } from "./domain.js";
export type {
  Clone,
  Delegation,
  DraftItem,
  ProposalItem,
  Roadmap,
  RoadmapItem,
  RoadmapStatus,
  RoadmapWrite,
} from "./domain.js";
export { COMPANY_DB, ROADMAP_SCHEMA, companyDbPath, openCompanyDb } from "./schema.js";
export { SqliteRoadmapStore, briefSha } from "./store.js";
export type { RoadmapStore } from "./ports.js";
export {
  DEFAULT_APPROVAL_ROLES,
  approvalRole,
  defaultAct,
  moderatorOf,
  requireStatus,
  roadmapGuards,
  rolesOf,
  verdictRoles,
  withApprovalRoles,
} from "./guards.js";
export type { Caller, WriteAct } from "./guards.js";
export {
  ROADMAP_ACTION_IDS,
  ROADMAP_SUBJECTS_ID,
  roadmapCode,
  writeActOf,
} from "./builtin-actions.js";
export type * from "./action-shapes.js";
export {
  CHANNEL_ID,
  agentMembers,
  endCursor,
  parseMessage,
  readRoom,
  readSince,
  recentMessages,
} from "./room.js";
export type { RoomConfig, RoomCursor, RoomMessage } from "./room.js";
export { planRelay } from "./relay.js";
export type { RelayPlan } from "./relay.js";
export {
  PLUGIN_NAME,
  RECENT_CONTEXT,
  RELAY_FILE,
  RoadmapService,
  basesOf,
  headingsOf,
  parseItems,
  unknownCites,
} from "./service.js";
export type { RoadmapView, ServiceDeps, WriteResult } from "./service.js";
export { CONFIG_GROUP, DEFAULT_POLL_SECONDS, DEFAULT_RELAY_DEPTH, configOf } from "./config.js";
export { ROUTES_ID, roadmapRoutes } from "./routes.js";
export {
  PAGE_PREFIX,
  PAGE_ROUTES_ID,
  PAGE_SRC,
  PAGE_STRINGS,
  PAGE_TIMEOUT_MS,
  THEME_HREF,
  THEME_VARS,
  pageHtml,
  pageRoutes,
} from "./page.js";
export { claimListeners, discussingRoomOf, roomClaim } from "./claim.js";
export { ProposalCreator };
export { RetiredOrgs, retireListeners, retireRegistered } from "./org-retire.js";
export type { OrgRef, RetireListener } from "./org-retire.js";
export type { ChannelRef, ClaimListener } from "./claim.js";

/** The channel claim's contribution id, as the manifest names it. */
export const CLAIM_ID = "company-roadmaps.channel-claim";

/**
 * The plugin's one module: the service over the organization gateway, the session runtime and
 * the data root, its routes on the HttpModule.routes slot, its settings group, and the relay
 * that runs while it is loaded. Its manifest is generated into ifaces.json from here.
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
        id: "company-roadmaps.subjects",
        kind: "subject",
        subjects: ["roadmap", "item"],
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
    "PluginConfigProvider.groups": [
      {
        // A manifest is data: these literals repeat config.ts's CONFIG_GROUP and defaults, and a
        // test holds the two copies together.
        id: "company-roadmaps",
        title: "Company roadmaps",
        titleZh: "公司路线图",
        description:
          "Roadmap rooms in company mode. The settings apply to every organization on this server.",
        descriptionZh: "公司模式下的路线图讨论室。设置对本服务器上的所有组织生效。",
        properties: {
          relayDepth: {
            type: "number",
            title: "Relay depth",
            titleZh: "转发深度",
            description:
              "How far a reply travels between the room sessions: a person's message is depth 0, a reply one more than the message it answers, and a message at this depth reaches no one.",
            descriptionZh:
              "回复在讨论室会话之间最多传几跳：人的消息为 0，回复比它所回应的消息多 1，到达此深度的消息不再转给任何人。",
            minimum: 1,
            maximum: 10,
            default: 3,
          },
          pollSeconds: {
            type: "number",
            title: "Poll interval (seconds)",
            titleZh: "轮询间隔（秒）",
            description: "How often the rooms are read for new messages.",
            descriptionZh: "多久读一次讨论室的新消息。",
            minimum: 1,
            maximum: 300,
            default: 5,
          },
        },
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
  @Use("SessionRuntimeModule") private readonly runner!: MessagingTaskRunner;
  @Use("SessionRuntimeModule") private readonly sessions!: SessionIndex;
  @Use("RuntimeModule") private readonly paths!: Paths;
  @Use("RuntimeModule") private readonly log!: Log;
  @Use("PluginConfigModule") private readonly pluginConfig!: PluginConfig;
  @Use("CompanyProposalsPlugin") private readonly proposals!: ProposalCreator;
  @Bind(ROUTES_ID) routes!: Hono;
  @Bind(PAGE_ROUTES_ID) page!: Hono;
  // The code halves of the contributions to CompanyActionRegistry.actions (builtin-actions.ts).
  @Bind("company-roadmaps.action.open") openAction!: unknown;
  @Bind("company-roadmaps.action.draft") draftAction!: unknown;
  @Bind("company-roadmaps.action.establish") establishAction!: unknown;
  @Bind("company-roadmaps.action.item-approve") itemApproveAction!: unknown;
  @Bind("company-roadmaps.action.item-link") itemLinkAction!: unknown;
  @Bind("company-roadmaps.action.adopt") adoptAction!: unknown;
  @Bind("company-roadmaps.action.reopen") reopenAction!: unknown;
  @Bind("company-roadmaps.action.rename") renameAction!: unknown;
  @Bind("company-roadmaps.action.room") roomAction!: unknown;
  @Bind("company-roadmaps.subjects") subjects!: unknown;

  setup({ effect }: ClassCtx) {
    const service = new RoadmapService({
      gateway: this.gateway,
      runner: this.runner,
      sessions: this.sessions,
      proposals: this.proposals,
      root: this.paths.root,
      log: this.log,
      pluginConfig: this.pluginConfig,
    });
    service.start();
    effect(() => {
      void service.stop();
    });
    this.routes = roadmapRoutes(service);
    this.page = pageRoutes();
    const code = roadmapCode(service);
    this.openAction = code["company-roadmaps.action.open"];
    this.draftAction = code["company-roadmaps.action.draft"];
    this.establishAction = code["company-roadmaps.action.establish"];
    this.itemApproveAction = code["company-roadmaps.action.item-approve"];
    this.itemLinkAction = code["company-roadmaps.action.item-link"];
    this.adoptAction = code["company-roadmaps.action.adopt"];
    this.reopenAction = code["company-roadmaps.action.reopen"];
    this.renameAction = code["company-roadmaps.action.rename"];
    this.roomAction = code["company-roadmaps.action.room"];
    this.subjects = code["company-roadmaps.subjects"];
    // What the claim node claims is relayed at once, not at the next poll (claim.ts).
    const listener: ClaimListener = (channel, number) => {
      setImmediate(() => {
        void service.relayRoadmap(channel.projectId, channel.orgId, number);
      });
    };
    claimListeners.add(listener);
    effect(() => {
      claimListeners.delete(listener);
    });
    // An organization being deleted: its writes awaited, its connection closed (org-retire.ts).
    const retire: RetireListener = (org) => service.retire(org.projectId, org.orgId);
    retireListeners.add(retire);
    effect(() => {
      retireListeners.delete(retire);
    });
  }
}

/**
 * The channel claim, as a node of its own: it contributes to the organization module, so it
 * must not require the organization gateway that module provides (a cycle) — it answers from
 * the organization's store under the data root and hands what it claims to the service (claim.ts).
 */
@Component({
  contributes: {
    "OrganizationModule.channelClaims": [
      {
        id: "company-roadmaps.channel-claim",
        description:
          "The room of a roadmap under discussion: its messages reach the room sessions, not desks.",
      },
    ],
  },
})
export class RoadmapRoomClaim {
  @Use("RuntimeModule") private readonly paths!: Paths;
  @Bind(CLAIM_ID) claim!: (channel: OrgChannelRef) => boolean;

  setup() {
    this.claim = roomClaim(this.paths.root, (channel, number) => {
      for (const listener of claimListeners) listener(channel, number);
    });
  }
}

/** The retirement's contribution id, as the manifest names it. */
export const RETIRE_ID = "company-roadmaps.retirement";

/**
 * The retirement, as a node of its own for the claim's reason: it contributes to the
 * organization module, so it must not require the gateway that module provides. It hands the
 * organization to the retirement the service registered (org-retire.ts).
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
  modules: [CompanyRoadmapsPlugin, RoadmapRoomClaim, RoadmapsRetirement],
};

export default plugin;
