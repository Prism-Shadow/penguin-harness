/**
 * The impl commands of `penguin org proposal` (the company-proposals plugin):
 *
 *   impl <number> [url] [--head <remote> <branch> --base <remote> <branch>]
 *   impl --adopt
 *   diff <number> [--stat]
 *
 * A proposal's impl is a branch pair — a head and the base it is measured against, each a git
 * remote of the proposal's repository (or `owner/repo`) and a branch — with the PR opened for
 * the head hanging on it once there is one. `impl` registers the pair, the PR, or both (the
 * `proposal.impl` Action; `--adopt` is `proposal.impl.adopt`); `diff`
 * prints the pair's patch, the merge base of base and head up to head, as the server read it
 * from GitHub.
 *
 * org.ts hands these commands the same {@link DeployKit} the deploy commands take.
 */
import type { Command } from "commander";
import type {
  ProposalAdoptImplResponse,
  ProposalBranchRef,
  ProposalDetail,
  ProposalImplDiff,
  ProposalResolvedBranch,
} from "@prismshadow/penguin-server/api";
import type { Messages } from "../i18n.js";
import type { DeployKit } from "./proposal-deploy.js";
import { runAction } from "./action-client.js";

function parseNumber(raw: string): number | null {
  const value = Number(raw.replace(/^#/, ""));
  return Number.isInteger(value) && value > 0 ? value : null;
}

/** `--head`/`--base` as given: exactly a remote and a branch; null for anything else. */
export function branchPair(raw: unknown): ProposalBranchRef | null {
  if (!Array.isArray(raw) || raw.length !== 2) return null;
  const [remote, branch] = raw as unknown[];
  return typeof remote === "string" && typeof branch === "string" && remote !== "" && branch !== ""
    ? { remote, branch }
    : null;
}

const refLabel = (ref: ProposalBranchRef): string => `${ref.remote}/${ref.branch}`;
const resolvedLabel = (ref: ProposalResolvedBranch): string =>
  ref.remote === null ? `${ref.repo}:${ref.branch}` : `${ref.remote}/${ref.branch}`;

/** The impl as `show` prints it: the branch pair with its PR, else the PR alone; null when there is none. */
export function implLine(d: ProposalDetail, t: Messages): string | null {
  // A server older than impl branches sends no `impl`; one older than impl PRs, no `implPr`.
  if (d.impl?.head != null && d.impl.base !== null) {
    return t.org.proposalImplBranch(refLabel(d.impl.head), refLabel(d.impl.base), d.impl.pr);
  }
  if (d.implPr != null) return t.org.proposalImplPr(d.implPr.label, d.implPr.url);
  return null;
}

/** The patch as `git diff` prints one: a header per file, then its hunks. */
export function renderPatch(diff: ProposalImplDiff): string {
  const out: string[] = [];
  for (const f of diff.files) {
    const from = f.from ?? f.path;
    out.push(`diff --git a/${from} b/${f.path}`);
    if (f.patch === null) {
      out.push(`Binary or large file not shown (+${f.additions} −${f.deletions})`);
      continue;
    }
    out.push(f.status === "added" ? "--- /dev/null" : `--- a/${from}`);
    out.push(f.status === "removed" ? "+++ /dev/null" : `+++ b/${f.path}`);
    out.push(f.patch);
  }
  return out.length === 0 ? "" : `${out.join("\n")}\n`;
}

/** One line per file, `+added −deleted  path`, then the total. */
export function renderStat(diff: ProposalImplDiff, t: Messages): string {
  const width = Math.max(0, ...diff.files.map((f) => `+${f.additions} −${f.deletions}`.length));
  const lines = diff.files.map((f) => {
    const counts = `+${f.additions} −${f.deletions}`.padEnd(width);
    return `  ${counts}  ${f.from !== null ? `${f.from} → ${f.path}` : f.path}`;
  });
  const additions = diff.files.reduce((n, f) => n + f.additions, 0);
  const deletions = diff.files.reduce((n, f) => n + f.deletions, 0);
  return `${[...lines, t.org.proposalDiffStat(diff.files.length, additions, deletions)].join("\n")}\n`;
}

export function registerProposalImpl(proposal: Command, t: Messages, kit: DeployKit): void {
  kit
    .scoped(
      proposal
        .command("impl [number] [url]")
        .description(t.org.proposalImplDesc)
        .option("--head <remote_branch...>", t.org.proposalImplHeadOpt)
        .option("--base <remote_branch...>", t.org.proposalImplBaseOpt)
        .option("--adopt", t.org.proposalImplAdopt),
    )
    .action(
      async (
        rawNumber: string | undefined,
        rawUrl: string | undefined,
        opts: Record<string, unknown>,
      ) => {
        if (opts.adopt === true) {
          const request = await kit.openActions(opts);
          if (request === null) return;
          const res = await runAction<ProposalAdoptImplResponse>(
            request,
            "proposal.impl.adopt",
            "organization",
            {},
            kit.actorFields(),
          );
          if (res === null) return;
          if (opts.json === true) kit.printJson(res);
          else {
            for (const a of res.adopted) kit.print(t.org.proposalImplSet(a.number, a.url));
            for (const a of res.ambiguous)
              kit.print(t.org.proposalImplAmbiguous(a.number, a.urls.join(", ")));
            for (const s of res.skipped) kit.print(t.org.proposalImplSkipped(s.number, s.reason));
          }
          return;
        }
        const named = opts.head !== undefined || opts.base !== undefined;
        if (rawNumber === undefined || (rawUrl === undefined && !named)) {
          kit.fail(t.org.proposalImplUsage());
          return;
        }
        const head = opts.head === undefined ? undefined : branchPair(opts.head);
        const base = opts.base === undefined ? undefined : branchPair(opts.base);
        if (named && (head == null || base == null)) {
          kit.fail(t.org.proposalImplPairUsage());
          return;
        }
        const number = parseNumber(rawNumber);
        if (number === null) {
          kit.fail(t.org.proposalNumberInvalid(rawNumber));
          return;
        }
        const request = await kit.openActions(opts);
        if (request === null) return;
        const detail = await runAction<ProposalDetail>(
          request,
          "proposal.impl",
          `proposal:${number}`,
          {
            ...(rawUrl !== undefined ? { url: rawUrl } : {}),
            ...(head != null && base != null ? { head, base } : {}),
          },
          kit.actorFields(),
        );
        if (detail === null) return;
        if (opts.json === true) kit.printJson(detail);
        else if (detail.impl?.head != null && detail.impl.base !== null)
          kit.print(
            t.org.proposalImplBranchSet(
              detail.number,
              refLabel(detail.impl.head),
              refLabel(detail.impl.base),
              detail.impl.pr,
            ),
          );
        else kit.print(t.org.proposalImplSet(detail.number, detail.implPr?.url ?? rawUrl ?? ""));
        if (opts.json !== true)
          for (const hint of detail.hints ?? []) kit.print(t.org.proposalHint(hint));
      },
    );

  kit
    .scoped(
      proposal
        .command("diff <number>")
        .description(t.org.proposalDiffDesc)
        .option("--stat", t.org.proposalDiffStatOpt),
    )
    .action(async (rawNumber: string, opts: Record<string, unknown>) => {
      const number = parseNumber(rawNumber);
      if (number === null) {
        kit.fail(t.org.proposalNumberInvalid(rawNumber));
        return;
      }
      const request = await kit.open(opts);
      if (request === null) return;
      const diff = await request<ProposalImplDiff>(
        "GET",
        `/${number}/impl/diff${kit.actorQuery()}`,
      );
      if (diff === null) return;
      if (opts.json === true) {
        kit.printJson(diff);
        return;
      }
      kit.print(
        t.org.proposalDiffHead(
          resolvedLabel(diff.head),
          resolvedLabel(diff.base),
          diff.ahead,
          diff.behind,
          diff.compareUrl,
        ),
      );
      kit.write(opts.stat === true ? renderStat(diff, t) : renderPatch(diff));
      if (diff.truncated) kit.print(t.org.proposalDiffTruncated(diff.files.length));
    });
}
