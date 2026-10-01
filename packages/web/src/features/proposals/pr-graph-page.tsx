/**
 * The PR graph page (`proposals/graph`): the delivery repository's open PRs as a commit graph,
 * newest on top and the base branch at the bottom, laid out by pr-graph-model.ts. Each row is one
 * PR at its head — its number (to GitHub), the proposal it is the impl PR of (to that proposal's
 * page), its title and branch, how many commits it adds to the layer below, the marks the server
 * gave it (top, fork, the closed PRs its base led through, stale, off the chain and why) and the PRs
 * the other origins have on the same branch.
 *
 * It is reached from the queue's header and from a proposal's header; the latter opens it with
 * `?proposal=<n>`, and the page scrolls to that proposal's row and tints it, or says in one line
 * why the proposal has no row. Under the graph, pr-graph-rows.tsx lists apart the PRs off the chain,
 * the PRs the graph cannot draw, and the proposals whose impl PR is not on it, each with its reason.
 *
 * The lanes are an SVG drawn behind fixed-height rows, so a row's geometry never depends on how
 * its text wraps: the text truncates and carries the full value in its tooltip.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import type { ProposalGraphResponse } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { formatDateTime, formatRelativeShort } from "../../lib/format";
import { ICON_GAP } from "../../lib/icon-scale";
import { toneInk, toneStrip } from "../../lib/tone";
import { useDocumentTitle } from "../../lib/use-document-title";
import { useLocale } from "../../state/locale";
import { Button } from "../../components/ui/button";
import { Skeleton } from "../../components/ui/skeleton";
import { orgContributedPagePath, orgProposalPath } from "../company/company-nav";
import { OrgEmptyLine, OrgPage, useOrg } from "../company/org-layout";
import { ErrorLine, TitleButton } from "../company/shared";
import { focusedProposal, layoutGraph, rowOfProposal } from "./pr-graph-model";
import type { GraphRow } from "./pr-graph-model";
import {
  FOCUS_WASH,
  Mark,
  NodeListSection,
  NodeRow,
  RELATION_TONE,
  UnplacedSection,
} from "./pr-graph-rows";

/** Row height and lane pitch of the drawn graph, in px. */
const ROW = 44;
const LANE = 16;
const DOT = 4.5;

const laneX = (lane: number): number => lane * LANE + LANE / 2 + 2;
const rowY = (row: number): number => row * ROW + ROW / 2;

/**
 * One edge, drawn from the child's dot down to its parent's: straight when they share a lane,
 * otherwise down the child's lane and bending into the parent's lane just above the parent.
 */
function edgePath(child: number, childLane: number, parent: number, parentLane: number): string {
  const x1 = laneX(childLane);
  const y1 = rowY(child);
  const x2 = laneX(parentLane);
  const y2 = rowY(parent);
  if (x1 === x2) return `M${x1} ${y1}V${y2}`;
  const bend = y2 - ROW / 2;
  return `M${x1} ${y1}V${bend}C${x1} ${y2 - ROW / 6} ${x2} ${bend + ROW / 6} ${x2} ${y2}`;
}

