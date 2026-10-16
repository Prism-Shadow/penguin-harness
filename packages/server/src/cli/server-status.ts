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
import type { CliContext } from "@prismshadow/penguin-core/plugin";
import { serveMessages } from "./messages.js";
import { serverCliSummary } from "./module.js";

/**
 * Attaches the subcommand to the `penguin server` command (see serve.ts's
 * registerCliCommands). The data root is the CLI's documented priority — `--root` >
 * PENGUIN_HOME > the default — resolved through the context the host hands down.
 */
export function registerStatusCommand(server: Command, ctx: CliContext): void {
  const m = serveMessages(ctx.language);
  server
    .command("status")
    .description(serverCliSummary("server.status", ctx.language))
    .option("--root <dir>", m.root)
    .action(async (opts: { root?: string }) => {
      const root = opts.root !== undefined ? path.resolve(opts.root) : ctx.root;
      // PENGUIN_WEB_DB honored as everywhere else, or this reads an identity out of a
      // database the live server never writes to.
      const dbPath = process.env.PENGUIN_WEB_DB ?? path.join(root, "web.db");
      process.stdout.write(JSON.stringify(await readMachineStatus(root, dbPath)) + "\n");
    });
}
