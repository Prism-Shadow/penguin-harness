/**
 * A roadmap in its room's column, drawn by the app from the company-roadmaps plugin's answer for
 * that roadmap (`GET …/roadmaps/<n>`): the header (number, name, status and the moderator's face
 * and name), then the items as a list shaped like the proposals queue, then the body.
 *
 * The items come first. A proposal item that has its proposal linked is that proposal's row —
 * its number, its current title as the link, its status; one that does not says where it stands
 * (a draft, a brief waiting for its two approvals with the person's Approve, or delegated). A
 * linked proposal the organization's list does not hold (yet) wears a grey "status unknown" pill,
 * so a list that failed to load never leaves the rows bare. Every
 * employee the column names is a face and a name, never an id. The body is Markdown through the
 * channel message pipeline, so a `proposal:<n>` in it is a capsule, an `@` a name and a footnote
 * a note; it is laid straight into the column with no card around it. The record is the
 * moderator's notes and stays in the plugin's answer, but the column does not draw it.
 *
 * The column is one of the app's own scrollers, so the app's thin scrollbar applies. The roadmap
 * is read again every {@link DETAIL_POLL_MS}, and the state is replaced only when the answer
 * changed, so the draft follows the discussion without the column redrawing under the reader.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProposalItem } from "@prismshadow/penguin-server/api";
import { useNavigate } from "react-router";
import * as api from "../../api/endpoints";
import type { OrgRoadmapApproval, OrgRoadmapDetail } from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { formatDateTime, formatRelativeShort } from "../../lib/format";
import { useCompany } from "../../state/company";
import { useLocale } from "../../state/locale";
import {
  Badge,
  Button,
  ICON_GAP,
  ICON_SIZE,
  Skeleton,
  Text,
  toastError,
} from "@prismshadow/penguin-ui";
import type { ToneName as BadgeTone } from "@prismshadow/penguin-ui";
import { PROPOSAL_STATUS_TONE } from "../proposals/proposals-model";
import { ChannelMessageBody } from "./channel-markdown";
import { orgProposalPath } from "./company-nav";
import { ErrorLine, PrincipalChip, TitleButton } from "./shared";
import { personMayApprove, roadmapRows } from "./roadmaps";
import type { RoadmapRow, RoadmapRowStage } from "./roadmaps";

/** How often the column reads the roadmap again while it is open. */
export const DETAIL_POLL_MS = 10_000;

const STAGE_TONE: Record<RoadmapRowStage, BadgeTone> = {
  draft: "gray",
  brief: "amber",
  delegated: "gray",
};

/** The roadmap's own status as a pill: waiting for a room is unfinished, a shelved discussion recedes. */
function statusTone(r: OrgRoadmapDetail): BadgeTone {
  if (r.archived && r.status !== "established") return "gray";
  return r.status === "awaiting_room" ? "amber" : "green";
}