export function GraphPage() {
  const { projectId, orgId, org } = useOrg();
  const { locale } = useLocale();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const focus = focusedProposal(params);
  const t = S.company.proposals.graph;
  useDocumentTitle(org ? `${org.name} · ${t.title}` : t.title);

  const [graph, setGraph] = useState<ProposalGraphResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setGraph(await api.getOrgProposalGraph(projectId, orgId));
    } catch (e) {
      setError(apiErrorText(e));
    } finally {
      setLoading(false);
    }
  }, [projectId, orgId]);
  useEffect(() => {
    setGraph(null);
    void load();
  }, [load]);

  const layout = useMemo(
    () => (graph === null ? null : layoutGraph(graph.nodes, graph.top)),
    [graph],
  );
  const focusRow = layout === null || focus === null ? -1 : rowOfProposal(layout.rows, focus);
  const focusUnplaced =
    graph !== null && focus !== null && graph.unplaced.some((u) => u.number === focus);

  // Scroll the focused proposal's row into view once, when the graph first lands.
  const listRef = useRef<HTMLDivElement | null>(null);
  const scrolledFor = useRef<string | null>(null);
  useEffect(() => {
    if (graph === null || focus === null) return;
    const key = `${graph.checkedAt}:${focus}`;
    if (scrolledFor.current === key) return;
    scrolledFor.current = key;
    const target = listRef.current?.querySelector<HTMLElement>(`[data-focus="true"]`);
    target?.scrollIntoView({ block: "center" });
  }, [graph, focus]);

  const openProposal = (n: number) => navigate(orgProposalPath(projectId, orgId, n));
  const onChain = graph?.nodes.filter((n) => n.onChain).length ?? 0;
  const drawnOff = useMemo(() => {
    const undrawn = new Set(layout?.detached.map((n) => n.number));
    return graph?.nodes.filter((n) => !n.onChain && !undrawn.has(n.number)) ?? [];
  }, [graph, layout]);

  const crumb = (
    <nav aria-label={S.nav.org.proposals} className="mb-3 text-xs text-gray-500 dark:text-gray-400">
      <TitleButton
        onClick={() => navigate(orgContributedPagePath(projectId, orgId, "proposals"))}
        hint={S.company.proposals.backToQueue}
        className="text-xs"
      >
        {S.nav.org.proposals}
      </TitleButton>
      <span className="mx-1.5" aria-hidden="true">
        ›
      </span>
      <span>{t.title}</span>
    </nav>
  );

  return (
    <OrgPage
      title={t.title}
      info={t.info}
      wide
      actions={
        <Button size="sm" variant="secondary" disabled={loading} onClick={() => void load()}>
          {t.refresh}
        </Button>
      }
    >
      {crumb}
      {error !== null ? (
        <ErrorLine message={t.loadFailed} detail={error} onRetry={() => void load()} />
      ) : graph === null || layout === null ? (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : (
        <div className="space-y-6">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
            <span className="font-mono">{graph.repo}</span>
            <span aria-hidden="true">·</span>
            <span>{t.summary(graph.nodes.length, onChain)}</span>
            {graph.origins.map((o) => (
              <span key={o.name} className="font-mono">
                {o.name}={o.repo}
              </span>
            ))}
            <span aria-hidden="true">·</span>
            <span title={formatDateTime(graph.checkedAt)}>
              {t.checkedAt(formatRelativeShort(graph.checkedAt, locale))}
            </span>
          </p>

          {graph.errors.length > 0 && (
            <div className={`rounded-md border px-3 py-2 text-xs ${toneStrip.attention}`}>
              <p>{t.partial}</p>
              <ul className="mt-1 list-disc pl-5">
                {graph.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </div>
          )}

          {focus !== null && focusRow < 0 && !focusUnplaced && (
            <p className={`rounded-md border px-3 py-2 text-xs ${toneStrip.muted}`}>
              {t.focusMissing(focus)}
            </p>
          )}

          {graph.nodes.length === 0 && <OrgEmptyLine>{t.empty}</OrgEmptyLine>}

          <div
            ref={listRef}
            className="overflow-x-auto rounded-md border border-gray-200 dark:border-gray-800"
          >
            <div className="relative" style={{ height: layout.rows.length * ROW }}>
              <Lanes rows={layout.rows} lanes={layout.lanes} />
              <ol className="absolute inset-y-0 right-0" style={{ left: layout.lanes * LANE + 8 }}>
                {layout.rows.map((row, i) => (
                  <li
                    key={row.node === null ? "base" : row.node.number}
                    data-focus={i === focusRow ? "true" : undefined}
                    style={{ height: ROW }}
                    className={`flex items-center pr-3 ${i === focusRow ? FOCUS_WASH : ""}`}
                  >
                    {row.node === null ? (
                      <BaseRow graph={graph} />
                    ) : (
                      <NodeRow graph={graph} node={row.node} onOpenProposal={openProposal} />
                    )}
                  </li>
                ))}
              </ol>
            </div>
          </div>

          <NodeListSection
            graph={graph}
            title={t.offSection}
            info={t.offSectionHint}
            nodes={drawnOff}
            onOpenProposal={openProposal}
          />
          <NodeListSection
            graph={graph}
            title={t.detached}
            info={t.detachedHint}
            nodes={layout.detached}
            onOpenProposal={openProposal}
          />
          <UnplacedSection graph={graph} focus={focus} onOpenProposal={openProposal} />
        </div>
      )}
    </OrgPage>
  );
}

/** The lanes: every edge, then every dot over them. Stacked edges are solid, the rest dashed in their relation's tone. */
function Lanes({ rows, lanes }: { rows: readonly GraphRow[]; lanes: number }) {
  return (
    <svg
      aria-hidden="true"
      width={lanes * LANE + 4}
      height={rows.length * ROW}
      className="absolute top-0 left-0"
    >
      {rows.map((row, i) =>
        row.parentRow === null ? null : (
          <path
            key={`e${i}`}
            d={edgePath(i, row.lane, row.parentRow, rows[row.parentRow]!.lane)}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.7}
            strokeDasharray={row.stacked ? undefined : "3 3"}
            className={
              row.stacked
                ? "text-gray-400 dark:text-gray-500"
                : toneInk[RELATION_TONE[row.node?.relation ?? "unknown"]]
            }
          />
        ),
      )}
      {rows.map((row, i) => {
        const proposal = row.node?.proposal ?? null;
        return (
          <circle
            key={`d${i}`}
            cx={laneX(row.lane)}
            cy={rowY(i)}
            r={row.node === null ? DOT + 1 : DOT}
            stroke="currentColor"
            strokeWidth={1.7}
            className={`${
              proposal !== null || row.node === null
                ? "fill-current"
                : "fill-white dark:fill-gray-950"
            } ${
              row.node === null
                ? "text-gray-600 dark:text-gray-300"
                : row.stacked
                  ? "text-gray-500 dark:text-gray-400"
                  : toneInk[RELATION_TONE[row.node.relation]]
            }`}
          />
        );
      })}
    </svg>
  );
}

function BaseRow({ graph }: { graph: ProposalGraphResponse }) {
  const t = S.company.proposals.graph;
  return (
    <div className={`flex min-w-0 items-center ${ICON_GAP.row} text-xs`}>
      <Mark tone="muted">{t.base}</Mark>
      <span className="font-mono font-medium">{graph.base.branch}</span>
      {graph.base.head !== null && (
        <span className="font-mono text-gray-400 dark:text-gray-500" title={graph.base.head}>
          {graph.base.head.slice(0, 9)}
        </span>
      )}
      {graph.base.fork && <Mark tone="attention">{t.baseForked}</Mark>}
    </div>
  );
}
