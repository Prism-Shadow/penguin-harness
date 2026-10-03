/**
 * The PR graph page (`proposals/graph`): the delivery repository's open PRs as a commit graph,
 * newest on top and the base branch at the bottom, laid out by pr-graph-model.ts. Each row is one
 * PR at its head — its number (to GitHub), the proposal it is the impl PR of (to that proposal's
 * page), its title and branch, how many commits it adds to the layer below, the marks the server
 * gave it (top, fork, the closed PRs its base led through, stale, off the chain and why) and the PRs
 * the other origins have on the same branch.
 *
 * A node's menu (a right-click on its row, or its ellipsis) deploys that PR's head with one of
 * the organization's deploy scripts (pr-graph-deploy.tsx).
 *
 * It is reached from the queue's header and from a proposal's header; the latter opens it with
 * `?proposal=<n>`, and the page scrolls to that proposal's row and tints it, or says in one line
 * why the proposal has no row. Under the graph, pr-graph-rows.tsx lists apart the PRs off the chain,
 * the PRs the graph cannot draw, and the proposals whose impl PR is not on it, each with its reason.
 * Each registered deployment is marked on the row its commit sits on, and listed under the
 * graph when it sits on none.
 *
 * The lanes are an SVG drawn behind fixed-height rows, so a row's geometry never depends on how
 * its text wraps: the text truncates and carries the full value in its tooltip.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router";
import type { ProposalGraphNode, ProposalGraphResponse } from "@prismshadow/penguin-server/api";
import { Button, ICON_GAP, NoticeStrip, Skeleton } from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { formatDateTime, formatRelativeShort } from "../../lib/format";
import { toneInk } from "../../lib/tone";
import { useDocumentTitle } from "../../lib/use-document-title";
import { useLocale } from "../../state/locale";
import { orgContributedPagePath, orgProposalPath } from "../company/company-nav";
import { OrgEmptyLine, OrgPage, useOrg } from "../company/org-layout";
import { ErrorLine, TitleButton } from "../company/shared";
import {
  baseStacks,
  focusedProposal,
  layoutGraph,
  rowOfProposal,
  graphGeometry,
  rowWidths,
  topDown,
} from "./pr-graph-model";
import type { GraphGeometry, GraphRow } from "./pr-graph-model";
import {
  FOCUS_WASH,
  Mark,
  NodeListSection,
  NodeRow,
  RELATION_TONE,
  UnplacedSection,
} from "./pr-graph-rows";
import { DeployDialog, DeployableRow, useDeployScripts } from "./pr-graph-deploy";
import { DeployDock, useDeployJobs } from "./pr-graph-deploy-dock";
import { AssociateDialog } from "./pr-graph-associate";
import { DeploymentMarks, DeploymentsOff } from "./pr-graph-deployments";

/** Reads of a graph the organization's machine is still building, and the pause between them. */
const GRAPH_READ_TRIES = 4;
const GRAPH_RETRY_MS = 2_000;

