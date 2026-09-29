/**
 * The sidebar's ROADMAPS section: its own header below the channel list (apart from "My
 * channels", since a roadmap's room is a channel the channel list leaves out), the most recently
 * active roadmaps with a room — under discussion or established, five at rest, the rest folded
 * under "> More (n)" the way the channel list folds "> Archived (n)" — and "All roadmaps" at the
 * end, which opens the plugin's own page (every roadmap, shelved ones too). A row opens the
 * roadmap's room: the app's channel page, which shows the roadmap beside the stream
 * (roadmap-panel.tsx). The header's "+" opens the plugin's page with its "Open a roadmap" dialog
 * already up.
 *
 * Drawn only while the company-roadmaps plugin contributes its page. The list is read when the
 * organization changes and again on every navigation; how recently a roadmap moved counts its
 * room's last message, read with the list and moved by every message event for the room, so a
 * reply there lifts the roadmap at once. A failed read says so in one line rather than hiding
 * the section.
 */
import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router";
import {
  FOLDER_ROW_CLASS,
  FolderSection,
  ICON_GAP,
  ICON_SIZE,
  PlusIcon,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import type { OrgRoadmapItem } from "../../api/endpoints";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import { Icon } from "../../components/ui/group-list";
import { NAV_ICONS } from "../../lib/nav-icons";
import { Truncated } from "../../components/ui/truncated";
import { useOrgPages } from "./use-org-pages";
import { useCompanyEvents } from "../../state/company";
import { orgChannelPath, orgContributedPagePath } from "./company-nav";
import { isListedRoadmap, roadmapsPageSrc, sidebarRoadmaps } from "./roadmaps";

/**
 * One roadmap's row: its room read the way the channel list above reads a channel — the glyph
 * and the name, nothing trailing. The number is not shown; the room's own column heads with it.
 * No `title` either: the name is the row's text, and `Truncated` discloses it when it is cut.
 */
export function RoadmapRow({
  projectId,
  orgId,
  roadmap,
  onNavigate,
}: {
  projectId: string;
  orgId: string;
  roadmap: OrgRoadmapItem & { channelId: string };
  onNavigate?: () => void;
}) {
  return (
    <li className="rounded-md transition-colors duration-150 hover:bg-gray-200/50 dark:hover:bg-gray-800/70">
      <NavLink
        to={orgChannelPath(projectId, orgId, roadmap.channelId)}
        onClick={() => onNavigate?.()}
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
        <Truncated text={roadmap.name} className="min-w-0 flex-1" />
      </NavLink>
    </li>
  );
}

export function RoadmapsSidebar({
  projectId,
  orgId,
  onNavigate,
}: {
  projectId: string;
  orgId: string;
  onNavigate?: () => void;
}) {
  const pages = useOrgPages();
  const enabled = roadmapsPageSrc(pages) !== null;
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [roadmaps, setRoadmaps] = useState<OrgRoadmapItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  /** A room's last message time, by channel id: read with the list, then moved by message events. */
  const [roomAt, setRoomAt] = useState<Record<string, string>>({});
  /** Keeps the later of what is known and `at` for a room. */
  const bumpRoom = (channelId: string, at: string) =>
    setRoomAt((prev) =>
      prev[channelId] !== undefined && prev[channelId] >= at ? prev : { ...prev, [channelId]: at },
    );

  useEffect(() => {
    setRoadmaps(null);
    setMoreOpen(false);
    setRoomAt({});
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
        // Rooms are unlisted channels, so the channel listing does not carry their last message;
        // each room is read on its own. A room that cannot be read keeps its ledger order.
        for (const r of res.roadmaps) {
          if (!isListedRoadmap(r)) continue;
          api
            .getOrgChannel(projectId, orgId, r.channelId)
            .then((ch) => {
              if (live && ch.lastMessageAt !== null) bumpRoom(r.channelId, ch.lastMessageAt);
            })
            .catch(() => {});
        }
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [enabled, projectId, orgId, pathname]);

  // A reply in a room moves its roadmap up at once, without waiting for the next navigation.
  useCompanyEvents((ev) => {
    if (ev.type === "org_channel" && ev.projectId === projectId && ev.orgId === orgId) {
      bumpRoom(ev.channelId, ev.message.time);
    }
  });

  if (!enabled) return null;
  const { shown, more } = sidebarRoadmaps(roadmaps ?? [], roomAt);
  const pagePath = orgContributedPagePath(projectId, orgId, "roadmaps");
  const row = (r: OrgRoadmapItem & { channelId: string }) => (
    <RoadmapRow
      key={r.number}
      projectId={projectId}
      orgId={orgId}
      roadmap={r}
      {...(onNavigate ? { onNavigate } : {})}
    />
  );

  return (
    <section aria-label={S.company.roadmaps.listTitle}>
      <div className="mt-3 flex items-center justify-between gap-2 px-1 pt-2">
        <span className="px-1 text-xs font-semibold text-gray-400 dark:text-gray-500">
          {S.company.roadmaps.listTitle}
        </span>
        <button
          type="button"
          data-tooltip={S.company.roadmaps.open}
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
        <ul className="space-y-1 pt-1">{shown.map(row)}</ul>
      )}
      {/* The rest fold the way the channel list folds its archived channels: "> More (n)". */}
      {more.length > 0 && (
        <FolderSection
          label={`${S.company.roadmaps.moreGroup} (${more.length})`}
          open={moreOpen}
          onToggle={() => setMoreOpen((v) => !v)}
        >
          <ul className="space-y-1">{more.map(row)}</ul>
        </FolderSection>
      )}
      {/* A row in the fold rows' own shape, the spacer standing where their chevron is. */}
      <NavLink to={pagePath} onClick={() => onNavigate?.()} className={`mt-1 ${FOLDER_ROW_CLASS}`}>
        <span className="w-3" aria-hidden />
        {S.company.roadmaps.all}
      </NavLink>
    </section>
  );
}
