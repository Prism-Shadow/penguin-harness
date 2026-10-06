/**
 * The PR graph page's rows and the three lists under the graph. A node row carries the marks the
 * server gave it — top, fork, the merged or closed PRs its base led through, stale, the reason
 * it is off the chain and, when its base names no node, what fixing that takes — and the
 * registered deployments whose commit sits on it. Under the graph, three lists answer three
 * different questions and are named apart: the nodes drawn but off the chain, the nodes the
 * graph cannot draw at all, and the proposals whose impl is on no node — each row with its
 * reason. A node is an open PR, or an impl branch no PR is open on yet (a branch node: no
 * number, its proposal always named).
 */
import type { ReactNode } from "react";
import type {
  ProposalGraphNode,
  ProposalGraphOffReason,
  ProposalGraphRelation,
  ProposalGraphResponse,
  ProposalStatus,
} from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import { toneInk, toneSurface } from "../../lib/tone";
import type { Tone } from "../../lib/tone";
import { Badge, ICON_GAP, RuledSection } from "@prismshadow/penguin-ui";
import { TitleButton } from "../company/shared";
import { PROPOSAL_STATUS_TONE } from "./proposals-model";
import { DeploymentMarks } from "./pr-graph-deployments";
import { nodeRef } from "./pr-graph-model";

/** The focused proposal's row: a background wash only, so the marks on it keep their own ink. */
export const FOCUS_WASH = "bg-blue-50 dark:bg-blue-950/40";

/** How one head stands against another, as a tone: the same is settled, behind waits, diverged is the problem. */
export const RELATION_TONE: Record<ProposalGraphRelation, Tone> = {
  same: "success",
  ahead: "link",
  behind: "attention",
  diverged: "danger",
  unknown: "muted",
};

/** Why a node is off the chain, as a tone: a broken line is the problem, a branch the chain did not take only recedes. */
const OFF_TONE: Record<ProposalGraphOffReason, Tone> = {
  "old-line": "danger",
  unread: "muted",
  "no-base": "danger",
  "not-taken": "muted",
  above: "muted",
  cycle: "danger",
};

function StatusPill({ status }: { status: ProposalStatus }) {
  return (
    <Badge tone={PROPOSAL_STATUS_TONE[status]}>
      {S.company.proposals.status[status] ?? status}
    </Badge>
  );
}

export function Mark({ tone, children, title }: { tone: Tone; children: string; title?: string }) {
  return (
    <span
      data-tooltip={title}
      className={`shrink-0 rounded px-1 text-xs font-medium ${toneSurface[tone]}`}
    >
      {children}
    </span>
  );
}

/** A node by its key: `#n` for a PR, the branch for a branch node, the base branch's name for `""`. */
export function layerLabel(graph: ProposalGraphResponse, key: string | null): string {
  if (key === null) return "?";
  if (key === "") return graph.base.branch;
  const node = graph.nodes.find((n) => n.key === key);
  return node === undefined ? key : nodeRef(node);
}

/** The sentence saying why a node is off the chain; empty when it is on it. */
export function offReasonText(graph: ProposalGraphResponse, node: ProposalGraphNode): string {
  if (node.off === null) return "";
  const t = S.company.proposals.graph;
  const own = node.off.reason === "old-line" || node.off.reason === "unread";
  return t.offReason(
    node.off.reason,
    layerLabel(graph, own ? node.parent : node.off.at),
    t.relation[node.relation] ?? node.relation,
    node.base,
  );
}

/** A PR's URL as the rows name it, `owner/repo#n`; any other URL as it is. */
function prLabel(url: string): string {
  const m = /github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/.exec(url);
  return m === null ? url : `${m[1]}#${m[2]}`;
}

/**
 * What fixing an off-chain node takes, when its base names no node: the merged PR that claimed
 * the base branch away, or the base nothing registers. Empty when the server says nothing more.
 */
