/**
 * The proposal page's Implementation section: the impl branch — the head the proposal is
 * implemented on and the base it is measured against — the PR opened for the head, if any, and,
 * on request, the patch's files with their added and deleted lines and a link to the comparison
 * on GitHub.
 *
 * The patch is read only when asked for: the server reads it from GitHub on every request, so a
 * page view must not cost a comparison. An impl registered as a PR alone has no declared pair;
 * its head and base appear once the comparison (which reads them off the PR) has loaded.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ProposalBranchRef,
  ProposalDetail,
  ProposalImplDiff,
  ProposalResolvedBranch,
} from "@prismshadow/penguin-server/api";
import { Button, ICON_GAP, RuledSection, Skeleton } from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import { OrgEmptyLine, useOrg } from "../company/org-layout";

const refLabel = (ref: ProposalBranchRef): string => `${ref.remote}/${ref.branch}`;
const resolvedLabel = (ref: ProposalResolvedBranch): string =>
  ref.remote === null ? `${ref.repo}:${ref.branch}` : `${ref.remote}/${ref.branch}`;
const shortPr = (url: string): string => url.replace(/^https?:\/\/github\.com\//, "");

type DiffState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; diff: ProposalImplDiff };

export function ImplSection({ detail }: { detail: ProposalDetail }) {
  const t = S.company.proposals.impl;
  const { projectId, orgId } = useOrg();
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
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<DiffState>({ kind: "idle" });
  // A newer request, or a changed impl, makes an answer in flight stale.
  const ticket = useRef(0);
  const implKey =
    impl === null
      ? ""
      : `${impl.head === null ? "" : refLabel(impl.head)}|${impl.base === null ? "" : refLabel(impl.base)}|${impl.pr ?? ""}`;

  useEffect(() => {
    ticket.current += 1;
    setOpen(false);
    setState({ kind: "idle" });
  }, [detail.number, implKey]);

  const load = useCallback(async () => {
    const mine = ++ticket.current;
    setState({ kind: "loading" });
    try {
      const diff = await api.getOrgProposalImplDiff(projectId, orgId, detail.number);
      if (ticket.current === mine) setState({ kind: "ready", diff });
    } catch (err) {
      if (ticket.current === mine) setState({ kind: "error", message: apiErrorText(err) });
    }
  }, [projectId, orgId, detail.number]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && (state.kind === "idle" || state.kind === "error")) void load();
  };

  if (impl === null) {
    return (
      <RuledSection title={t.title} info={t.info}>
        <OrgEmptyLine>{t.empty}</OrgEmptyLine>
      </RuledSection>
    );
  }

  const diff = state.kind === "ready" ? state.diff : null;
  const branches =
    impl.head !== null && impl.base !== null
      ? `${refLabel(impl.head)} ← ${refLabel(impl.base)}`
      : diff !== null
        ? `${resolvedLabel(diff.head)} ← ${resolvedLabel(diff.base)}`
        : null;

  return (
    <RuledSection title={t.title} info={t.info}>
      <div className="space-y-2 text-xs">
        <div className={`flex flex-wrap items-center ${ICON_GAP.row}`}>
          {branches !== null ? (
            <span className="font-mono text-gray-800 dark:text-gray-100">{branches}</span>
          ) : (
            <span className="text-gray-500 dark:text-gray-400">{t.branchOfPr}</span>
          )}
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
        <div className={`flex flex-wrap items-center ${ICON_GAP.menu}`}>
          <Button size="sm" variant="secondary" aria-expanded={open} onClick={toggle}>
            {open ? t.hideFiles : t.showFiles}
          </Button>
          {diff !== null && (
            <a
              href={diff.compareUrl}
              target="_blank"
              rel="noreferrer"
              className="text-gray-500 hover:underline dark:text-gray-400"
            >
              {t.compare}
            </a>
          )}
        </div>
        {open && <DiffFiles state={state} onRetry={() => void load()} />}
      </div>
    </RuledSection>
  );
}

function DiffFiles({ state, onRetry }: { state: DiffState; onRetry: () => void }) {
  const t = S.company.proposals.impl;
  if (state.kind === "idle" || state.kind === "loading") {
    return (
      <div aria-busy="true" aria-label={t.loading} className="space-y-1">
        <Skeleton className="h-4" />
        <Skeleton className="h-4" />
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div role="alert" className={`flex flex-wrap items-center ${ICON_GAP.menu}`}>
        <span className={toneInk.danger}>
          {t.loadFailed}: {state.message}
        </span>
        <Button size="sm" variant="secondary" onClick={onRetry}>
          {t.retry}
        </Button>
      </div>
    );
  }
  const { diff } = state;
  if (diff.files.length === 0) return <OrgEmptyLine>{t.noFiles}</OrgEmptyLine>;
  const additions = diff.files.reduce((n, f) => n + f.additions, 0);
  const deletions = diff.files.reduce((n, f) => n + f.deletions, 0);
  return (
    <div className="space-y-1">
      <div className="text-gray-500 dark:text-gray-400">
        {t.summary(diff.files.length, additions, deletions, diff.ahead, diff.behind)}
      </div>
      <ul className="divide-y divide-gray-100 dark:divide-gray-800">
        {diff.files.map((f) => (
          <li key={f.path} className={`flex items-center ${ICON_GAP.row} py-1`}>
            <span className={`w-12 shrink-0 text-right font-mono ${toneInk.success}`}>
              +{f.additions}
            </span>
            <span className={`w-12 shrink-0 font-mono ${toneInk.danger}`}>−{f.deletions}</span>
            <span className="min-w-0 truncate font-mono" data-tooltip={f.path}>
              {f.path}
            </span>
            {f.from !== null && (
              <span className="shrink-0 truncate text-gray-400 dark:text-gray-500">
                {t.renamed(f.from)}
              </span>
            )}
          </li>
        ))}
      </ul>
      {diff.truncated && <div className={toneInk.attention}>{t.truncated(diff.files.length)}</div>}
    </div>
  );
}
