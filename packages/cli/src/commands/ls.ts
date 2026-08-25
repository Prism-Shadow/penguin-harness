/**
 * `penguin ls` — list the project's sessions.
 *
 *   penguin ls [--project-id <id>] [--agent-id <id>] [-a|--all] [--json] [--server <url>]
 *
 * All agents of the project unless `--agent-id` narrows it (the API lists per agent, so
 * the command iterates GET /agents then per-agent sessions). Columns: short id (the
 * 8-hex tail `penguin input` / `penguin logs` accept as a fragment), agent, title,
 * running/idle, last active, workspace tail. Archived sessions appear only with `-a`.
 * Docs: /docs/cli § "penguin ls".
 */
import type { Command } from "commander";
import type { SessionInfo } from "@prismshadow/penguin-server/api";
import {
  resolveAgentId,
  resolveConnection,
  resolveProjectId,
  ServerClient,
  shortSessionId,
} from "../client.js";
import { listAgents, listAgentSessions } from "../server-session.js";
import { relativeTime, renderTable } from "../table.js";
import type { Messages } from "../i18n.js";

export function registerLsCommand(program: Command, t: Messages): void {
  program
    .command("ls")
    .description(t.ls.desc)
    .option("--project-id <id>", t.common.projectId)
    .option("--agent-id <id>", t.common.agentId)
    .option("-a, --all", t.ls.all)
    .option("--json", t.common.json)
    .option("--server <url>", t.common.server)
    .action(async (opts) => {
      const client = new ServerClient(await resolveConnection({ server: opts.server }, t), t);
      const projectId = resolveProjectId(opts.projectId);
      const agentIds =
        opts.agentId !== undefined
          ? [resolveAgentId(opts.agentId)]
          : (await listAgents(client, projectId)).map((a) => a.agentId);

      const all: SessionInfo[] = [];
      for (const agentId of agentIds) {
        all.push(...(await listAgentSessions(client, projectId, agentId)));
      }
      const rows = all
        .filter((s) => opts.all === true || !s.archived)
        .sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt));

      if (opts.json === true) {
        process.stdout.write(`${JSON.stringify(rows)}\n`);
        return;
      }
      if (rows.length === 0) {
        process.stdout.write(`${t.ls.empty(projectId)}\n`);
        return;
      }
      const stateText = (s: SessionInfo): string =>
        s.status === "idle" ? t.ls.stateIdle() : t.ls.stateRunning();
      process.stdout.write(
        renderTable(
          [
            t.ls.colId(),
            t.ls.colAgent(),
            t.ls.colTitle(),
            t.ls.colState(),
            t.ls.colLast(),
            t.ls.colWorkspace(),
          ],
          rows.map((s) => [
            shortSessionId(s.sessionId),
            s.agentId,
            (s.title ?? "").slice(0, 40),
            stateText(s),
            relativeTime(s.lastActiveAt),
            workspaceTail(s.workspace),
          ]),
        ),
      );
    });
}

/** Last path segment of the workspace (enough to tell rows apart at a glance). */
function workspaceTail(workspace: string): string {
  const parts = workspace.replace(/[\\/]+$/, "").split(/[\\/]/);
  return parts[parts.length - 1] || workspace;
}