/** The root font-size in px, kept current: the theme's text size rewrites it on <html>. */
function useRootFontPx(): number {
  const read = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const [px, setPx] = useState(read);
  useEffect(() => {
    const update = () => setPx(read());
    const watch = new MutationObserver(update);
    watch.observe(document.documentElement, { attributes: true });
    update();
    return () => watch.disconnect();
  }, []);
  return px;
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
      // The first read after the organization's server restarts asks GitHub for everything and
      // can outlast the hub's wait (504 machine_not_answering); that read goes on and fills the
      // server's cache, so asking again soon gets the graph. A few tries, then the error shows.
      for (let attempt = 1; ; attempt++) {
        try {
          setGraph(await api.getOrgProposalGraph(projectId, orgId));
          return;
        } catch (e) {
          const slow = e instanceof ApiError && e.code === "machine_not_answering";
          if (!slow || attempt >= GRAPH_READ_TRIES) throw e;
          await new Promise((r) => setTimeout(r, GRAPH_RETRY_MS));
        }
      }
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
    () => (graph === null ? null : topDown(layoutGraph(graph.nodes, graph.top))),
    [graph],
  );
  const widths = useMemo(() => (layout === null ? [] : rowWidths(layout.rows)), [layout]);
  const remPx = useRootFontPx();
  const geo = useMemo(() => graphGeometry(remPx), [remPx]);
  // The row under the pointer; its lanes' dot and edge light up with it.
  const [hovered, setHovered] = useState<number | null>(null);
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
  const deployScripts = useDeployScripts(projectId, orgId);
  const deploys = useDeployJobs(projectId, orgId);
  const [associating, setAssociating] = useState(false);
  const openJob = deploys.jobs.find((j) => j.key === deploys.open) ?? null;
  const deployable = (node: ProposalGraphNode, row: ReactNode) => (
    <DeployableRow
      node={node}
      scripts={deployScripts.scripts}
      scriptsError={deployScripts.error}
      onPick={(script) => deploys.start(node, script)}
      onAssociate={() => setAssociating(true)}
    >
      {row}
    </DeployableRow>
  );
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
            <span data-tooltip={formatDateTime(graph.checkedAt)}>
              {t.checkedAt(formatRelativeShort(graph.checkedAt, locale))}
            </span>
          </p>

          {graph.errors.length > 0 && (
            <NoticeStrip tone="attention" className="rounded-md border px-3 py-2 text-xs">
              <p>{t.partial}</p>
              <ul className="mt-1 list-disc pl-5">
                {graph.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </NoticeStrip>
          )}

          {focus !== null && focusRow < 0 && !focusUnplaced && (
            <NoticeStrip as="p" tone="neutral" className="rounded-md border px-3 py-2 text-xs">
              {t.focusMissing(focus)}
            </NoticeStrip>
          )}

          {graph.nodes.length === 0 && <OrgEmptyLine>{t.empty}</OrgEmptyLine>}

          <div ref={listRef} className="overflow-x-auto">
            <div className="relative" style={{ height: layout.rows.length * geo.row }}>
              <ol className="absolute inset-0">
                {layout.rows.map((row, i) => (
                  <li
                    key={row.node === null ? "base" : row.node.number}
                    data-focus={i === focusRow ? "true" : undefined}
                    style={{ height: geo.row, paddingLeft: widths[i]! * geo.lane + geo.textGap }}
                    onMouseEnter={() => setHovered(i)}
                    onMouseLeave={() => setHovered((h) => (h === i ? null : h))}
                    // A hairline between rows: a node's two lines read as one block, apart from
                    // the next node's. Hover washes the whole row, lanes included.
                    className={`flex items-center border-b border-line-muted pr-3 transition-colors duration-150 last:border-b-0 ${
                      i === focusRow ? FOCUS_WASH : i === hovered ? "bg-surface-muted" : ""
                    }`}
                  >
                    {row.node === null ? (
                      <BaseRow graph={graph} />
                    ) : (
                      deployable(
                        row.node,
                        <NodeRow graph={graph} node={row.node} onOpenProposal={openProposal} />,
                      )
                    )}
                  </li>
                ))}
              </ol>
              {/* Over the rows (a focused row's wash stays under the dots), never taking a click. */}
              <Lanes rows={layout.rows} lanes={layout.lanes} hovered={hovered} geo={geo} />
            </div>
          </div>

          <NodeListSection
            graph={graph}
            title={t.offSection}
            info={t.offSectionHint}
            nodes={drawnOff}
            onOpenProposal={openProposal}
            wrapRow={deployable}
          />
          <NodeListSection
            graph={graph}
            title={t.detached}
            info={t.detachedHint}
            nodes={layout.detached}
            onOpenProposal={openProposal}
            wrapRow={deployable}
          />
          <DeploymentsOff deployments={graph.deployments} />
          <UnplacedSection graph={graph} focus={focus} onOpenProposal={openProposal} />
        </div>
      )}
      {openJob !== null && (
        <DeployDialog
          key={openJob.key}
          projectId={projectId}
          orgId={orgId}
          node={openJob.node}
          script={openJob.script}
          runId={openJob.runId}
          onRun={(run) => deploys.update(openJob.key, run)}
          onClose={deploys.close}
        />
      )}
      {associating && (
        <AssociateDialog
          projectId={projectId}
          orgId={orgId}
          scripts={deployScripts.scripts ?? []}
          onClose={() => setAssociating(false)}
          onSaved={() => {
            setAssociating(false);
            deployScripts.reload();
          }}
        />
      )}
      <DeployDock
        projectId={projectId}
        orgId={orgId}
        jobs={deploys.jobs}
        open={deploys.open}
        onOpen={deploys.setOpen}
        onStatus={deploys.update}
        onDismiss={deploys.dismiss}
      />
    </OrgPage>
  );
}

/** The lanes: every edge, then every dot over them. Stacked edges are solid, the rest dashed in their relation's tone. */
function Lanes({
  rows,
  lanes,
  hovered,
  geo,
}: {
  rows: readonly GraphRow[];
  lanes: number;
  geo: GraphGeometry;
  /** The row under the pointer: its dot and its edge to its parent are drawn heavier. */
  hovered: number | null;
}) {
  return (
    <svg
      aria-hidden="true"
      width={lanes * geo.lane + 4}
      height={rows.length * geo.row}
      className="pointer-events-none absolute top-0 left-0"
    >
      {rows.map((row, i) =>
        row.parentRow === null ? null : (
          <path
            key={`e${i}`}
            d={geo.edgePath(i, row.lane, row.parentRow, rows[row.parentRow]!.lane)}
            fill="none"
            stroke="currentColor"
            strokeWidth={i === hovered ? 2.6 : 1.7}
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
            cx={geo.laneX(row.lane)}
            cy={geo.rowY(i)}
            r={(row.node === null ? geo.dot + 1 : geo.dot) + (i === hovered ? 1.5 : 0)}
            stroke="currentColor"
            strokeWidth={i === hovered ? 2.6 : 1.7}
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
        <span className="font-mono text-gray-400 dark:text-gray-500" data-tooltip={graph.base.head}>
          {graph.base.head.slice(0, 9)}
        </span>
      )}
      {graph.base.fork &&
        (baseStacks(graph.nodes) > 1 ? (
          <Mark tone="muted">{t.baseStacks(baseStacks(graph.nodes))}</Mark>
        ) : (
          <Mark tone="attention">{t.baseForked}</Mark>
        ))}
      <DeploymentMarks deployments={graph.deployments} at={0} />
    </div>
  );
}
