/**
 * The sidebar's ROADMAPS section: its own header below the channel list (apart from "My
 * channels", since a roadmap's room is a channel the channel list leaves out), the most recently
 * active roadmaps under discussion — five at rest, the rest behind "Show n more" — and "All
 * roadmaps" at the end, which opens the plugin's own page (every roadmap, established and
 * shelved ones too). A row opens the roadmap's room: the app's channel page, which shows the
 * roadmap beside the stream (roadmap-panel.tsx). The header's "+" opens the plugin's page with
 * its "Open a roadmap" dialog already up.
 *
 * Drawn only while the company-roadmaps plugin contributes its page. The list is read when the
 * organization changes and again on every navigation, which is when a roadmap may have been
 * opened or its room spoken in; a failed read says so in one line rather than hiding the
 * section.
 */
import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router";
import * as api from "../../api/endpoints";
import type { OrgRoadmapItem } from "../../api/endpoints";
import { S } from "../../lib/strings";
import { ICON_GAP, ICON_SIZE } from "../../lib/icon-scale";
import { toneInk } from "../../lib/tone";
import { Icon } from "../../components/ui/group-list";
import { NAV_ICONS, PlusIcon } from "../../components/ui/icons";
import { Truncated } from "../../components/ui/truncated";
import { useContributions } from "../../state/contributions";
import { orgChannelPath, orgContributedPagePath } from "./company-nav";
import { roadmapsPageSrc, sidebarRoadmaps } from "./roadmaps";

export function RoadmapsSidebar({
  projectId,
  orgId,
  onNavigate,
}: {
  projectId: string;
  orgId: string;
  onNavigate?: () => void;
}) {
  const { pages } = useContributions();
  const enabled = roadmapsPageSrc(pages) !== null;
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [roadmaps, setRoadmaps] = useState<OrgRoadmapItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setRoadmaps(null);
    setExpanded(false);
  }, [projectId, orgId]);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    api
      .listOrgRoadmaps(projectId, orgId)
      .then((res) => {
        if (!live) return;
        setRoadmaps(res.roadmaps);
        setFailed(false);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [enabled, projectId, orgId, pathname]);

  if (!enabled) return null;
  const { shown, more } = sidebarRoadmaps(roadmaps ?? []);
  const pagePath = orgContributedPagePath(projectId, orgId, "roadmaps");
  const row = (r: OrgRoadmapItem & { channelId: string }) => (
    <li
      key={r.number}
      className="rounded-md transition-colors duration-150 hover:bg-gray-200/50 dark:hover:bg-gray-800/70"
    >
      <NavLink
        to={orgChannelPath(projectId, orgId, r.channelId)}
        onClick={() => onNavigate?.()}
        title={`#${r.number} ${r.name}`}
        className={({ isActive }) =>
          `flex min-w-0 items-center ${ICON_GAP.row} rounded-md px-2.5 py-1.5 text-sm transition-colors duration-150 ${
            isActive
              ? "bg-gray-200/70 font-medium text-gray-900 dark:bg-gray-800 dark:text-gray-100"
              : "text-gray-600 dark:text-gray-400"
          }`
        }
      >
        <span className="shrink-0 text-gray-400 dark:text-gray-500">
          <Icon d={NAV_ICONS.orgRoadmaps} size={ICON_SIZE.rowLead} />
        </span>
        <Truncated text={r.name} className="min-w-0 flex-1" />
        <span className="shrink-0 text-[11px] tabular-nums text-gray-400 dark:text-gray-500">
          #{r.number}
        </span>
      </NavLink>
    </li>
  );

  return (
    <section aria-label={S.company.roadmaps.listTitle}>
      <div className="mt-3 flex items-center justify-between gap-2 px-1 pt-2">
        <span className="px-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
          {S.company.roadmaps.listTitle}
        </span>
        <button
          type="button"
          title={S.company.roadmaps.open}
          aria-label={S.company.roadmaps.open}
          onClick={() => {
            navigate(`${pagePath}?open=1`);
            onNavigate?.();
          }}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors duration-150 hover:bg-gray-200/70 hover:text-gray-800 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-200"
        >
          <PlusIcon size={ICON_SIZE.groupHeaderAction} />
        </button>
      </div>
      {failed && roadmaps === null ? (
        <p className={`px-2.5 py-1 text-xs ${toneInk.danger}`}>{S.company.roadmaps.loadFailed}</p>
      ) : roadmaps !== null && shown.length === 0 ? (
        <p className="px-2.5 pt-1 text-xs text-gray-400 dark:text-gray-600">
          {S.company.roadmaps.none}
        </p>
      ) : (
        <ul className="space-y-0.5 pt-1">
          {shown.map(row)}
          {expanded && more.map(row)}
        </ul>
      )}
      <div className="flex items-center gap-1 px-1 pt-0.5">
        {more.length > 0 && (
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
            className="rounded-md px-1.5 py-1 text-[11px] text-gray-500 transition-colors duration-150 hover:bg-gray-200/60 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
          >
            {expanded ? S.company.roadmaps.showFewer : S.company.roadmaps.showMore(more.length)}
          </button>
        )}
        <NavLink
          to={pagePath}
          onClick={() => onNavigate?.()}
          className="rounded-md px-1.5 py-1 text-[11px] text-gray-500 transition-colors duration-150 hover:bg-gray-200/60 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
        >
          {S.company.roadmaps.all}
        </NavLink>
      </div>
    </section>
  );
}
