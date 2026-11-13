/**
 * Bot-account routes: which server has a messaging bot enabled, so that one account is enabled on
 * one server at a time (runtime/messaging/account-holders.ts).
 *
 * GET /api/messaging/accounts
 *   Every bot account this server has enabled, across all its Projects:
 *   `{accounts: [{channel, accountId}]}`. Admin only (403 `admin_required`), because it spans
 *   Projects; it is what a server that connects this one as a machine asks, and that request runs
 *   here as this server's admin. No Session ids, no secrets.
 *
 * GET /api/projects/:projectId/messaging/account-holders?channel=<channel>&accountId=<id>
 *   Which servers have that account enabled: this server (`machineId: null`), and each machine
 *   the Project uses that answers that it does; machines that could not be asked are listed in
 *   `unreachable` with the reason. Any Project member may ask (404 `project_not_found`
 *   otherwise); the machines are asked for an admin only, since machines are admins' (the
 *   machines page and the proxy are), so anyone else hears about this server alone. 400 on a
 *   missing or unknown channel or an empty account id. Never names a Session, for the reason the
 *   state route's refusal names none: the holder may sit in a Project the caller cannot see.
 */
import { Hono } from "hono";
import type {
  MessagingAccountHoldersResponse,
  MessagingAccountsResponse,
} from "../../api/types.js";
import type { AppEnv } from "../../auth/middleware.js";
import type { Machines } from "../../machines/service.js";
import type { MessagingBindings } from "../../mechanisms/messaging.js";
import type { Access } from "../../mechanisms/projects.js";
import type { SessionIndex } from "../../mechanisms/sessions.js";
import {
  enabledAccounts,
  findAccountHolders,
  holdsAccount,
} from "../../runtime/messaging/account-holders.js";
import { isMessagingChannel } from "../../runtime/messaging/enabled-channel.js";
import { HttpError } from "../errors.js";
import { badRequest, requireValidId } from "../validate.js";

/** What these route groups reach — bound by their module (runtime/messaging/accounts-module.ts). */
export interface MessagingAccountsRouteDeps {
  messagingRepo: Pick<MessagingBindings, "listAll">;
  sessionsRepo: Pick<SessionIndex, "findById">;
  machines: Pick<Machines, "projectApis">;
  access: Pick<Access, "requireProjectAccess">;
}

/** `/api/messaging`: this server's own enabled accounts. */
export function messagingAccountsRoutes(
  deps: Pick<MessagingAccountsRouteDeps, "messagingRepo" | "sessionsRepo">,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/accounts", (c) => {
    if (!c.var.user.isAdmin) {
      throw new HttpError(403, "admin_required", "Only an admin can list this server's bots.");
    }
    return c.json({
      accounts: enabledAccounts(deps.messagingRepo, deps.sessionsRepo),
    } satisfies MessagingAccountsResponse);
  });

  return app;
}

/** `/api/projects/:projectId/messaging`: who holds one account, here and on the Project's machines. */
export function messagingAccountHoldersRoutes(deps: MessagingAccountsRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/account-holders", async (c) => {
    const projectId = requireValidId(c, "projectId");
    deps.access.requireProjectAccess(c.var.user.userId, projectId);
    const channel = c.req.query("channel") ?? "";
    if (!isMessagingChannel(channel)) {
      throw badRequest("channel must be one of feishu, telegram, qq, wechat.");
    }
    const accountId = c.req.query("accountId") ?? "";
    if (accountId.trim() === "") throw badRequest("accountId is required.");
    const heldHere = holdsAccount(
      enabledAccounts(deps.messagingRepo, deps.sessionsRepo),
      channel,
      accountId,
    );
    const machines = c.var.user.isAdmin ? await deps.machines.projectApis(projectId) : [];
    return c.json(
      (await findAccountHolders({
        heldHere,
        machines,
        channel,
        accountId,
      })) satisfies MessagingAccountHoldersResponse,
    );
  });

  return app;
}
