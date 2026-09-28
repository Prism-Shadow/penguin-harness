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
 * sessions through the session runtime (service.ts's relay). Establishing a roadmap archives it
 * and delegates each proposal to its owner, who creates it with company-proposals.
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
import { ROUTES_ID, roadmapRoutes } from "./routes.js";

export {
  Ledger,
  LEDGER_FILE,
  applyLine,
  foldLedger,
  ledgerPath,
  orgDirOf,
  parseLedger,
} from "./ledger.js";
export type {
  Clone,
  Delegation,
  DraftItem,
  LedgerEntry,
  LedgerLine,
  ProposalItem,
  Roadmap,
  RoadmapItem,
  RoadmapStatus,
} from "./ledger.js";
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
  RoadmapError,
  RoadmapService,
  basesOf,
  headingsOf,
  moderatorOf,
  parseItems,
  unknownCites,
} from "./service.js";
export type { RoadmapView, ServiceDeps, WriteResult } from "./service.js";
export { CONFIG_GROUP, DEFAULT_POLL_SECONDS, DEFAULT_RELAY_DEPTH, configOf } from "./config.js";
export { ROUTES_ID, roadmapRoutes } from "./routes.js";

/** The channel claim's contribution id, as the manifest names it. */
export const CLAIM_ID = "company-roadmaps.channel-claim";

/**
 * The plugin's one module: the service over the organization gateway, the session runtime and
 * the data root, its routes on the HttpModule.routes slot, its settings group, and the relay
 * that runs while it is loaded. Its manifest is generated into ifaces.json from here.
 */
@Component({
  contributes: {
    "HttpModule.routes": [
      {
        id: "company-roadmaps.routes",
        prefix: "/api/projects/:projectId/organizations/:orgId/roadmaps",
        auth: "user",
        order: 141,
      },
    ],
    "OrganizationModule.channelClaims": [
      {
        // The room of a roadmap under discussion is handled here: its mentions reach the room
        // sessions through the relay, and no desk is woken (service.ts claims()).
        id: "company-roadmaps.channel-claim",
        description:
          "The room of a roadmap under discussion: its messages reach the room sessions, not desks.",
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
          "Explain how a roadmap works in this organization — the room it is discussed in, the moderator's draft, establishing it, and how its proposals reach their owners — and walk me through opening one over a channel.",
        promptZh:
          "讲一讲这个组织里的路线图是怎么运转的——在哪个讨论室里讨论、主持人的草案、确立，以及它的提案如何交到负责人手上——并带我在一个频道上开一份。",
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
  @Bind(ROUTES_ID) routes!: Hono;
  @Bind(CLAIM_ID) claim!: (channel: OrgChannelRef) => boolean;

  setup({ effect }: ClassCtx) {
    const service = new RoadmapService({
      gateway: this.gateway,
      runner: this.runner,
      sessions: this.sessions,
      root: this.paths.root,
      log: this.log,
      pluginConfig: this.pluginConfig,
    });
    service.start();
    effect(() => {
      void service.stop();
    });
    this.routes = roadmapRoutes(service);
    this.claim = (channel) => service.claims(channel);
  }
}

const plugin: Plugin = { modules: [CompanyRoadmapsPlugin] };

export default plugin;
