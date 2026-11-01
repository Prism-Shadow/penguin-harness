/**
 * `penguin server status` — this data root's server state and machine id, as one line of
 * JSON.
 *
 * Machine-facing on purpose: a CONTROLLER runs it over ssh to ask a machine what it is doing,
 * and JSON is what spares that controller a parser for a format nobody defined. It answers
 * whether or not a server is running (the data root is the source, not a live process), which
 * is what makes it usable as a status probe rather than only a health check.
 * Docs: /docs/cli § "penguin server / penguin web".
 */
import path from "node:path";
import { readMachineStatus } from "../machine-status.js";
import type { Command } from "commander";
import { Module } from "@prismshadow/penguin-core/kernel";
import {
  commandOnChain,
  type CliCommandProgram,
  type CliCommandRegister,
} from "@prismshadow/penguin-core/plugin";
import { serveMessages } from "./messages.js";

/** The command's data half — the one place the summary lives. A pure collector: the code
 * half is `register["server-cli.status"]` in serve.ts, which attaches the subcommand to
 * the `penguin server` chain (the parent's entry declares that key's subtree open). The
 * data root is the CLI's documented priority — `--root` > PENGUIN_HOME > the default —
 * resolved through the context the host hands down. */
@Module({
  contributes: {
    "cli.commands": [
      {
        id: "server-cli.status",
        key: "server.status",
        summary: {
          en: "Print this data root's server state and machine id as one line of JSON",
          zh: "以单行 JSON 打印本数据根目录的服务状态与本机 id",
        },
      },
    ],
  },
})
export class ServerStatusCommand {}

/** The command's code half: attaches the subcommand to the `penguin server` chain (the
 * parent's entry declares that key's subtree open), its description read off the entry
 * the host hands in. The data root is the CLI's documented priority — `--root` >
 * PENGUIN_HOME > the default — resolved through the context the host hands down. */
export const registerStatus: CliCommandRegister = async (program, ctx, entry) => {
  const m = serveMessages(ctx.language);
  (commandOnChain(program, entry.key) as Command)
    .description(entry.summary[ctx.language])
    .option("--root <dir>", m.root)
    .action(async (opts: { root?: string }) => {
      const root = opts.root !== undefined ? path.resolve(opts.root) : ctx.root;
      // PENGUIN_WEB_DB honored as everywhere else, or this reads an identity out of a
      // database the live server never writes to.
      const dbPath = process.env.PENGUIN_WEB_DB ?? path.join(root, "web.db");
      process.stdout.write(JSON.stringify(await readMachineStatus(root, dbPath)) + "\n");
    });
};
