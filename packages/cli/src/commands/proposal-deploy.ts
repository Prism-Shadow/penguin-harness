/**
 * The deploy commands of `penguin org proposal` (the company-proposals plugin):
 *
 *   deploy-script add <id> [--description <text>] -- <command> [args...]
 *   deploy-script ls
 *   deploy-script rm <id>
 *   deploy <number> --to <id> [--dry-run] [-- <extra args...>]
 *
 * An organization registers its own deploy scripts — how its project is built and where it
 * ships is its business — and a deploy runs one of them on the proposal's impl PR head. The
 * script runs on the server that holds the organization, in its shared workspace, with the
 * head in its environment (PENGUIN_DEPLOY_HEAD and the rest, see the plugin's deploy.ts) and
 * the arguments after `--` appended to the registered command. Registering or removing one
 * is a server admin's: the server enforces it.
 *
 * `deploy` starts the run and follows its output until it ends, exiting 0 only when the
 * script did; Ctrl-C stops following, not the run. With `--json` it prints the start answer
 * (the run, or with `--dry-run` the plan) and does not follow.
 *
 * org.ts hands these commands its scope and transport as a {@link DeployKit}, so they can be
 * driven in a test without a server.
 */
import type { Command } from "commander";
import type {
  ProposalDeployPlan,
  ProposalDeployRun,
  ProposalDeployRunResponse,
  ProposalDeployScript,
  ProposalDeployScriptsResponse,
  ProposalDeployStartResponse,
} from "@prismshadow/penguin-server/api";
import type { Messages } from "../i18n.js";
import { renderTable } from "../table.js";

/** A request under the organization's `…/proposals` routes; null after an error it reported. */
export type ProposalRequester = <T>(
  method: string,
  suffix: string,
  body?: unknown,
) => Promise<T | null>;

export interface DeployKit {
  /** Appends the organization options every leaf command takes. */
  scoped(cmd: Command): Command;
  /** The organization the options name, connected; null after an error it reported. */
  open(opts: Record<string, unknown>): Promise<ProposalRequester | null>;
  /** The caller's identity for a body (the control environment's session and Agent). */
  actorFields(): Record<string, string>;
  /** The same identity as a `?…` query for the reads and the DELETE. */
  actorQuery(): string;
  fail(message: string): void;
  print(text: string): void;
  printJson(value: unknown): void;
  /** Raw output, as the script wrote it. */
  write(text: string): void;
  sleep(ms: number): Promise<void>;
}

/** How often a followed run is asked for more output. */
export const FOLLOW_INTERVAL_MS = 1000;

/** Follows a run until it ends, writing its output as it arrives; the run as it ended, or null after an error it reported. */
export async function followRun(
  request: ProposalRequester,
  runId: string,
  kit: Pick<DeployKit, "actorQuery" | "write" | "sleep">,
): Promise<ProposalDeployRun | null> {
  let from = 0;
  const actor = kit.actorQuery();
  const query = actor === "" ? "?" : `${actor}&`;
  for (;;) {
    const res = await request<ProposalDeployRunResponse>(
      "GET",
      `/deploys/${encodeURIComponent(runId)}${query}from=${from}`,
    );
    if (res === null) return null;
    if (res.output !== "") kit.write(res.output);
    from = res.next;
    if (res.run.status !== "running") return res.run;
    await kit.sleep(FOLLOW_INTERVAL_MS);
  }
}

const short = (head: string): string => head.slice(0, 12);

