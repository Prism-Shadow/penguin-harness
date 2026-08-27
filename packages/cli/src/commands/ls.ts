/**
 * `penguin ls` — list the project's sessions.
 *
 *   penguin ls [--project-id <id>] [--agent-id <id>] [-a|--all] [--days <n>] [--json] [--server <url>]
 *
 * All agents of the project unless `--agent-id` narrows it (the API lists per agent, so
 * the command iterates GET /agents then per-agent sessions). Columns: short id (the
 * 8-hex tail `penguin input` / `penguin logs` accept as a fragment), agent, title,
 * running/idle, last active, workspace tail. Archived sessions appear only with `-a`.
 * `--days <n>` keeps sessions whose lastActiveAt falls within the last n calendar days
 * (today is day 1, so `--days 2` covers yesterday and today — the `cost --days`
 * calendar semantics); it combines with `-a` and `--json`.
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
    .option("--days <n>", t.ls.days)
    .option("--json", t.common.json)
    .option("--server <url>", t.common.server)
    .action(async (opts) => {
      let sinceMs: number | undefined;
      if (opts.days !== undefined) {
        const days = Number(opts.days);
        if (!Number.isInteger(days) || days <= 0) {
          process.stderr.write(`${t.error(t.ls.daysInvalid(String(opts.days)))}\n`);
          process.exitCode = 1;
          return;
        }
        // Calendar semantics (same as cost --days): today counts as day 1, so the window
        // starts at local midnight (days - 1) days ago.
        const now = new Date();
        sinceMs = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1)).getTime();
      }
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
        .filter((s) => sinceMs === undefined || Date.parse(s.lastActiveAt) >= sinceMs)
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
