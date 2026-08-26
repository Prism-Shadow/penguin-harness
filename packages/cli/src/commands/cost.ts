/**
 * `penguin cost` — token/cost aggregates from GET /api/projects/:p/usage.
 *
 *   penguin cost [--days <n>] [--from <d> --to <d>] [--by date|agent|model|session]
 *                [--project-id <id>] [--agent-id <id>] [--json] [--server <url>]
 *
 * Default prints the summary card (today / last 7 days / total — the endpoint computes
 * them unconditionally). `--days n` sets from/to to the trailing n days; `--from/--to`
 * (a pair) pin an explicit range. `--by` maps to the endpoint's groupBy and prints the
 * grouped table instead of the card. `--agent-id` filters; there is no default agent
 * here — costs are a project view unless narrowed explicitly.
 * Docs: /docs/cli § "penguin cost".
 */
import type { Command } from "commander";
import type { UsageResponse } from "@prismshadow/penguin-server/api";
import { humanizeTokens } from "../render.js";
import { resolveConnection, resolveProjectId, ServerClient } from "../client.js";
import { renderTable } from "../table.js";
import type { Messages } from "../i18n.js";

const GROUP_BYS = ["date", "agent", "model", "session"] as const;
type GroupBy = (typeof GROUP_BYS)[number];

/** yyyy-mm-dd of a local date. */
function localDate(d: Date): string {
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatCost(cost: number | null, hasUncosted: boolean, t: Messages): string {
  if (cost === null) return t.cost.noPricing();
  const value = `$${cost.toFixed(4)}`;
  return hasUncosted ? `${value}+` : value;
}

export function registerCostCommand(program: Command, t: Messages): void {
  program
    .command("cost")
    .description(t.cost.desc)
    .option("--days <n>", t.cost.days)
    .option("--from <date>", t.cost.from)
    .option("--to <date>", t.cost.to)
    .option("--by <dimension>", t.cost.by)
    .option("--project-id <id>", t.common.projectId)
    .option("--agent-id <id>", t.common.agentId)
    .option("--json", t.common.json)
    .option("--server <url>", t.common.server)
    .action(async (opts) => {
      if ((opts.from === undefined) !== (opts.to === undefined)) {
        process.stderr.write(`${t.error(t.cost.rangeIncomplete())}\n`);
        process.exitCode = 1;
        return;
      }
      let from = opts.from as string | undefined;
      let to = opts.to as string | undefined;
      if (opts.days !== undefined) {
        const days = Number(opts.days);
        if (!Number.isInteger(days) || days <= 0) {
          process.stderr.write(`${t.error(t.cost.daysInvalid(String(opts.days)))}\n`);
          process.exitCode = 1;
          return;
        }
        const now = new Date();
        to = localDate(now);
        from = localDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1)));
      }
      let groupBy: GroupBy | undefined;
      if (opts.by !== undefined) {
        if (!(GROUP_BYS as readonly string[]).includes(String(opts.by))) {
          process.stderr.write(`${t.error(t.cost.byInvalid(String(opts.by)))}\n`);
          process.exitCode = 1;
          return;
        }
        groupBy = opts.by as GroupBy;
      }

      const client = new ServerClient(await resolveConnection({ server: opts.server }, t), t);
      const projectId = resolveProjectId(opts.projectId);
      const params = new URLSearchParams();
      if (groupBy !== undefined) params.set("groupBy", groupBy);
      if (from !== undefined) params.set("from", from);
      if (to !== undefined) params.set("to", to);
      if (opts.agentId !== undefined) params.set("agentId", String(opts.agentId));
      const qs = params.size > 0 ? `?${params.toString()}` : "";
      const usage = await client.request<UsageResponse>(
        "GET",
        `/api/projects/${encodeURIComponent(projectId)}/usage${qs}`,
      );

      if (opts.json === true) {
        process.stdout.write(`${JSON.stringify(usage)}\n`);
        return;
      }
      const out = process.stdout;
      if (groupBy === undefined) {
        // The summary card: today / last7d / total (the endpoint computes all three
        // regardless of from/to).
        const line = (label: string, b: UsageResponse["summary"]["today"]): string[] => [
          label,
          humanizeTokens(b.total),
          String(b.requests),
          formatCost(b.cost, b.hasUncosted, t),
        ];
        out.write(
          renderTable(
            ["", t.cost.colTokens(), t.cost.colRequests(), t.cost.colCost()],
            [
              line(t.cost.today(), usage.summary.today),
              line(t.cost.last7d(), usage.summary.last7d),
              line(t.cost.total(), usage.summary.total),
            ],
          ),
        );
        return;
      }
      if (usage.groups.length === 0) {
        out.write(`${t.cost.empty()}\n`);
        return;
      }
      out.write(
        renderTable(
          [t.cost.colGroup(groupBy), t.cost.colTokens(), t.cost.colRequests(), t.cost.colCost()],
          usage.groups.map((g) => [
            g.provider !== undefined ? `${g.key} (${g.provider})` : g.key,
            humanizeTokens(g.total),
            String(g.requests),
            formatCost(g.cost, g.hasUncosted, t),
          ]),
        ),
      );
    });
}
