/**
 * `penguin agent` — list and create agents through the server.
 *
 *   penguin agent ls [--project-id <id>] [--json] [--server <url>]
 *   penguin agent create --agent-id <id> [--name <s>] [--description <s>]
 *                        [--plugins <a,b>] [--project-id <id>] [--json] [--server <url>]
 *
 * `create` mirrors the Web dialog's fields: id (required), display name, description,
 * and library plugins to seed (comma-separated names; unknown names are rejected by the
 * server before anything is created).
 * Docs: /docs/cli § "penguin agent".
 */
import type { Command } from "commander";
import type { AgentCreateResponse, AgentSummary } from "@prismshadow/penguin-server/api";
import { resolveConnection, resolveProjectId, ServerClient } from "../client.js";
import { listAgents } from "../server-session.js";
import { renderTable } from "../table.js";
import type { Messages } from "../i18n.js";

export function registerAgentCommand(program: Command, t: Messages): void {
  const agent = program.command("agent").description(t.agent.desc);

  agent
    .command("ls")
    .description(t.agent.lsDesc)
    .option("--project-id <id>", t.common.projectId)
    .option("--json", t.common.json)
    .option("--server <url>", t.common.server)
    .action(async (opts) => {
      const client = new ServerClient(await resolveConnection({ server: opts.server }, t), t);
      const projectId = resolveProjectId(opts.projectId);
      const agents = await listAgents(client, projectId);
      if (opts.json === true) {
        process.stdout.write(`${JSON.stringify(agents)}\n`);
        return;
      }
      process.stdout.write(
        renderTable(
          [t.agent.colId(), t.agent.colName(), t.agent.colSessions(), t.agent.colDescription()],
          agents.map((a: AgentSummary) => [
            a.agentId,
            a.name ?? "",
            String(a.sessionCount),
            (a.description ?? "").slice(0, 60),
          ]),
        ),
      );
    });

  agent
    .command("create")
    .description(t.agent.createDesc)
    .requiredOption("--agent-id <id>", t.agent.createId)
    .option("--name <name>", t.agent.createName)
    .option("--description <text>", t.agent.createDescription)
    .option("--plugins <names>", t.agent.createPlugins)
    .option("--project-id <id>", t.common.projectId)
    .option("--json", t.common.json)
    .option("--server <url>", t.common.server)
    .action(async (opts) => {
      const client = new ServerClient(await resolveConnection({ server: opts.server }, t), t);
      const projectId = resolveProjectId(opts.projectId);
      const plugins =
        typeof opts.plugins === "string"
          ? opts.plugins
              .split(",")
              .map((s: string) => s.trim())
              .filter((s: string) => s.length > 0)
          : undefined;
      const res = await client.request<AgentCreateResponse>(
        "POST",
        `/api/projects/${encodeURIComponent(projectId)}/agents`,
        {
          agentId: String(opts.agentId),
          ...(opts.name !== undefined ? { name: String(opts.name) } : {}),
          ...(opts.description !== undefined ? { description: String(opts.description) } : {}),
          ...(plugins !== undefined && plugins.length > 0 ? { plugins } : {}),
        },
      );
      if (opts.json === true) {
        process.stdout.write(`${JSON.stringify(res.agent)}\n`);
        return;
      }
      process.stdout.write(`${t.agent.created(res.agent.agentId, projectId)}\n`);
    });
}
