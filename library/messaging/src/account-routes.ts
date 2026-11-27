/**
 * Bot-account routes: which server has a messaging bot enabled, so that one account is enabled on
 * one server at a time (account-holders.ts), as pure factories over the ports they reach
 * (services+http+cli restack S8).
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
import type { MessagingAccountHoldersResponse, MessagingAccountsResponse } from "./vocabulary.js";
import type { AppEnv } from "@prismshadow/penguin-library-http";
import type { MessagingBindings } from "./messaging.js";
import type { Access } from "@prismshadow/penguin-library-project";
import type { SessionIndex } from "@prismshadow/penguin-library-session";
import { enabledAccounts, findAccountHolders, holdsAccount } from "./account-holders.js";
import { MESSAGING_CHANNELS, isMessagingChannel } from "./enabled-channel.js";
import type { MessagingMachineApi } from "./ports.js";
import { HttpError } from "@prismshadow/penguin-library-http";
import { badRequest, requireValidId } from "@prismshadow/penguin-library-http/validate";

/** What these route groups reach — bound by their module (server runtime/messaging). */
export interface MessagingAccountsRouteDeps {
  messagingRepo: Pick<MessagingBindings, "listAll">;
  sessionsRepo: Pick<SessionIndex, "findById">;
  /** The Project's machines with a connected API client, as Machines.projectApis returns it. */
  machines: {
    projectApis(
      projectId: string,
    ): Promise<Array<{ machineId: string; alias: string; api: MessagingMachineApi | null }>>;
  };
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
      throw badRequest(`channel must be one of ${MESSAGING_CHANNELS.join(", ")}.`);
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
