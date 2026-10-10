/**
 * `penguin org roadmap item`: the company-roadmaps plugin's one-item writes — `roadmap.item.add`
 * and `roadmap.item.remove`, the Actions that change one item of a discussing roadmap's draft and
 * leave every other item, the record and the body as they were.
 *
 *   item add <number> --key <key> --kind <kind> --title <title> --brief <brief>
 *                     [--owner <agent id>] [--employees <id,…>] [--cites <heading,…>]
 *                     [--stacked-on <key>] [--proposal <number>]
 *   item remove <number> <key>
 *
 * Each command is one Action run, on the same route `penguin org action run` posts to — the
 * item's fields as the flags a command takes, instead of one `--params` object written by hand.
 * Nothing is decided here: the Action checks the item the way it checks an element of
 * `roadmap.draft`'s items, under the guard in force in the organization, and the answer prints
 * the way `action run` prints it — the whole run with `--json`, otherwise its result, the
 * roadmap after the write.
 */
import type { Command } from "commander";
import type { Messages } from "../i18n.js";
import { startRun } from "./action-client.js";
import type { DeployKit } from "./proposal-deploy.js";

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/** A `<number>` positional (`3`, or `#3` the way the proposal commands take one): a positive integer. */
function parseRoadmapNumber(raw: string): number | null {
  const value = Number(raw.replace(/^#/, ""));
  if (!Number.isInteger(value) || value <= 0) return null;
  return value;
}

/** A comma-separated flag value as a trimmed list; undefined when absent or empty. */
function commaList(raw: unknown): string[] | undefined {
  if (typeof raw !== "string") return undefined;
  const items = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return items.length > 0 ? items : undefined;
}

export function registerOrgRoadmap(org: Command, t: Messages, kit: DeployKit): void {
  const roadmap = org.command("roadmap").description(t.org.roadmapDesc);
  const item = roadmap.command("item").description(t.org.roadmapItemDesc);

  kit
    .scoped(
      item
        .command("add <number>")
        .description(t.org.roadmapItemAddDesc)
        .requiredOption("--key <key>", t.org.roadmapItemKey)
        .requiredOption("--kind <kind>", t.org.roadmapItemKind)
        .requiredOption("--title <title>", t.org.roadmapItemTitle)
        .requiredOption("--brief <brief>", t.org.roadmapItemBrief)
        .option("--owner <agent id>", t.org.roadmapItemOwner)
        .option("--employees <ids>", t.org.roadmapItemEmployees)
        .option("--cites <headings>", t.org.roadmapItemCites)
        .option("--stacked-on <key>", t.org.roadmapItemStackedOn)
        .option("--proposal <number>", t.org.roadmapItemProposal),
    )
    .action(async (raw: string, opts: Record<string, unknown>) => {
      const number = parseRoadmapNumber(raw);
      if (number === null) {
        kit.fail(t.org.roadmapNumberInvalid(raw));
        return;
      }
      // The item, the shape of one element of roadmap.draft's items; the Action checks it.
      const params: Record<string, unknown> = {
        key: String(opts.key),
        kind: String(opts.kind),
        title: String(opts.title),
        brief: String(opts.brief),
      };
      const owner = str(opts.owner);
      if (owner !== undefined) params.owner = owner;
      const employees = commaList(opts.employees);
      if (employees !== undefined) params.employees = employees;
      const cites = commaList(opts.cites);
      if (cites !== undefined) params.cites = cites;
      const stackedOn = str(opts.stackedOn);
      if (stackedOn !== undefined) params.stackedOn = stackedOn === "null" ? null : stackedOn;
      const proposal = str(opts.proposal);
      if (proposal !== undefined) {
        const n = Number(proposal);
        if (!Number.isInteger(n) || n < 1) {
          kit.fail(t.org.roadmapItemProposalInvalid(proposal));
          return;
        }
        params.proposal = n;
      }
      const request = await kit.openActions(opts);
      if (request === null) return;
      const res = await startRun(
        request,
        { key: "roadmap.item.add" },
        `roadmap:${number}`,
        params,
        kit.actorFields(),
      );
      if (res === null) return;
      // These Actions end with their run; the answer carries the roadmap after the write.
      kit.printJson(opts.json === true ? res : res.result);
    });

  kit
    .scoped(item.command("remove <number> <key>").description(t.org.roadmapItemRemoveDesc))
    .action(async (raw: string, key: string, opts: Record<string, unknown>) => {
      const number = parseRoadmapNumber(raw);
      if (number === null) {
        kit.fail(t.org.roadmapNumberInvalid(raw));
        return;
      }
      const request = await kit.openActions(opts);
      if (request === null) return;
      const res = await startRun(
        request,
        { key: "roadmap.item.remove" },
        `roadmap:${number}`,
        { key },
        kit.actorFields(),
      );
      if (res === null) return;
      kit.printJson(opts.json === true ? res : res.result);
    });
}
