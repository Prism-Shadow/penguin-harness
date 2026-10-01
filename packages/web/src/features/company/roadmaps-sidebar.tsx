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
 * organization changes and again on every navigation. Each room is read with it — its last
 * message and the unread and "@me" counts a channel row carries — and every message event for
 * the room moves both, so a reply there lifts the roadmap at once and a message from someone
 * else lights its badge. Reading the room (the channel page's `markChannelRead`) clears the
 * badge by the store's own rule. A failed read says so in one line rather than hiding the
 * section.
 *
 * A row's context menu (right-click, press-and-hold, Shift+F10) copies the roadmap's ID — its
 * number, as `#n` — so the number stays off the row and is still at hand when it is wanted.
 */
import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router";
import {
  Dropdown,
  FOLDER_ROW_CLASS,
  FolderSection,
  ICONS,
  ICON_GAP,
  ICON_SIZE,
  MenuItem,
  PlusIcon,
  toastSuccess,
  useRowContextMenu,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import type { OrgRoadmapItem } from "../../api/endpoints";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import { Icon } from "../../components/ui/group-list";
import { NAV_ICONS } from "../../lib/nav-icons";
import { writeClipboard } from "../../lib/clipboard";
import { Truncated } from "../../components/ui/truncated";
import { useOrgPages } from "./use-org-pages";
import { useAuth } from "../../state/auth";
import { useCompany, useCompanyEvents } from "../../state/company";
import { badgeNote, RowBadges, type RowCounts } from "./channel-sidebar";
import { orgChannelPath, orgContributedPagePath } from "./company-nav";
import {
  isListedRoadmap,
  roadmapsPageSrc,
  roomAfterMessage,
  roomCounts,
  roomFromRead,
  sidebarRoadmaps,
  type RoomState,
} from "./roadmaps";

/**
 * The text "Copy roadmap ID" puts on the clipboard: the roadmap's number written `#n`, as the
 * room's column heads it ("Roadmap #3") and the plugin's page addresses it. Taken from the
 * number, never from the room's channel id: that is the channel's id, and it carries a suffix
 * (`roadmap_3_2`) when the plain one was taken.
 */
export function roadmapIdText(roadmap: { number: number }): string {
  return `#${roadmap.number}`;
}

/**
 * The row menu's one item. The panel closes under the click, so the copy is confirmed by a
 * toast rather than on the row — the session row menu's rule for "Copy Session ID".
 */
export function RoadmapRowMenuRows({
  roadmap,
  onCopy,
}: {
  roadmap: { number: number };
  onCopy: (text: string) => void;
}) {
  return (
    <MenuItem
      density="sm"
      glyph={ICONS.copy}
      label={S.company.roadmaps.copyId}
      onSelect={() => onCopy(roadmapIdText(roadmap))}
    />
  );
}

/**
 * One roadmap's row: its room read the way the channel list above reads a channel — the glyph,
 * the name, and the same trailing badges (the "@me" chip, the unread count) with the name in
 * bold while something is unread. The number is not shown; the room's own column heads with
 * it. No `title` either: the name is the row's text, and `Truncated` discloses it when it is
 * cut; the badges reach a screen reader through the link's accessible name, as on a channel.
 */
export function RoadmapRow({
  projectId,
  orgId,
  roadmap,
  counts = { unread: 0, mentionsMe: 0 },
  onNavigate,
}: {
  projectId: string;
  orgId: string;
  roadmap: OrgRoadmapItem & { channelId: string };
  counts?: RowCounts;
  onNavigate?: () => void;
}) {
  const note = badgeNote(counts);
  const unread = counts.unread > 0;
  const ctx = useRowContextMenu();
  /** The row's link: where focus goes back when the menu closes (the hook's default looks for a button). */
  const link = () => ctx.anchorOwner()?.querySelector<HTMLElement>("a") ?? null;
  const copy = (text: string) => {
    link()?.focus();
    ctx.close();
    void writeClipboard(text).then((ok) => ok && toastSuccess(S.common.copied));
  };
  return (
    <li
      ref={ctx.rowRef}
      // Right-click / Shift+F10 / press-and-hold open the row's menu; the native menu is
      // suppressed inside that handler only, so the rest of the app keeps the browser's own.
      {...ctx.rowProps}
      className="rounded-md transition-colors duration-150 hover:bg-gray-200/50 dark:hover:bg-gray-800/70"
    >
      <NavLink
        to={orgChannelPath(projectId, orgId, roadmap.channelId)}
        onClick={(e) => {
          // A press-and-hold that opened the menu must not also open the room: touch screens
          // replay the held press as a click once the finger lifts.
          if (ctx.consumeLongPressClick()) {
            e.preventDefault();
            return;
          }
          onNavigate?.();
        }}
        {...(note !== null ? { "aria-label": `${roadmap.name} · ${note}` } : {})}
        className={({ isActive }) =>
          `flex min-w-0 items-center ${ICON_GAP.row} rounded-md px-2.5 py-1.5 text-sm transition-colors duration-150 ${
            isActive
              ? "bg-gray-200/70 font-medium text-gray-900 dark:bg-gray-800 dark:text-gray-100"
              : unread
                ? "font-medium text-gray-900 dark:text-gray-100"
                : "text-gray-600 dark:text-gray-400"
          }`
        }
      >
        <span className="shrink-0 text-gray-400 dark:text-gray-500">
          <Icon d={NAV_ICONS.orgRoadmaps} size={ICON_SIZE.rowLead} />
        </span>
        <Truncated text={roadmap.name} className="min-w-0 flex-1" />
        <RowBadges unread={counts.unread} mentionsMe={counts.mentionsMe} />
      </NavLink>
      {/* `contents` keeps this wrapper out of the row's layout; the panel is portaled against
          the point the gesture landed on. */}
      <Dropdown
        open={ctx.open}
        setOpen={ctx.setOpen}
        portal={{ direction: "down", align: "left" }}
        anchorRect={ctx.anchor}
        anchorOwner={ctx.anchorOwner}
        returnFocus={link}
        className="contents"
        menuClass="w-40"
        button={null}
      >
        <RoadmapRowMenuRows roadmap={roadmap} onCopy={copy} />
      </Dropdown>
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
  const { user } = useAuth();
  const { channelReadAt } = useCompany();
  /** Each room's last message and counters, by channel id: read with the list, then moved by message events. */
  const [rooms, setRooms] = useState<Record<string, RoomState>>({});

  useEffect(() => {
    setRoadmaps(null);
    setMoreOpen(false);
    setRooms({});
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
        // Rooms are unlisted channels, so the channel listing carries neither their last message
        // nor their counters; each room is read on its own. A room that cannot be read keeps
        // its ledger order and shows no badge.
        for (const r of res.roadmaps) {
          if (!isListedRoadmap(r)) continue;
          const startedAt = Date.now();
          api
            .getOrgChannel(projectId, orgId, r.channelId)
            .then((ch) => {
              if (!live) return;
              setRooms((prev) => ({
                ...prev,
                [r.channelId]: roomFromRead(prev[r.channelId], ch, startedAt),
              }));
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

  // A message in a room moves its roadmap up at once and counts toward its badge, as a message
  // in a listed channel does for the channel's row — without waiting for the next navigation.
  useCompanyEvents((ev) => {
    if (ev.type !== "org_channel" || ev.projectId !== projectId || ev.orgId !== orgId) return;
    const now = Date.now();
    setRooms((prev) => ({
      ...prev,
      [ev.channelId]: roomAfterMessage(
        prev[ev.channelId],
        ev.message,
        `user:${user?.userId ?? ""}`,
        channelReadAt.get(ev.channelId),
        now,
      ),
    }));
  });

  if (!enabled) return null;
  const activity: Record<string, string> = {};
  for (const [id, room] of Object.entries(rooms)) {
    if (room.lastMessageAt !== null) activity[id] = room.lastMessageAt;
  }
  const { shown, more } = sidebarRoadmaps(roadmaps ?? [], activity);
  const pagePath = orgContributedPagePath(projectId, orgId, "roadmaps");
  const row = (r: OrgRoadmapItem & { channelId: string }) => (
    <RoadmapRow
      key={r.number}
      projectId={projectId}
      orgId={orgId}
      roadmap={r}
      counts={roomCounts(rooms[r.channelId], channelReadAt.get(r.channelId))}
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