export function offDetailText(node: ProposalGraphNode): string {
  const off = node.off;
  if (off === null || off.missing === undefined) return "";
  const t = S.company.proposals.graph;
  if (off.by?.pr !== undefined)
    return t.offClaimed(off.missing, off.by.proposal, prLabel(off.by.pr));
  return t.offMissing(off.missing, off.by?.proposal ?? null);
}

export function NodeRow({
  graph,
  node,
  onOpenProposal,
}: {
  graph: ProposalGraphResponse;
  node: ProposalGraphNode;
  onOpenProposal: (n: number) => void;
}) {
  const t = S.company.proposals.graph;
  const relationWord = (r: ProposalGraphRelation) => t.relation[r] ?? r;
  const detail = offDetailText(node);
  return (
    <div className="flex min-w-0 flex-1 flex-col justify-center gap-0">
      <div className={`flex min-w-0 items-center ${ICON_GAP.row} text-xs`}>
        {node.number !== null && node.url !== null ? (
          <a
            href={node.url}
            target="_blank"
            rel="noreferrer"
            data-tooltip={t.openPr}
            className="shrink-0 font-mono text-gray-500 hover:underline dark:text-gray-400"
          >
            #{node.number}
          </a>
        ) : (
          <span
            data-tooltip={t.branchNodeTitle}
            className="shrink-0 font-mono text-gray-500 dark:text-gray-400"
          >
            {t.branchNode}
          </span>
        )}
        {node.proposal === null ? (
          <Mark tone="muted">{t.noProposal}</Mark>
        ) : (
          <>
            <TitleButton
              onClick={() => onOpenProposal(node.proposal!.number)}
              hint={`${S.company.proposals.openProposal}: ${node.proposal.title}`}
              className="shrink-0 font-mono text-xs font-medium"
            >
              {t.proposalRef(node.proposal.number)}
            </TitleButton>
            <StatusPill status={node.proposal.status} />
          </>
        )}
        <span className="min-w-0 flex-1 truncate" data-tooltip={node.title}>
          {node.title}
        </span>
        {graph.tops.includes(node.key) && <Mark tone="success">{t.top}</Mark>}
        {node.fork && <Mark tone="attention">{t.fork}</Mark>}
        {node.via.map((v) => (
          <Mark
            key={v.number}
            tone={v.state === "closed" ? "attention" : "muted"}
            title={v.state === "closed" ? t.viaClosedTitle(v.number) : t.viaMergedTitle(v.number)}
          >
            {t.via(v.state, v.number)}
          </Mark>
        ))}
        {node.stale &&
          (node.parent === "" ? (
            // The bottom layer: the base branch itself moved on.
            <Mark tone="attention" title={t.staleBaseTitle(graph.base.branch, node.behind ?? 0)}>
              {t.staleBase(graph.base.branch, node.behind ?? 0)}
            </Mark>
          ) : (
            <Mark tone="attention" title={t.staleTitle(node.behind ?? 0)}>
              {t.stale}
            </Mark>
          ))}
        {node.off !== null && (
          <Mark tone={OFF_TONE[node.off.reason]}>{offReasonText(graph, node)}</Mark>
        )}
        <DeploymentMarks deployments={graph.deployments} at={node.key} />
      </div>
      {/* The branch line sits under the first, indented: it belongs to that node. */}
      <div
        className={`flex min-w-0 items-center pl-4 ${ICON_GAP.row} text-xs text-gray-500 dark:text-gray-400`}
      >
        <span className="min-w-0 truncate font-mono" data-tooltip={`${node.branch} → ${node.base}`}>
          {node.branch}
        </span>
        {node.ahead !== null && (
          <span
            className="shrink-0 font-mono tabular-nums"
            data-tooltip={t.aheadTitle(node.ahead, node.base)}
          >
            {t.ahead(node.ahead)}
          </span>
        )}
        {node.draft && <span className="shrink-0">{S.company.proposals.materialStatus.draft}</span>}
        {node.origins.map((o) => (
          <a
            key={`${o.origin}#${o.number}`}
            href={o.url}
            target="_blank"
            rel="noreferrer"
            data-tooltip={t.originTitle(o.origin, o.number, relationWord(o.relation))}
            className={`shrink-0 font-mono hover:underline ${toneInk[RELATION_TONE[o.relation]]}`}
          >
            {o.origin}#{o.number} {relationWord(o.relation)}
          </a>
        ))}
        {detail !== "" && (
          <span className={`min-w-0 truncate ${toneInk.attention}`} data-tooltip={detail}>
            {detail}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * A list of node rows under the graph: the drawn-but-off-chain ones, or the ones it cannot draw.
 * `wrapRow` wraps each row the way the page wraps the graph's own rows (the deploy menu), so a PR
 * offers the same menu wherever it is listed.
 */
export function NodeListSection({
  graph,
  title,
  info,
  nodes,
  onOpenProposal,
  wrapRow = (_node, row) => row,
}: {
  graph: ProposalGraphResponse;
  title: string;
  info: string;
  nodes: readonly ProposalGraphNode[];
  onOpenProposal: (n: number) => void;
  wrapRow?: (node: ProposalGraphNode, row: ReactNode) => ReactNode;
}) {
  if (nodes.length === 0) return null;
  return (
    <RuledSection title={title} count={nodes.length} info={info}>
      <ul className="divide-y divide-gray-100 dark:divide-gray-800">
        {nodes.map((node) => (
          <li key={node.key} className="flex items-center py-1.5 pr-3">
            {wrapRow(node, <NodeRow graph={graph} node={node} onOpenProposal={onOpenProposal} />)}
          </li>
        ))}
      </ul>
    </RuledSection>
  );
}

/** The proposals whose impl is on no node of the graph, each with why. */
export function UnplacedSection({
  graph,
  unplaced = graph.unplaced,
  focus,
  onOpenProposal,
}: {
  graph: ProposalGraphResponse;
  /** The entries to list; the page passes them without the folded merged ones. */
  unplaced?: ProposalGraphResponse["unplaced"];
  focus: number | null;
  onOpenProposal: (n: number) => void;
}) {
  const t = S.company.proposals.graph;
  if (unplaced.length === 0) return null;
  return (
    <RuledSection title={t.unplaced} count={unplaced.length} info={t.unplacedHint}>
      <ul className="divide-y divide-gray-100 dark:divide-gray-800">
        {unplaced.map((u) => (
          <li
            key={u.number}
            data-focus={focus === u.number ? "true" : undefined}
            className={`flex items-center ${ICON_GAP.row} px-1 py-1.5 text-xs ${
              focus === u.number ? FOCUS_WASH : ""
            }`}
          >
            <TitleButton
              onClick={() => onOpenProposal(u.number)}
              hint={S.company.proposals.openProposal}
              className="font-mono text-xs"
            >
              #{u.number}
            </TitleButton>
            <StatusPill status={u.status} />
            <span className="min-w-0 truncate" data-tooltip={u.title}>
              {u.title}
            </span>
            <Mark tone={u.reason === "counterpart" ? "attention" : "muted"}>
              {t.unplacedReason(
                u.reason,
                u.at === null ? "?" : `#${u.at}`,
                u.into ?? "?",
                graph.base.branch,
              )}
            </Mark>
            {u.implPr !== null ? (
              <a
                href={u.implPr}
                target="_blank"
                rel="noreferrer"
                data-tooltip={u.implPr}
                className="ml-auto shrink-0 truncate pl-3 text-gray-400 hover:underline dark:text-gray-500"
              >
                {u.implPr.replace(/^https?:\/\/github\.com\//, "")}
              </a>
            ) : (
              // An impl branch with no PR: its declared head, `<remote>/<branch>`.
              <span className="ml-auto shrink-0 truncate pl-3 font-mono text-gray-400 dark:text-gray-500">
                {u.branch ?? ""}
              </span>
            )}
          </li>
        ))}
      </ul>
    </RuledSection>
  );
}
