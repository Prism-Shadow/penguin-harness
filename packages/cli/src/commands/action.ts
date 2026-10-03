/**
 * `penguin org action`: the organization's Actions (company-proposals' Action registry) —
 * every write to its proposals and roadmaps, built in or contributed by the organization's
 * company workflows (`penguin org workflow`), and the runs each one left (the Activity).
 *
 *   action ls [--subject <subject>] [--all]
 *   action run <key> <subject> [--param name=value ...] [--params <json>] [--request-id <id>]
 *   action exec <contribution> <subject> [same options]
 *   action runs [--subject S] [--by P] [--key K] [--before <cursor>] [--limit N]
 *   action check
 *
 * Each command is one route; nothing is decided here. A run that starts a process (a deploy)
 * is followed until it ends, the way `proposal deploy` follows one.
 */
import type { Command } from "commander";
import type {
  ActionCheckResponse,
  ActionContributionsResponse,
  ActionRunsResponse,
  ActionsResponse,
} from "@prismshadow/penguin-server/api";
import type { Messages } from "../i18n.js";
import { renderTable } from "../table.js";
import { parseParams, startRun, type ActionTarget } from "./action-client.js";
import { followToEnd, type DeployKit } from "./proposal-deploy.js";

/** `?a=b&…` from the caller's identity query and more entries; "" for none. */
function withQuery(actorQuery: string, entries: Array<[string, string | undefined]>): string {
  const extra = entries
    .filter((e): e is [string, string] => e[1] !== undefined && e[1] !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`);
  if (extra.length === 0) return actorQuery;
  return actorQuery === "" ? `?${extra.join("&")}` : `${actorQuery}&${extra.join("&")}`;
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

export function registerOrgAction(org: Command, t: Messages, kit: DeployKit): void {
  const action = org.command("action").description(t.org.actionDesc);

  kit
    .scoped(
      action
        .command("ls")
        .description(t.org.actionLsDesc)
        .option("--subject <subject>", t.org.actionLsSubject)
        .option("--all", t.org.actionLsAll),
    )
    .action(async (opts: Record<string, unknown>) => {
      const request = await kit.openActions(opts);
      if (request === null) return;
      if (opts.all === true) {
        const res = await request<ActionContributionsResponse>(
          "GET",
          `/contributions${kit.actorQuery()}`,
        );
        if (res === null) return;
        if (opts.json === true) kit.printJson(res);
        else
          kit.write(
            renderTable(
              t.org.contributionsHeader,
              res.contributions.map((c) => [
                c.id,
                c.kind === "hook" && c.when !== null ? `hook:${c.when}` : c.kind,
                c.key ?? c.subjects.join(","),
                c.workflow ?? "-",
                c.replaced ? "yes" : "",
                c.from,
              ]),
            ),
          );
        return;
      }
      const res = await request<ActionsResponse>(
        "GET",
        withQuery(kit.actorQuery(), [["subject", str(opts.subject)]]),
      );
      if (res === null) return;
      if (opts.json === true) {
        kit.printJson(res);
        return;
      }
      if (res.actions.length === 0) {
        kit.print(t.org.actionsNone);
        return;
      }
      kit.write(
        renderTable(
          t.org.actionsHeader,
          res.actions.map((a) => [
            a.key,
            a.contribution,
            a.subjects.join(","),
            a.allowed === undefined ? "" : a.allowed ? "yes" : `no (${a.refusal?.code ?? ""})`,
          ]),
        ),
      );
    });

  const runCommand = (name: string, toTarget: (first: string) => ActionTarget, desc: string) =>
    kit
      .scoped(
        action
          .command(`${name} <${name === "run" ? "key" : "contribution"}> <subject>`)
          .description(desc)
          .option("--param <name=value>", t.org.actionParam, (v: string, prev: string[] = []) => [
            ...prev,
            v,
          ])
          .option("--params <json>", t.org.actionParams)
          .option("--request-id <id>", t.org.actionRequestId),
      )
      .action(async (first: string, subject: string, opts: Record<string, unknown>) => {
        const parsed = parseParams((opts.param as string[] | undefined) ?? [], str(opts.params));
        if ("error" in parsed) {
          kit.fail(t.org.actionParamInvalid(parsed.error));
          return;
        }
        const request = await kit.openActions(opts);
        if (request === null) return;
        const requestId = str(opts.requestId);
        const res = await startRun(
          request,
          toTarget(first),
          subject,
          parsed.params,
          kit.actorFields(),
          requestId !== undefined ? { requestId } : {},
        );
        if (res === null) return;
        if (opts.json === true || res.run.outcome !== null) {
          kit.printJson(opts.json === true ? res : res.result);
          return;
        }
        kit.print(t.org.actionRunStarted(res.run.id, res.run.key, res.run.subject));
        await followToEnd(request, res.run, kit, (run) => {
          const line = t.org.actionRunEnded(run.id, run.outcome ?? "", run.message);
          if (run.outcome === "succeeded") kit.print(line);
          else kit.fail(line);
        });
      });

  runCommand("run", (key) => ({ key }), t.org.actionRunDesc);
  runCommand("exec", (contribution) => ({ contribution }), t.org.actionExecDesc);

  kit
    .scoped(
      action
        .command("runs")
        .description(t.org.actionRunsDesc)
        .option("--subject <subject>", t.org.actionRunsSubject)
        .option("--by <principal>", t.org.actionRunsBy)
        .option("--key <key>", t.org.actionRunsKey)
        .option("--before <cursor>", t.org.actionRunsBefore)
        .option("--limit <n>", t.org.actionRunsLimit),
    )
    .action(async (opts: Record<string, unknown>) => {
      const limit = str(opts.limit);
      if (limit !== undefined) {
        const n = Number(limit);
        if (!Number.isInteger(n) || n < 1 || n > 200) {
          kit.fail(t.org.actionLimitInvalid(limit));
          return;
        }
      }
      const request = await kit.openActions(opts);
      if (request === null) return;
      const res = await request<ActionRunsResponse>(
        "GET",
        `/runs${withQuery(kit.actorQuery(), [
          ["subject", str(opts.subject)],
          ["by", str(opts.by)],
          ["key", str(opts.key)],
          ["before", str(opts.before)],
          ["limit", limit],
        ])}`,
      );
      if (res === null) return;
      if (opts.json === true) {
        kit.printJson(res);
        return;
      }
      if (res.runs.length === 0) {
        kit.print(t.org.actionRunsNone);
        return;
      }
      kit.write(
        renderTable(
          t.org.actionRunsHeader,
          res.runs.map((r) => [
            r.startedAt,
            r.key,
            r.subject,
            r.by,
            r.via,
            r.outcome === null
              ? "running"
              : r.code !== null && r.outcome !== "succeeded"
                ? `${r.outcome} (${r.code})`
                : r.outcome,
          ]),
        ),
      );
      if (res.next !== null) kit.print(t.org.actionRunsNext(res.next));
    });

  kit
    .scoped(action.command("check").description(t.org.actionCheckDesc))
    .action(async (opts: Record<string, unknown>) => {
      const request = await kit.openActions(opts);
      if (request === null) return;
      const res = await request<ActionCheckResponse>("GET", `/check${kit.actorQuery()}`);
      if (res === null) return;
      if (opts.json === true) {
        kit.printJson(res);
        return;
      }
      if (res.conflicts.length === 0) kit.print(t.org.actionCheckNone);
      for (const c of res.conflicts) {
        kit.print(t.org.actionConflict(c.key, c.kind, c.contributions.join(", ")));
      }
    });
}
