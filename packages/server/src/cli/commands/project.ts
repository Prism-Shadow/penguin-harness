/**
 * `penguin project ls` — the projects this token/user can reach (own and shared).
 *
 *   penguin project ls [--json] [--server <url>]
 * Docs: /docs/cli § "penguin project".
 */
import type { Command } from "commander";
import { Bind, Component } from "@prismshadow/penguin-core/kernel";
import type { CliCommandCode, CliCommandProgram } from "@prismshadow/penguin-core/cli";

/** The node the host located for a key, typed with this package's commander. */
const node = (command: CliCommandProgram): Command => command as Command;

import type { ProjectsResponse } from "../../api/types.js";
import { ServerClient } from "../client.js";
import { resolveConnection } from "../connection.js";
import { renderTable } from "../table.js";
import type { Messages } from "../i18n.js";

export function registerProjectCommand(project: Command, t: Messages): void {
  project
    .command("ls")
    .description(t.project.lsDesc)
    .option("--json", t.common.json)
    .option("--server <url>", t.common.server)
    .action(async (opts) => {
      const client = new ServerClient(await resolveConnection({ server: opts.server }, t), t);
      const res = await client.request<ProjectsResponse>("GET", "/api/projects");
      if (opts.json === true) {
        process.stdout.write(`${JSON.stringify(res.projects)}\n`);
        return;
      }
      process.stdout.write(
        renderTable(
          [t.project.colId(), t.project.colName(), t.project.colRole()],
          res.projects.map((p) => [p.projectId, p.name ?? "", p.role]),
        ),
      );
    });
}

/**
 * `penguin project`, as a contribution to the CLI's `CliCommandsModule.commands` from this
 * package (the server resource API's client); the CLI's boot collects it.
 */
@Component({
  contributes: {
    "CliCommandsModule.commands": [
      {
        id: "cli.project",
        key: "project",
        summary: {
          en: "Manage projects",
          zh: "管理 Project",
        },
      },
    ],
  },
})
export class ProjectCommand {
  @Bind("cli.project") command!: CliCommandCode<Messages>;
  setup() {
    this.command = {
      register: (command, ctx) => {
        registerProjectCommand(node(command), ctx.messages);
      },
    };
  }
}
