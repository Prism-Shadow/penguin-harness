/**
 * The bot-account routes as a node of their own, beside the messaging bridge rather than in it:
 * they read the stored bindings and ask the Project's machines, and never touch a connection.
 * A machine-free server serves them the same way, answering for itself alone.
 */
import { Bind, Module, Use } from "@prismshadow/penguin-core/kernel";
import type { Hono } from "hono";
import type { AppEnv } from "../../auth/middleware.js";
import {
  messagingAccountHoldersRoutes,
  messagingAccountsRoutes,
} from "../../http/routes/messaging-accounts.js";
import type { Machines } from "../../machines/service.js";
import type { MessagingBindings } from "../../mechanisms/messaging.js";
import type { Access } from "../../mechanisms/projects.js";
import type { SessionIndex } from "../../mechanisms/sessions.js";

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
