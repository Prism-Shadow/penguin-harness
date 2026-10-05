/**
 * The proposal page's Implementation section: the impl branch — the head the proposal is
 * implemented on and the base it is measured against — the PR opened for the head, if any, and
 * the patch's `+N/−M`, shown as soon as the page opens.
 *
 * The totals come with the proposal's detail (`implStat`): the server computes them in the
 * background, cached by the head and base commits, and says so with a plugin event the page
 * already re-reads on. Until then the line says it is counting; when they cannot be counted it
 * says why. A click on `+N/−M` opens the diff itself in a large dialog
 * (proposal-diff-dialog.tsx); closing it returns to the page where it was.
 *
 * An impl registered as a PR alone has no declared pair; its head and base appear once the totals
 * (which read them off the PR) are known. A declared side the server resolved to a GitHub
 * repository is a link to its branch page; one it could not resolve stays text, with the reason
 * on hover.
 */
import { useState } from "react";
import type {
  ProposalBranchRef,
  ProposalDetail,
  ProposalImplBranch,
  ProposalImplBranchSide,
  ProposalImplStat,
  ProposalResolvedBranch,
} from "@prismshadow/penguin-server/api";
import { Button, ICON_GAP, RuledSection } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import { OrgEmptyLine } from "../company/org-layout";
import { ProposalDiffDialog } from "./proposal-diff-dialog";

const refLabel = (ref: ProposalBranchRef): string => `${ref.remote}/${ref.branch}`;
const resolvedLabel = (ref: ProposalResolvedBranch): string =>
  ref.remote === null ? `${ref.repo}:${ref.branch}` : `${ref.remote}/${ref.branch}`;