export function RoadmapDetail({
  projectId,
  orgId,
  number,
}: {
  projectId: string;
  orgId: string;
  number: number;
}) {
  const company = useCompany();
  const navigate = useNavigate();
  const [roadmap, setRoadmap] = useState<OrgRoadmapDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState<string | null>(null);
  /** The last answer as read, so an unchanged answer does not replace the state. */
  const drawn = useRef("");

  const load = useCallback(async () => {
    try {
      const next = await api.getOrgRoadmap(projectId, orgId, number);
      const json = JSON.stringify(next);
      setError(null);
      if (json === drawn.current) return;
      drawn.current = json;
      setRoadmap(next);
    } catch (e) {
      setError(apiErrorText(e));
    }
  }, [projectId, orgId, number]);

  useEffect(() => {
    drawn.current = "";
    setRoadmap(null);
    setError(null);
    void load();
    const timer = window.setInterval(() => void load(), DETAIL_POLL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const names = useMemo(
    () => new Map((company.orgChart?.employees ?? []).map((e) => [e.agentId, e.name])),
    [company.orgChart],
  );
  const proposals = useMemo(
    () => new Map((company.proposals ?? []).map((p) => [p.number, p])),
    [company.proposals],
  );

  const approve = async (key: string) => {
    setApproving(key);
    try {
      await api.approveOrgRoadmapItem(projectId, orgId, number, key);
      await load();
    } catch (e) {
      toastError(`${S.company.roadmaps.approveFailed}: ${apiErrorText(e)}`);
    } finally {
      setApproving(null);
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
      {roadmap === null ? (
        error !== null ? (
          <ErrorLine
            message={S.company.roadmaps.detailLoadFailed}
            detail={error}
            onRetry={() => void load()}
          />
        ) : (
          <div className="space-y-2" aria-busy="true">
            <Skeleton className="h-6" />
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
          </div>
        )
      ) : (
        <RoadmapDetailView
          roadmap={roadmap}
          names={names}
          proposals={proposals}
          approving={approving}
          onApprove={(key) => void approve(key)}
          onOpenProposal={(n) => navigate(orgProposalPath(projectId, orgId, n))}
        />
      )}
    </div>
  );
}

/** The column's content for one roadmap, with everything it reads passed in. */
export function RoadmapDetailView({
  roadmap: r,
  names,
  proposals,
  approving,
  onApprove,
  onOpenProposal,
}: {
  roadmap: OrgRoadmapDetail;
  names: ReadonlyMap<string, string>;
  proposals: ReadonlyMap<number, ProposalItem>;
  approving: string | null;
  onApprove: (key: string) => void;
  onOpenProposal: (number: number) => void;
}) {
  const t = S.company.roadmaps;
  const rows = roadmapRows(r);
  const proposalRows = rows.filter((row) => row.kind === "proposal");
  const roadmapItemRows = rows.filter((row) => row.kind === "roadmap");
  const list = (title: string, items: RoadmapRow[]) => (
    <section className="mt-4">
      <h3 className="mb-1.5">
        <Text variant="eyebrow" as="span">
          {title}
        </Text>
      </h3>
      <ul className="divide-y divide-gray-100 rounded-md border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
        {items.map((row) => (
          <RoadmapItemRow
            key={row.key}
            row={row}
            names={names}
            proposal={row.proposal === null ? null : (proposals.get(row.proposal) ?? null)}
            approving={approving === row.key}
            onApprove={() => onApprove(row.key)}
            onOpenProposal={onOpenProposal}
          />
        ))}
      </ul>
    </section>
  );
  return (
    <>
      <header>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h2 className="min-w-0 text-sm font-semibold text-gray-900 dark:text-gray-100">
            <span className="font-mono text-gray-400 dark:text-gray-500">#{r.number}</span> {r.name}
          </h2>
          <Badge tone={statusTone(r)}>
            {t.status[r.status] ?? r.status}
            {r.archived && r.status !== "established" ? ` · ${t.archived}` : ""}
          </Badge>
        </div>
        {r.moderator !== null && (
          <div
            className={`mt-1 flex items-center ${ICON_GAP.row} text-xs text-gray-500 dark:text-gray-400`}
          >
            <span>{t.moderator}</span>
            <PrincipalChip
              principal={`agent:${r.moderator}`}
              names={names}
              size={ICON_SIZE.rowLead}
            />
          </div>
        )}
      </header>

      {rows.length === 0 ? (
        <p className="mt-4 text-xs text-gray-400 dark:text-gray-500">{t.noItems}</p>
      ) : (
        <>
          {proposalRows.length > 0 && list(t.proposals, proposalRows)}
          {roadmapItemRows.length > 0 && list(t.roadmapItems, roadmapItemRows)}
          {rows.some((row) => row.stage === "brief") && (
            <p className="mt-1.5 text-xs text-gray-400 dark:text-gray-500">{t.approveHint}</p>
          )}
        </>
      )}

      <RoadmapBody text={r.body} />
    </>
  );
}

/** The body: Markdown through the channel pipeline, laid straight into the column (no card). */
export function RoadmapBody({ text }: { text: string }) {
  if (text.trim() === "") return null;
  return (
    <div className="md-body mt-4 text-sm text-gray-800 dark:text-gray-200">
      <ChannelMessageBody text={text} />
    </div>
  );
}

/**
 * One item as a row of the proposals queue's shape: the number (the proposal's, else the item's
 * key), the title with its status pill, then a quiet line of who it names; a brief waiting for its
 * approvals adds who approved and when, and the person's Approve while theirs is missing.
 */
function RoadmapItemRow({
  row,
  names,
  proposal,
  approving,
  onApprove,
  onOpenProposal,
}: {
  row: RoadmapRow;
  names: ReadonlyMap<string, string>;
  proposal: ProposalItem | null;
  approving: boolean;
  onApprove: () => void;
  onOpenProposal: (number: number) => void;
}) {
  const t = S.company.roadmaps;
  const linked = row.proposal;
  return (
    <li className="flex items-start gap-3 px-3 py-2.5 transition-colors duration-150 hover:bg-gray-50 dark:hover:bg-gray-900">
      <span className="mt-0.5 w-10 shrink-0 font-mono text-xs tabular-nums text-gray-400 dark:text-gray-500">
        {linked !== null ? `#${linked}` : row.key}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {linked !== null ? (
            <TitleButton
              onClick={() => onOpenProposal(linked)}
              hint={t.openProposal}
              className="text-sm font-medium focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:outline-none"
            >
              <span className="line-clamp-2">{proposal?.title ?? row.title}</span>
            </TitleButton>
          ) : (
            <span className="line-clamp-2 min-w-0 text-sm font-medium">{row.title}</span>
          )}
          {proposal !== null ? (
            <Badge tone={PROPOSAL_STATUS_TONE[proposal.status]}>
              {S.company.proposals.status[proposal.status] ?? proposal.status}
            </Badge>
          ) : row.child !== null ? (
            <Badge tone="brand">{t.childRoadmap(row.child)}</Badge>
          ) : linked === null ? (
            <Badge tone={STAGE_TONE[row.stage]}>{t.stage[row.stage]}</Badge>
          ) : (
            // The proposal is not in the organization's list: the list has not loaded (a failed
            // read, a machine link that dropped) or it does not carry this number. The row still
            // says it has a status, one the column could not read, instead of drawing none.
            <span data-tooltip={t.statusUnknownHint}>
              <Badge tone="gray">{t.statusUnknown}</Badge>
            </span>
          )}
        </div>
        {linked === null && row.brief !== "" && (
          <p className="mt-0.5 line-clamp-2 text-xs text-gray-500 dark:text-gray-400">
            {row.brief}
          </p>
        )}
        <div
          className={`mt-1 flex flex-wrap items-center ${ICON_GAP.row} text-xs text-gray-500 dark:text-gray-400`}
        >
          {row.people.map((p) => (
            <PrincipalChip key={p} principal={p} names={names} size={ICON_SIZE.rowLead} />
          ))}
        </div>
        {row.approvals !== null && (
          <div
            className={`mt-1 flex flex-wrap items-center ${ICON_GAP.row} text-xs text-gray-500 dark:text-gray-400`}
          >
            <span>{t.approvals}</span>
            <ApprovalMark label={t.byPerson} approval={row.approvals.person} names={names} />
            <span aria-hidden="true">·</span>
            <ApprovalMark label={t.byModerator} approval={row.approvals.moderator} names={names} />
            {personMayApprove(row) && (
              <Button size="sm" disabled={approving} onClick={onApprove}>
                {t.approve}
              </Button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

/** One of a brief's two approvals: who gave it and when, or that it is still waited for. */
function ApprovalMark({
  label,
  approval,
  names,
}: {
  label: string;
  approval: OrgRoadmapApproval | null;
  names: ReadonlyMap<string, string>;
}) {
  const { locale } = useLocale();
  return (
    <span className={`inline-flex min-w-0 items-center ${ICON_GAP.tight}`}>
      <span>{label}</span>
      {approval === null ? (
        <span className="text-gray-400 dark:text-gray-500">{S.company.roadmaps.waiting}</span>
      ) : (
        <>
          <PrincipalChip principal={approval.by} names={names} size={ICON_SIZE.rowLead} />
          <span data-tooltip={formatDateTime(approval.at)}>
            {formatRelativeShort(approval.at, locale)}
          </span>
        </>
      )}
    </span>
  );
}