/** An argument vector as one line a person can read: an argument with a space or a quote is quoted. */
export function argvLine(argv: readonly string[]): string {
  return argv.map((a) => (a === "" || /[\s"'\\$`]/.test(a) ? JSON.stringify(a) : a)).join(" ");
}

function parseNumber(raw: string): number | null {
  const value = Number(raw.replace(/^#/, ""));
  return Number.isInteger(value) && value > 0 ? value : null;
}

export function registerProposalDeploy(proposal: Command, t: Messages, kit: DeployKit): void {
  const scripts = proposal.command("deploy-script").description(t.org.deployScriptDesc);

  kit
    .scoped(
      scripts
        .command("add <id> <command...>")
        .description(t.org.deployScriptAddDesc)
        .option("--description <text>", t.org.deployScriptDescription),
    )
    .action(async (id: string, command: string[], opts: Record<string, unknown>) => {
      const request = await kit.open(opts);
      if (request === null) return;
      const script = await request<ProposalDeployScript>("POST", "/deploy-scripts", {
        id,
        command,
        ...(typeof opts.description === "string" ? { description: opts.description } : {}),
        ...kit.actorFields(),
      });
      if (script === null) return;
      if (opts.json === true) kit.printJson(script);
      else kit.print(t.org.deployScriptAdded(script.id, argvLine(script.command)));
    });

  kit
    .scoped(scripts.command("ls").description(t.org.deployScriptLsDesc))
    .action(async (opts: Record<string, unknown>) => {
      const request = await kit.open(opts);
      if (request === null) return;
      const res = await request<ProposalDeployScriptsResponse>(
        "GET",
        `/deploy-scripts${kit.actorQuery()}`,
      );
      if (res === null) return;
      if (opts.json === true) kit.printJson(res);
      else if (res.scripts.length === 0) kit.print(t.org.deployScriptNone);
      else
        kit.write(
          renderTable(
            t.org.deployScriptHeader,
            res.scripts.map((s) => [s.id, argvLine(s.command), s.description, s.by]),
          ),
        );
    });

  kit
    .scoped(scripts.command("rm <id>").description(t.org.deployScriptRmDesc))
    .action(async (id: string, opts: Record<string, unknown>) => {
      const request = await kit.open(opts);
      if (request === null) return;
      const done = await request<unknown>(
        "DELETE",
        `/deploy-scripts/${encodeURIComponent(id)}${kit.actorQuery()}`,
      );
      if (done === null) return;
      if (opts.json === true) kit.printJson({ removed: id });
      else kit.print(t.org.deployScriptRemoved(id));
    });

  kit
    .scoped(
      proposal
        .command("deploy <number> [args...]")
        .description(t.org.proposalDeployDesc)
        .requiredOption("--to <id>", t.org.proposalDeployTo)
        .option("--dry-run", t.org.proposalDeployDryRun),
    )
    .action(async (raw: string, args: string[], opts: Record<string, unknown>) => {
      const number = parseNumber(raw);
      if (number === null) {
        kit.fail(t.org.proposalNumberInvalid(raw));
        return;
      }
      const request = await kit.open(opts);
      if (request === null) return;
      const res = await request<ProposalDeployStartResponse>("POST", "/deploys", {
        script: String(opts.to),
        proposal: number,
        args,
        ...(opts.dryRun === true ? { dryRun: true } : {}),
        ...kit.actorFields(),
      });
      if (res === null) return;
      if (opts.json === true) {
        kit.printJson(res);
        return;
      }
      if ("plan" in res) {
        kit.print(planLine(t, res.plan));
        return;
      }
      kit.print(
        t.org.proposalDeployStarted(
          res.run.id,
          res.run.script,
          `${res.run.repo}#${res.run.pr}`,
          short(res.run.head),
        ),
      );
      const run = await followRun(request, res.run.id, kit);
      if (run === null) return;
      if (run.status === "succeeded")
        kit.print(t.org.proposalDeploySucceeded(run.id, short(run.head)));
      else kit.fail(t.org.proposalDeployFailed(run.id, run.status, run.exitCode, run.error));
    });
}

function planLine(t: Messages, plan: ProposalDeployPlan): string {
  return t.org.proposalDeployPlanned(
    plan.script,
    `${plan.repo}#${plan.pr}`,
    short(plan.head),
    argvLine(plan.argv),
  );
}
