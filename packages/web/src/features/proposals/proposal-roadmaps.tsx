/**
 * The roadmaps a proposal belongs to, under its title: one line per roadmap — `Roadmap #n
 * «name» / item <key>` — linking to that roadmap's page, with a link to the queue narrowed to
 * that roadmap's proposals (`roadmap:<n>`). The server answers them on its reads only, so a
 * write's answer keeps the ones the page already has (keepRoadmaps).
 */
import { Link } from "react-router";
import type { ProposalDetail, ProposalRoadmapRef } from "@prismshadow/penguin-server/api";
import { GlyphIcon, ICONS, ICON_GAP, ICON_SIZE } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { orgContributedPagePath } from "../company/company-nav";
import { useOrg } from "../company/org-layout";

/** A write's answer, with the roadmaps of the detail it replaces when it carries none. */
export function keepRoadmaps(prev: ProposalDetail | null, next: ProposalDetail): ProposalDetail {
  return next.roadmaps !== undefined || prev?.roadmaps === undefined
    ? next
    : { ...next, roadmaps: prev.roadmaps };
}

/** The queue narrowed to one roadmap's proposals, in every state. */
export function roadmapQueuePath(projectId: string, orgId: string, number: number): string {
  const q = new URLSearchParams({ q: `roadmap:${number}` });
  return `${orgContributedPagePath(projectId, orgId, "proposals")}?${q.toString()}`;
}

/** The lines for the organization the page is on. */
export function ProposalRoadmaps({
  roadmaps,
}: {
  roadmaps: readonly ProposalRoadmapRef[] | undefined;
}) {
  const { projectId, orgId } = useOrg();
  return <RoadmapLines projectId={projectId} orgId={orgId} roadmaps={roadmaps} />;
}

export function RoadmapLines({
  projectId,
  orgId,
  roadmaps,
}: {
  projectId: string;
  orgId: string;
  roadmaps: readonly ProposalRoadmapRef[] | undefined;
}) {
  if (roadmaps === undefined || roadmaps.length === 0) return null;
  const t = S.company.proposals.roadmaps;
  return (
    <ul aria-label={t.label} className="mt-2 space-y-1 text-xs text-gray-500 dark:text-gray-400">
      {roadmaps.map((r) => (
        <li
          key={`${r.number}/${r.itemKey}`}
          className={`flex min-w-0 flex-wrap items-center ${ICON_GAP.row}`}
        >
          <GlyphIcon d={ICONS.foldedMap} size={ICON_SIZE.rowMark} className="shrink-0" />
          <Link
            to={`${orgContributedPagePath(projectId, orgId, "roadmaps")}/${r.number}`}
            data-tooltip={t.open}
            className="min-w-0 truncate font-medium text-gray-700 hover:underline dark:text-gray-200"
          >
            {t.roadmap(r.number, r.name)}
          </Link>
          <span aria-hidden="true">/</span>
          <span>
            {t.item} <code className="font-mono">{r.itemKey}</code>
          </span>
          <Link to={roadmapQueuePath(projectId, orgId, r.number)} className="hover:underline">
            · {t.filter}
          </Link>
        </li>
      ))}
    </ul>
  );
}
