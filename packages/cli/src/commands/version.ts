/**
 * `penguin version` — what is running here.
 *
 * Two audiences, one producer. Bare, it prints the single line core computed as the build's
 * identity, which for a source build is git's own description (`v0.2.3-14-g9e8f7d6-dirty`)
 * and for a release is the plain `v0.2.3`. With `--json` it prints core's whole BuildInfo,
 * which is byte-for-byte the body GET /api/version serves — a bug report can be filed from
 * either side of the HTTP boundary and say the same thing.
 *
 * The subcommand exists alongside `-v, --version` rather than replacing it: both render
 * `describe`, so they agree, but a subcommand can take `--json` where the global flag cannot
 * (see update.ts on how commander's program-level `--version` swallows a subcommand's own).
 */
import type { Command } from "commander";
import { buildInfo } from "@prismshadow/penguin-core";
import type { Messages } from "../i18n.js";

export function registerVersionCommand(program: Command, t: Messages): void {
  program
    .command("version")
    .description(t.version.description)
    .option("--json", t.version.json)
    .action((options: { json?: boolean }) => {
      const info = buildInfo();
      const out = options.json === true ? JSON.stringify(info, null, 2) : info.describe;
      process.stdout.write(`${out}\n`);
    });
}
