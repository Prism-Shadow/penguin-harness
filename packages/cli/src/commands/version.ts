/**
 * `penguin version` — what is running here.
 *
 * Two audiences, one producer. Bare, it prints the single line core computed as the build's
 * identity, which for a source build is git's own description (`v0.2.3-14-g9e8f7d6-dirty`)
 * and for a release is the plain `v0.2.3`. With `--json` it prints the whole VersionReport,
 * the same record GET /api/version serves — a bug report can be filed from either side of
 * the HTTP boundary and say the same thing.
 *
 * The JSON carries a second half the line cannot: the harness this data root has in its HMR
 * store — what a hot update put there, which a restart resumes. It is a property of the root
 * rather than of this process, so it answers "what was pushed to this machine" where the line
 * answers "what am I". The two differ whenever `penguin` runs the packaged CLI on a machine
 * that has a pushed one in its store.
 *
 * The subcommand exists alongside `-v, --version` rather than replacing it: both render
 * `describe`, so they agree, but a subcommand can take options where the global flag cannot
 * (see update.ts on how commander's program-level `--version` swallows a subcommand's own).
 */
import path from "node:path";
import type { Command } from "commander";
import { buildInfo, resolveRoot } from "@prismshadow/penguin-core";
import { versionReport } from "@prismshadow/penguin-server/version-report";
import type { Messages } from "../i18n.js";

export function registerVersionCommand(program: Command, t: Messages): void {
  program
    .command("version")
    .description(t.version.description)
    .option("--json", t.version.json)
    .option("--root <dir>", t.common.root)
    .action(async (options: { json?: boolean; root?: string }) => {
      if (options.json !== true) {
        // The one-line form is a property of the artifact alone, so it never reads a root.
        process.stdout.write(`${buildInfo().describe}\n`);
        return;
      }
      const root = options.root !== undefined ? path.resolve(options.root) : resolveRoot();
      process.stdout.write(`${JSON.stringify(await versionReport(root), null, 2)}\n`);
    });
}
