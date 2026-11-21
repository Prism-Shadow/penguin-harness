/**
 * The messaging domain's assembly nodes, bound to the server's own mechanisms
 * (services+http+cli restack S8): the bridge module, its tuning node, and the bot-accounts
 * module. The engine, the connectors and the route factories live in
 * @prismshadow/penguin-library-messaging — this file only binds ports and declares the
 * HTTP route contributions.
 */
import { Bind, Component, Module, Provide, Use } from "@prismshadow/penguin-core/kernel";
import type { Slot, ClassCtx } from "@prismshadow/penguin-core/kernel";
import { Hono } from "hono";
import type { Channels, Clock, Log, Paths } from "../../hmr/capabilities.js";
import type { Machines } from "../../machines/service.js";
import type { AppEnv } from "../../auth/middleware.js";
import { MessagingBridge } from "@prismshadow/penguin-library-messaging/bridge";
import {
  Messaging,
  MessagingChannelConnector,
  MessagingSlots,
  MessagingTaskRunner,
  MessagingTuning,
  QQScan,
  sessionMessagingRoutes,
} from "@prismshadow/penguin-library-messaging/bridge";
import { QQScanService } from "@prismshadow/penguin-library-messaging/qq-scan";
import { WeChatScanService } from "@prismshadow/penguin-library-messaging/wechat-scan";
import type { QQScanTransportHandle } from "@prismshadow/penguin-library-messaging/qq-scan";
import type { WeChatScanTransportHandle } from "@prismshadow/penguin-library-messaging/wechat-scan";
import { FeishuMessaging } from "@prismshadow/penguin-library-messaging/feishu-connector";
import { TelegramMessaging } from "@prismshadow/penguin-library-messaging/telegram-connector";
import { QqMessaging } from "@prismshadow/penguin-library-messaging/qq-connector";
import { WechatMessaging } from "@prismshadow/penguin-library-messaging/wechat-connector";
import {
  messagingAccountsRoutes,
  messagingAccountHoldersRoutes,
} from "@prismshadow/penguin-library-messaging/account-routes";
import type { MessagingBindings } from "@prismshadow/penguin-library-messaging";
import type { SessionIndex } from "@prismshadow/penguin-library-session";
import type { WorkspaceFiles } from "@prismshadow/penguin-library-workspace";
import type { Settings } from "@prismshadow/penguin-library-setting";
import type { Errors } from "@prismshadow/penguin-library-observability";
import type { Access } from "@prismshadow/penguin-library-project";
import { toAttachmentLimits } from "@prismshadow/penguin-library-setting/attachment-limits";

export type { Messaging, MessagingSlots };

@Module({
  contributes: {
    "HttpModule.routes": [
      {
        id: "messaging.session-routes",
        prefix: "/api/sessions",
        auth: "user",
        order: 280,
      },
    ],
  },
  children: [FeishuMessaging, TelegramMessaging, QqMessaging, WechatMessaging],
})
export class MessagingModule {
  @Use() private readonly paths!: Paths;
  @Use() private readonly channels!: Channels;
  @Use() private readonly clock!: Clock;
  @Use() private readonly tuning!: MessagingTuning;
  @Use() private readonly qqScanTransport!: QQScanTransportHandle;
  @Use() private readonly wechatScanTransport!: WeChatScanTransportHandle;
  @Use() private readonly log!: Log;
  @Use() private readonly messagingRepo!: MessagingBindings;
  @Use() private readonly sessionsRepo!: SessionIndex;
  @Use() private readonly workspaceFiles!: WorkspaceFiles;
  @Use() private readonly settings!: Settings;
  @Use() private readonly runner!: MessagingTaskRunner;
  @Use() private readonly errors!: Errors;
  @Use() private readonly access!: Access;
  @Provide() messaging!: Messaging;
  @Provide() qqScan!: QQScan;
  @Bind("messaging.session-routes") sessionRoutesRoutes!: Hono<AppEnv>;
  async setup({ contributions, effect }: ClassCtx) {
    const { lineDelayMs, inboundImageBudgetBytes } = this.tuning;
    const now = () => this.clock.now().getTime();
    const messagingRepo = this.messagingRepo;
    const sessionsRepo = this.sessionsRepo;
    const messaging = new MessagingBridge({
      repo: messagingRepo,
      sessions: sessionsRepo,
      files: this.workspaceFiles,
      root: this.paths.root,
      attachmentLimits: () => toAttachmentLimits(this.settings.getAttachmentLimitsMb()),
      channels: this.channels,
      runner: this.runner,
      // Every connector arrives as a contribution — the built-in three from the child
      // modules, and any other through the same slot.
      connectors: (contributions.connectors ?? []).map((c) => c.code as MessagingChannelConnector),
      errors: this.errors,
      log: (line) => this.log.line(line),
      now,
      ...(lineDelayMs !== undefined ? { lineDelayMs } : {}),
      ...(inboundImageBudgetBytes !== undefined ? { inboundImageBudgetBytes } : {}),
    });
    const qqScan = new QQScanService(this.qqScanTransport.transport, { now });
    // Same shape as the QQ one: what it holds is the handle that collects a bot token
    // rather than a key that decrypts a secret, and is equally not worth persisting.
    const wechatScan = new WeChatScanService(this.wechatScanTransport.transport, { now });
    // Connect every enabled binding; only active while this App is.
    await messaging.start();
    effect(() => messaging.stop());
    this.messaging = messaging;
    this.qqScan = qqScan;
    this.sessionRoutesRoutes = sessionMessagingRoutes({
      messaging,
      messagingRepo,
      access: this.access,
      qqScan,
      wechatScan,
      sessionsRepo,
    });
  }
}

@Component()
export class DefaultMessagingTuning implements MessagingTuning {}

/** The bot-account routes as a node of their own, beside the messaging bridge rather than in it:
 * they read the stored bindings and ask the Project's machines, and never touch a connection.
 * A machine-free server serves them the same way, answering for itself alone. */
@Module({
  contributes: {
    "HttpModule.routes": [
      {
        id: "messaging.accounts",
        prefix: "/api/messaging",
        auth: "user",
        order: 281,
      },
      {
        id: "messaging.account-holders",
        prefix: "/api/projects/:projectId/messaging",
        auth: "user",
        order: 282,
      },
    ],
  },
})
export class MessagingAccountsModule {
  @Use() private readonly messagingRepo!: MessagingBindings;
  @Use() private readonly sessionsRepo!: SessionIndex;
  @Use() private readonly machines!: Machines;
  @Use() private readonly access!: Access;
  @Bind("messaging.accounts") accountsRoutes!: Hono<AppEnv>;
  @Bind("messaging.account-holders") accountHoldersRoutes!: Hono<AppEnv>;
  setup() {
    const deps = {
      messagingRepo: this.messagingRepo,
      sessionsRepo: this.sessionsRepo,
      machines: this.machines,
      access: this.access,
    };
    this.accountsRoutes = messagingAccountsRoutes(deps);
    this.accountHoldersRoutes = messagingAccountHoldersRoutes(deps);
  }
}
