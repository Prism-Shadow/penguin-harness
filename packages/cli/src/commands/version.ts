/**
 * `penguin version` — what is running here.
 *
 * Two audiences, one producer. Bare, it prints the single line core computed as the build's
 * identity, which for a source build is git's own description (`v0.2.3-14-g9e8f7d6-dirty`)
 * and for a release is the plain `v0.2.3`. With `--json` it asks the server for the whole
 * VersionReport (`GET /api/version`) — a bug report can be filed from either side of the HTTP
 * boundary and say the same thing.
 */
import type { Command } from "commander";
import { buildInfo } from "@prismshadow/penguin-core";
import type { VersionReport } from "@prismshadow/penguin-core";
import { resolveConnection, ServerClient, type Messages } from "@prismshadow/penguin-server/cli";
import { Bind, Component } from "@prismshadow/penguin-core/kernel";
import type { CliCommandCode, CliCommandProgram } from "@prismshadow/penguin-core/cli";

/** The node the host located for a key, typed with this package's commander. */
const node = (command: CliCommandProgram): Command => command as Command;
export function registerVersionCommand(version: Command, t: Messages): void {
  version
    .option("--json", t.version.json)
    .option("--server <url>", t.common.server)
    .option("--root <dir>", t.common.root)
    .action(async (options: { json?: boolean; server?: string; root?: string }) => {
      if (options.json !== true) {
        // The one-line form is a property of the artifact alone, so it never reads a root.
        process.stdout.write(`${buildInfo().describe}\n`);
        return;
      }
      const client = new ServerClient(
        await resolveConnection({ server: options.server, root: options.root }, t),
        t,
      );
      const report = await client.request<VersionReport>("GET", "/api/version");
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    });
}

/** `penguin version`. */
@Component({
  contributes: {
    "CliCommandsModule.commands": [
      {
        id: "cli.version",
        key: "version",
        summary: {
          en: "Show which build is running",
          zh: "显示当前运行的是哪个构建",
        },
      },
    ],
  },
})
export class VersionCommand {
  @Bind("cli.version") command!: CliCommandCode<Messages>;
  setup() {
    this.command = {
      register: (command, ctx) => {
        registerVersionCommand(node(command), ctx.messages);
      },
    };
  }
}
