/**
 * `penguin project ls` — the projects this token/user can reach (own and shared).
 *
 *   penguin project ls [--json] [--server <url>]
 * Docs: /docs/cli § "penguin project".
 */
import type { Command } from "commander";
import type { ProjectsResponse } from "@prismshadow/penguin-server/api";
import { resolveConnection, ServerClient } from "../client.js";
import { renderTable } from "../table.js";
import type { Messages } from "../i18n.js";

export function registerProjectCommand(program: Command, t: Messages): void {
  const project = program.command("project").description(t.project.desc);

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
