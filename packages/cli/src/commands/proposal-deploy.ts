/**
 * The deploy command of `penguin org proposal` (the company-proposals plugin):
 *
 *   deploy <number> --to <id> [--head <sha>] [--dry-run] [-- <extra args...>]
 *   deploy --pr <n> --to <id> [--head <sha>] [--dry-run] [-- <extra args...>]
 *
 * A deploy is an Action, `deploy.<id>`, that a company workflow of the organization
 * contributes: it runs on the server that holds the organization, on the subject's commit — the
 * proposal's impl head, or the PR's — with the commit in its environment and the arguments after
 * `--` appended. `--head` is the commit the caller looked at: the server refuses the run when
 * the subject has moved past it.
 *
 * `deploy` starts the run and follows its output until it ends, exiting 0 only when it
 * succeeded and otherwise with its process's exit code; Ctrl-C stops following, not the run.
 * With `--json` it prints the start answer and does not follow. `--dry-run` runs nothing: it
 * says whether the organization has the Action and whether the caller may run it now.
 *
 * org.ts hands these commands its scope and transport as a {@link DeployKit}, so they can be
 * driven in a test without a server.
 */
import type { Command } from "commander";
import type { ActionRunView, ActionsResponse } from "@prismshadow/penguin-server/api";
import type { Messages } from "../i18n.js";
import { exitCodeOf, followRun, startRun, type ActionRequester } from "./action-client.js";

export { FOLLOW_INTERVAL_MS, followRun } from "./action-client.js";

/** A request under the organization's `…/proposals` routes; null after an error it reported. */
export type ProposalRequester = <T>(
  method: string,
  suffix: string,
  body?: unknown,
) => Promise<T | null>;

export interface DeployKit {
  /** Appends the organization options every leaf command takes. */
  scoped(cmd: Command): Command;
  /** The organization the options name, connected, for its `…/proposals` routes; null after an error it reported. */
  open(opts: Record<string, unknown>): Promise<ProposalRequester | null>;
  /** The same, for its `…/actions` routes (every write). */
  openActions(opts: Record<string, unknown>): Promise<ActionRequester | null>;
  /** The same, for its `…/workflows` routes (the company workflows' reads). */
  openWorkflows(opts: Record<string, unknown>): Promise<ProposalRequester | null>;
  /** The caller's identity for a body (the control environment's session and Agent). */
  actorFields(): Record<string, string>;
  /** The same identity as a `?…` query for the reads. */
  actorQuery(): string;
  fail(message: string): void;
  /** Ends the command with this exit code (a run that did not succeed). */
  exit(code: number): void;
  print(text: string): void;
  printJson(value: unknown): void;
  /** Raw output, as the process wrote it. */
  write(text: string): void;
  sleep(ms: number): Promise<void>;
}

const short = (head: string | null): string => (head ?? "").slice(0, 12);

function parseNumber(raw: string): number | null {
  const value = Number(raw.replace(/^#/, ""));
  return Number.isInteger(value) && value > 0 ? value : null;
}

/** Follows a run that started a process, and reports how it ended. */
export async function followToEnd(
  request: ActionRequester,
  run: ActionRunView,
  kit: DeployKit,
  report: (ended: ActionRunView) => void,
): Promise<void> {
  const ended = run.outcome === null ? await followRun(request, run.id, kit) : run;
  if (ended === null) return;
  report(ended);
  const code = exitCodeOf(ended);
  if (code !== 0) kit.exit(code);
}

export function registerProposalDeploy(proposal: Command, t: Messages, kit: DeployKit): void {
  kit
    .scoped(
      proposal
        .command("deploy [number] [args...]")
        .description(t.org.proposalDeployDesc)
        .requiredOption("--to <id>", t.org.proposalDeployTo)
        .option("--pr <n>", t.org.proposalDeployPr)
        .option("--head <sha>", t.org.proposalDeployHead)
        .option("--dry-run", t.org.proposalDeployDryRun),
    )
    .action(async (raw: string | undefined, args: string[], opts: Record<string, unknown>) => {
      if ((raw === undefined) === (opts.pr === undefined)) {
        kit.fail(t.org.proposalDeployUsage);
        return;
      }
      const rawNumber = raw ?? String(opts.pr);
      const number = parseNumber(rawNumber);
      if (number === null) {
        kit.fail(t.org.proposalNumberInvalid(rawNumber));
        return;
      }
      const subject = raw !== undefined ? `proposal:${number}` : `pr:${number}`;
      const key = `deploy.${String(opts.to)}`;
      const request = await kit.openActions(opts);
      if (request === null) return;
      if (opts.dryRun === true) {
        const actor = kit.actorQuery();
        const listed = await request<ActionsResponse>(
          "GET",
          `${actor === "" ? "?" : `${actor}&`}subject=${encodeURIComponent(subject)}`,
        );
        if (listed === null) return;
        const action = listed.actions.find((a) => a.key === key);
        if (opts.json === true) {
          kit.printJson({ key, subject, action: action ?? null });
          return;
        }
        kit.print(
          t.org.proposalDeployPlanned(
            key,
            subject,
            action === undefined ? null : action.allowed !== false,
            action?.refusal?.message ?? "",
          ),
        );
        return;
      }
      const res = await startRun(
        request,
        { key },
        subject,
        {
          ...(typeof opts.head === "string" ? { expectedHead: opts.head } : {}),
          ...(args.length > 0 ? { args } : {}),
        },
        kit.actorFields(),
      );
      if (res === null) return;
      if (opts.json === true) {
        kit.printJson(res);
        return;
      }
      kit.print(t.org.proposalDeployStarted(res.run.id, key, subject, short(res.run.commit)));
      await followToEnd(request, res.run, kit, (run) => {
        if (run.outcome === "succeeded") {
          kit.print(t.org.proposalDeploySucceeded(run.id, short(run.commit)));
          return;
        }
        const exitCode = (run.result as { exitCode?: unknown } | null)?.exitCode;
        kit.fail(
          t.org.proposalDeployFailed(
            run.id,
            run.outcome ?? "running",
            typeof exitCode === "number" ? exitCode : null,
            run.message,
          ),
        );
      });
    });
}