const shortPr = (url: string): string => url.replace(/^https?:\/\/github\.com\//, "");

/** The head and base as GitHub names them, once the totals read them. */
type Resolved = { head: ProposalResolvedBranch; base: ProposalResolvedBranch };

export function ImplSection({ detail }: { detail: ProposalDetail }) {
  const t = S.company.proposals.impl;
  // A server older than impl branches sends no `impl`: fall back to the impl PR alone.
  const impl =
    detail.impl ??
    (detail.implPr == null
      ? null
      : {
          head: null,
          base: null,
          pr: detail.implPr.url,
          by: detail.implPr.by,
          at: detail.implPr.at,
        });
  const [diffOpen, setDiffOpen] = useState(false);

  if (impl === null) {
    return (
      <RuledSection title={t.title} info={t.info}>
        <OrgEmptyLine>{t.empty}</OrgEmptyLine>
      </RuledSection>
    );
  }

  const stat = detail.implStat;
  const resolved = stat?.state === "ready" ? stat : null;
  const pair =
    impl.head !== null && impl.base !== null
      ? `${refLabel(impl.head)} ← ${refLabel(impl.base)}`
      : resolved !== null
        ? `${resolvedLabel(resolved.head)} ← ${resolvedLabel(resolved.base)}`
        : "";
  return (
    <RuledSection title={t.title} info={t.info}>
      <div className="space-y-2 text-xs">
        <ImplBranchLine impl={impl} resolved={resolved} />
        <ImplStatLine stat={stat} onOpen={() => setDiffOpen(true)} />
      </div>
      <ProposalDiffDialog
        open={diffOpen}
        number={detail.number}
        subtitle={pair}
        onClose={() => setDiffOpen(false)}
      />
    </RuledSection>
  );
}

/**
 * The totals line: `+N −M · K files` as the button that opens the diff, with the comparison on
 * GitHub beside it; "counting" while the server has no answer yet; the reason when it has none to
 * give (the diff can still be opened: it says what went wrong, and retries). A server older than
 * the totals sends none: the diff opens from a plain button.
 */
export function ImplStatLine({
  stat,
  onOpen,
}: {
  stat: ProposalImplStat | undefined;
  onOpen: () => void;
}) {
  const t = S.company.proposals.impl;
  const open = (
    <Button size="sm" variant="secondary" aria-haspopup="dialog" onClick={onOpen}>
      {S.company.proposals.implDiff.open}
    </Button>
  );
  if (stat === undefined) {
    return <div className={`flex flex-wrap items-center ${ICON_GAP.menu}`}>{open}</div>;
  }
  if (stat.state === "computing") {
    return (
      <div className={`flex flex-wrap items-center ${ICON_GAP.menu}`}>
        <span role="status" aria-busy="true" className="text-gray-500 dark:text-gray-400">
          {t.statComputing}
        </span>
        {open}
      </div>
    );
  }
  if (stat.state === "unavailable") {
    return (
      <div className={`flex flex-wrap items-center ${ICON_GAP.menu}`}>
        <span className={toneInk.attention}>{t.statUnavailable(stat.reason)}</span>
        {open}
      </div>
    );
  }
  return (
    <div className={`flex flex-wrap items-center ${ICON_GAP.menu}`}>
      <button
        type="button"
        aria-haspopup="dialog"
        data-tooltip={t.statOpen}
        onClick={onOpen}
        className={`inline-flex items-center rounded border border-gray-200 px-2 py-0.5 font-mono tabular-nums transition-[background-color] hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800 ${ICON_GAP.tight}`}
      >
        <span className={toneInk.success}>+{stat.additions}</span>
        <span className={toneInk.danger}>−{stat.deletions}</span>
        <span className="font-sans text-gray-500 dark:text-gray-400">
          · {t.statFiles(stat.files)}
        </span>
      </button>
      <a
        href={stat.compareUrl}
        target="_blank"
        rel="noreferrer"
        className="text-gray-500 hover:underline dark:text-gray-400"
      >
        {t.compare}
      </a>
    </div>
  );
}

/** The branch pair (each side a link to its GitHub branch page when the server named one) and the PR. */
export function ImplBranchLine({
  impl,
  resolved,
}: {
  impl: ProposalImplBranch;
  resolved: Resolved | null;
}) {
  const t = S.company.proposals.impl;
  const mono = "font-mono text-gray-800 dark:text-gray-100";
  const branches =
    impl.head !== null && impl.base !== null ? (
      <span className={mono}>
        <BranchSide side={impl.head} /> ← <BranchSide side={impl.base} />
      </span>
    ) : resolved !== null ? (
      <span
        className={mono}
      >{`${resolvedLabel(resolved.head)} ← ${resolvedLabel(resolved.base)}`}</span>
    ) : null;
  return (
    <div className={`flex flex-wrap items-center ${ICON_GAP.row}`}>
      {branches ?? <span className="text-gray-500 dark:text-gray-400">{t.branchOfPr}</span>}
      <span className="text-gray-500 dark:text-gray-400">·</span>
      <span className="text-gray-500 dark:text-gray-400">{t.pr}</span>
      {impl.pr === null ? (
        <span className={toneInk.attention}>{t.noPr}</span>
      ) : (
        <a
          href={impl.pr}
          target="_blank"
          rel="noreferrer"
          data-tooltip={impl.pr}
          className="font-medium hover:underline"
        >
          {shortPr(impl.pr)}
        </a>
      )}
    </div>
  );
}

/** One declared side: a link to its branch page, or text explaining why there is none. */
function BranchSide({ side }: { side: ProposalImplBranchSide }) {
  const label = refLabel(side);
  if (side.url != null) {
    return (
      <a
        href={side.url}
        target="_blank"
        rel="noreferrer"
        data-tooltip={S.company.proposals.impl.openBranch}
        className="hover:underline"
      >
        {label}
      </a>
    );
  }
  // A server older than branch links sends neither field: plain text, nothing to explain.
  const reason = side.unresolved ?? null;
  return reason === null ? (
    <span>{label}</span>
  ) : (
    <span data-tooltip={S.company.proposals.impl.noBranchLink(reason)}>{label}</span>
  );
}
