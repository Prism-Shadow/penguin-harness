/**
 * `penguin server reset-admin-password` — offline rescue when the Web admin password is
 * lost.
 *
 * The admin resets every other user from the user-management page, but nothing can
 * reset the admin itself once its password is forgotten. This subcommand of `penguin
 * server` closes that gap from the machine owning the data root (PENGUIN_HOME or the
 * default root, PENGUIN_WEB_DB honored for the database path): it refuses while a live
 * server owns the root (web.db is single-writer), otherwise the built-in admin returns to
 * the unclaimed state with its sessions revoked, and the next server start prints a fresh
 * first-login link to claim it through (reset-admin-password.ts).
 * Docs: /docs/cli § "penguin server / penguin web".
 */
import path from "node:path";
import { resetAdminPassword } from "../reset-admin-password.js";
import type { Command } from "commander";
import type { CliContext } from "@prismshadow/penguin-core/plugin";
import { serveMessages } from "./messages.js";
import { serverCliSummary } from "./module.js";

/** Attaches the subcommand to the `penguin server` command (see serve.ts's registerCliCommands). */
export function registerResetPasswordCommand(server: Command, ctx: CliContext): void {
  const m = serveMessages(ctx.language);
  server
    .command("reset-admin-password")
    .description(serverCliSummary("server.reset-admin-password", ctx.language))
    .action(async () => {
      const root = ctx.root;
      const dbPath = process.env.PENGUIN_WEB_DB ?? path.join(root, "web.db");
      const result = await resetAdminPassword(root, dbPath);
      switch (result.outcome) {
        case "server_running":
          process.stderr.write(
            m.resetPassword.serverRunning(`http://localhost:${result.lock.port}/`) + "\n",
          );
          process.exitCode = 1;
          return;
        case "no_database":
          process.stderr.write(m.resetPassword.noDatabase(result.dbPath) + "\n");
          process.exitCode = 1;
          return;
        case "no_admin":
          process.stderr.write(m.resetPassword.noAdmin() + "\n");
          process.exitCode = 1;
          return;
        case "reset":
          process.stdout.write(m.resetPassword.done(root) + "\n");
          process.stdout.write(m.resetPassword.next() + "\n");
      }
    });
}
