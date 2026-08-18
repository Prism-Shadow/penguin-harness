/**
 * `penguin server reset-admin-password` — offline rescue when the Web admin password is
 * lost.
 *
 * The admin resets every other user from the user-management page, but nothing can
 * reset the admin itself once its password is forgotten. This subcommand of `penguin
 * server` closes that gap from the machine owning the data root (PENGUIN_HOME or the
 * default root, PENGUIN_WEB_DB honored for the database path): it refuses while a live
 * server owns the root (web.db is single-writer), otherwise the built-in admin gets a
 * fresh initial password, printed here in the same framed notice the server prints on
 * startup — and re-printed on every later start until the password is changed.
 * Docs: /docs/cli § "penguin server / penguin web".
 */
import path from "node:path";
import { resolveRoot } from "@prismshadow/penguin-core";
import { renderInitialPasswordNotice } from "@prismshadow/penguin-server/initial-password";
import { resetAdminPassword } from "@prismshadow/penguin-server/reset-admin-password";
import type { Command } from "commander";
import type { Messages } from "../i18n.js";

/** Attaches the subcommand to the `penguin server` command (see registerServeCommands). */
export function registerResetPasswordCommand(server: Command, t: Messages): void {
  server
    .command("reset-admin-password")
    .description(t.resetPassword.desc)
    .action(async () => {
      const root = process.env.PENGUIN_HOME ?? resolveRoot();
      const dbPath = process.env.PENGUIN_WEB_DB ?? path.join(root, "web.db");
      const result = await resetAdminPassword(root, dbPath);
      switch (result.outcome) {
        case "server_running":
          process.stderr.write(
            t.resetPassword.serverRunning(`http://localhost:${result.lock.port}/`) + "\n",
          );
          process.exitCode = 1;
          return;
        case "no_database":
          process.stderr.write(t.resetPassword.noDatabase(result.dbPath) + "\n");
          process.exitCode = 1;
          return;
        case "no_admin":
          process.stderr.write(t.resetPassword.noAdmin() + "\n");
          process.exitCode = 1;
          return;
        case "reset":
          process.stdout.write(t.resetPassword.done(root) + "\n");
          process.stdout.write(renderInitialPasswordNotice("admin", result.password) + "\n");
          process.stdout.write(t.resetPassword.next() + "\n");
      }
    });
}
