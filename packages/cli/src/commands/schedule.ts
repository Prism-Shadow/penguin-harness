/**
 * `penguin schedule ls` — the project's scheduled tasks.
 *
 *   penguin schedule ls [--project-id <id>] [--agent-id <id>] [--json] [--server <url>]
 *
 * Schedules live per agent (GET .../agents/:a/schedules); without `--agent-id` the
 * command iterates every agent of the project. Columns: agent, name, enabled, startAt,
 * period, target (bound sessionId or "new session"), lastFiredAt, and a status marker
 * for the non-active states (expired / done / missed / invalid — unparsable files are
 * listed too, marked invalid).
 * Docs: /docs/cli § "penguin schedule".
 */
import type { Command } from "commander";
import type { SchedulesResponse } from "@prismshadow/penguin-server/api";
import {
  resolveAgentId,
  resolveConnection,
  resolveProjectId,
  ServerClient,
  shortSessionId,
} from "../client.js";
import { listAgents } from "../server-session.js";
import { renderTable } from "../table.js";
import type { Messages } from "../i18n.js";

export function registerScheduleCommand(program: Command, t: Messages): void {
  const schedule = program.command("schedule").description(t.schedule.desc);

  schedule
    .command("ls")
    .description(t.schedule.lsDesc)
    .option("--project-id <id>", t.common.projectId)
    .option("--agent-id <id>", t.common.agentId)
    .option("--json", t.common.json)
    .option("--server <url>", t.common.server)
    .action(async (opts) => {
      const client = new ServerClient(await resolveConnection({ server: opts.server }, t), t);
      const projectId = resolveProjectId(opts.projectId);
      const agentIds =
        opts.agentId !== undefined
          ? [resolveAgentId(opts.agentId)]
          : (await listAgents(client, projectId)).map((a) => a.agentId);

      const perAgent = await Promise.all(
        agentIds.map(async (agentId) => ({
          agentId,
          res: await client.request<SchedulesResponse>(
            "GET",
            `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/schedules`,
          ),
        })),
      );

      if (opts.json === true) {
        process.stdout.write(
          `${JSON.stringify(
            perAgent.map(({ agentId, res }) => ({
              agentId,
              schedules: res.schedules,
              invalidFiles: res.invalidFiles,
            })),
          )}\n`,
        );
        return;
      }

      const rows: string[][] = [];
      for (const { agentId, res } of perAgent) {
        for (const s of res.schedules) {
          // `enabled` is the file's intent; the derived status carries the rest —
          // active is the quiet norm, everything else gets named.
          rows.push([
            agentId,
            s.name,
            s.enabled ? t.schedule.enabled() : t.schedule.disabled(),
            s.startAt,
            s.period ?? t.schedule.oneShot(),
            s.sessionId !== undefined ? shortSessionId(s.sessionId) : t.schedule.newSession(),
            s.lastFiredAt ?? "-",
            s.status === "active" ? "" : s.status,
          ]);
        }
        for (const f of res.invalidFiles) {
          rows.push([agentId, f.name, "-", "-", "-", "-", "-", "invalid"]);
        }
      }
      if (rows.length === 0) {
        process.stdout.write(`${t.schedule.empty(projectId)}\n`);
        return;
      }
      process.stdout.write(
        renderTable(
          [
            t.agent.colId(),
            t.schedule.colName(),
            t.schedule.colEnabled(),
            t.schedule.colStartAt(),
            t.schedule.colPeriod(),
            t.schedule.colTarget(),
            t.schedule.colLastFired(),
            t.schedule.colStatus(),
          ],
          rows,
        ),
      );
    });
}
