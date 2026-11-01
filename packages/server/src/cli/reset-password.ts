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
import { Module } from "@prismshadow/penguin-core/kernel";
import {
  commandOnChain,
  type CliCommandProgram,
  type CliCommandRegister,
} from "@prismshadow/penguin-core/plugin";
import { serveMessages } from "./messages.js";

/** The command's data half — the one place the summary lives. A pure collector: the code
 * half is `register["server-cli.reset-admin-password"]` in serve.ts. */
@Module({
  contributes: {
    "cli.commands": [
      {
        id: "server-cli.reset-admin-password",
        key: "server.reset-admin-password",
        summary: {
          en: "Reset the Web admin account so the next server start prints a new first-login link (the server must be stopped)",
          zh: "重置 Web 管理员账号，下次启动服务时会打印新的首次登录链接（须先停止服务）",
        },
      },
    ],
  },
})
export class ServerResetAdminPasswordCommand {}

/** The command's code half: attaches the subcommand to the `penguin server` chain (the
 * parent's entry declares that key's subtree open), its description read off the entry
 * the host hands in. */
export const registerResetAdminPassword: CliCommandRegister = async (program, ctx, entry) => {
  const m = serveMessages(ctx.language);
  (commandOnChain(program, entry.key) as Command)
    .description(entry.summary[ctx.language])
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
};
