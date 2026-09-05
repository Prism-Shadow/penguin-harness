/**
 * Company mode's channel list — the sidebar block that stands where development mode lists
 * conversations, and the collapsed rail's icon-only twin. The all-hands channel is pinned at
 * the top under its localized label, then the channels the person is in, then the ones it is
 * not (each with a Join action — people may join any channel), then the archived ones folded
 * away. A row carries its unread count and, when a message names the reader, an "@me" chip.
 *
 * "New channel" sits where "New chat" sits in development mode; the organization's desk and
 * ticket sessions follow the list as their own groups (org-session-groups.tsx).
 *
 * The list itself is the store's (state/company.tsx): one listing per organization, refreshed
 * when a message event says a counter moved, so the sidebar, the rail and the channel view
 * never disagree about what is unread.
 */
import { useState } from "react";
import { NavLink, useNavigate } from "react-router";
import type { OrgChannelItem } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { ICON_GAP, ICON_SIZE } from "../../lib/icon-scale";
import { toneInk, toneSurface } from "../../lib/tone";
import { useAuth } from "../../state/auth";
import { useCompany } from "../../state/company";
import { Button } from "../../components/ui/button";
import { FolderSection, Icon } from "../../components/ui/group-list";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { SkeletonList } from "../../components/ui/skeleton";
import { toastError, toastSuccess } from "../../components/ui/toast";
import { Truncated } from "../../components/ui/truncated";
import { orgChannelPath } from "./company-nav";
import { NewChannelDialog } from "./channel-dialogs";
import { channelLabel, groupChannels, isAllHands } from "./channel-list";

/** A channel (lucide hash): the mark every channel but the all-hands one wears. */
export const CHANNEL_ICON = "M4 9h16M4 15h16M10 3L8 21M16 3l-2 18";

/** The all-hands channel (lucide users): everyone in the organization is in it. */
export const ALL_HANDS_ICON =
  "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75";

/** New channel (lucide message-square-plus): the pinned button above the list. */
const NEW_CHANNEL_ICON =
  "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2zM12 7v6M9 10h6";

export const channelGlyph = (channelId: string): string =>
  isAllHands(channelId) ? ALL_HANDS_ICON : CHANNEL_ICON;

/** What a row's badges add to its name for a reader who cannot see them. */
function badgeNote(channel: OrgChannelItem): string | null {
  if (channel.mentionsMe > 0) return S.company.channels.badgeMentions(channel.mentionsMe);
  if (channel.unread > 0) return S.company.channels.badgeUnread(channel.unread);
  return null;
}

/**
 * The pinned "New channel" button, in the slot development mode gives "New chat". The rail
 * wears the same action as an icon button. Creating one opens it.
 */
export function NewChannelButton({
  projectId,
  orgId,
  rail = false,
  onNavigate,
}: {
  projectId: string;
  orgId: string;
  rail?: boolean;
  onNavigate?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const company = useCompany();
  const taken = (company.channels ?? []).map((c) => c.channelId);
  const label = S.company.channels.newChannel;
  return (
    <>
      {rail ? (
        <button
          type="button"
          title={label}
          aria-label={label}
          onClick={() => setOpen(true)}
          className="relative flex h-8 w-8 items-center justify-center rounded-md text-gray-500 transition-colors duration-150 hover:bg-gray-200/70 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
        >
          <GlyphIcon d={NEW_CHANNEL_ICON} size={18} />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={`flex w-full items-center ${ICON_GAP.menu} rounded-md px-2.5 py-1.5 text-sm font-medium text-gray-600 transition-colors duration-150 hover:bg-gray-200/50 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800/70 dark:hover:text-gray-200`}
        >
          <span className="text-gray-500 dark:text-gray-400">
            <Icon d={NEW_CHANNEL_ICON} />
          </span>
          {label}
        </button>
      )}
      <NewChannelDialog
        open={open}
        projectId={projectId}
        orgId={orgId}
        taken={taken}
        onClose={() => setOpen(false)}
        onCreated={(channel) => {
          setOpen(false);
          toastSuccess(S.company.channels.created);
          void company.reloadChannels();
          navigate(orgChannelPath(projectId, orgId, channel.channelId));
          onNavigate?.();
        }}
      />
    </>
  );
}

/** One row: the channel's glyph and label, its unread count, and the "@me" chip when a message names the reader. */
function ChannelRow({
  projectId,
  orgId,
  channel,
  onNavigate,
  join,
}: {
  projectId: string;
  orgId: string;
  channel: OrgChannelItem;
  onNavigate?: () => void;
  /** Rendered beside the row for a channel the person has not joined. */
  join?: () => void;
}) {
  const label = channelLabel(channel, S.company.channels.allHands);
  const note = badgeNote(channel);
  const unread = channel.unread > 0;
  return (
    <li className="group relative flex items-center rounded-md transition-colors duration-150 hover:bg-gray-200/50 dark:hover:bg-gray-800/70">
      <NavLink
        to={orgChannelPath(projectId, orgId, channel.channelId)}
        onClick={() => onNavigate?.()}
        title={channel.purpose !== "" ? `${label} · ${channel.purpose}` : label}
        aria-label={note !== null ? `${label} · ${note}` : label}
        className={({ isActive }) =>
          `flex min-w-0 flex-1 items-center ${ICON_GAP.row} rounded-md px-2.5 py-1.5 text-sm transition-colors duration-150 ${
            isActive
              ? "bg-gray-200/70 font-medium text-gray-900 dark:bg-gray-800 dark:text-gray-100"
              : unread
                ? "font-medium text-gray-900 dark:text-gray-100"
                : "text-gray-600 dark:text-gray-400"
          }`
        }
      >
        <span className="shrink-0 text-gray-400 dark:text-gray-500">
          <Icon d={channelGlyph(channel.channelId)} size={ICON_SIZE.rowLead} />
        </span>
        <Truncated text={label} className="min-w-0 flex-1" />
        {channel.mentionsMe > 0 && (
          <span
            className={`shrink-0 rounded px-1 text-[10px] font-semibold ${toneSurface.attention}`}
          >
            {S.company.channels.mentionChip}
          </span>
        )}
        {channel.unread > 0 && (
          <span className="shrink-0 text-[11px] tabular-nums text-gray-500 dark:text-gray-400">
            {channel.unread}
          </span>
        )}
      </NavLink>
      {join !== undefined && (
        /* Overlaid rather than laid out: reserving a slot would shorten the row's own fill
           and its label for a control that is invisible at rest. Pointer events follow the
           opacity, so a hidden button never takes a tap (the development list's rule). */
        <button
          type="button"
          onClick={join}
          className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 rounded bg-gray-200 px-1.5 py-0.5 text-[11px] text-gray-600 opacity-0 transition-opacity duration-150 hover:text-gray-900 focus:pointer-events-auto focus:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 dark:bg-gray-700 dark:text-gray-300 dark:hover:text-gray-100"
        >
          {S.company.channels.join}
        </button>
      )}
    </li>
  );
}

/** A run's title inside the list (My channels / Other channels), with how many it holds. */
function GroupTitle({ label, count }: { label: string; count: number }) {
  return (
    <p className="flex items-center gap-1.5 px-2.5 pb-0.5 pt-2.5 text-[11px] font-medium text-gray-500 dark:text-gray-400">
      <span className="min-w-0 truncate">{label}</span>
      <span className="tabular-nums text-gray-400 dark:text-gray-500">{count}</span>
    </p>
  );
}

export function ChannelSidebar({
  projectId,
  orgId,
  onNavigate,
}: {
  projectId: string;
  orgId: string;
  onNavigate?: () => void;
}) {
  const company = useCompany();
  const { user } = useAuth();
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [joining, setJoining] = useState<string | null>(null);
  const channels = company.channels;

  const join = async (channel: OrgChannelItem) => {
    if (joining !== null) return;
    setJoining(channel.channelId);
    try {
      await api.addOrgChannelMember(projectId, orgId, channel.channelId, {
        principal: `user:${user?.userId ?? ""}`,
      });
      toastSuccess(S.company.channels.joined);
      await company.reloadChannels();
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setJoining(null);
    }
  };

  const groups = groupChannels(channels ?? [], S.company.channels.allHands);
  const row = (channel: OrgChannelItem, joinable = false) => (
    <ChannelRow
      key={channel.channelId}
      projectId={projectId}
      orgId={orgId}
      channel={channel}
      {...(onNavigate ? { onNavigate } : {})}
      {...(joinable ? { join: () => void join(channel) } : {})}
    />
  );

  return (
    <>
      {/* The list's header, at the height and density of the development list's own. */}
      <div className="mt-3 flex items-center justify-between gap-2 px-1 pt-2">
        <span className="px-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
          {S.company.channels.listTitle}
        </span>
      </div>
      {channels === null ? (
        company.channelsError !== null ? (
          <div className="flex items-center justify-between gap-2 px-2.5 py-1">
            <span className={`text-xs ${toneInk.danger}`}>{S.company.channels.loadFailed}</span>
            <Button size="sm" onClick={() => void company.reloadChannels()}>
              {S.common.retry}
            </Button>
          </div>
        ) : (
          <SkeletonList rows={3} />
        )
      ) : (
        <>
          <ul className="space-y-0.5 pt-1">
            {groups.allHands !== null && row(groups.allHands)}
            {groups.mine.length > 0 && (
              <li>
                <GroupTitle label={S.company.channels.mine} count={groups.mine.length} />
              </li>
            )}
            {groups.mine.map((c) => row(c))}
            {groups.others.length > 0 && (
              <li>
                <GroupTitle label={S.company.channels.others} count={groups.others.length} />
              </li>
            )}
            {groups.others.map((c) => row(c, true))}
          </ul>
          {groups.archived.length > 0 && (
            <FolderSection
              label={`${S.company.channels.archivedGroup} (${groups.archived.length})`}
              open={archivedOpen}
              onToggle={() => setArchivedOpen((v) => !v)}
            >
              <ul className="space-y-0.5">{groups.archived.map((c) => row(c))}</ul>
            </FolderSection>
          )}
          {groups.allHands === null &&
            groups.mine.length === 0 &&
            groups.others.length === 0 &&
            groups.archived.length === 0 && (
              <p className="px-2.5 pt-2 text-xs text-gray-400 dark:text-gray-600">
                {S.company.channels.noChannels}
              </p>
            )}
        </>
      )}
    </>
  );
}

/** The collapsed rail's channels: the same rows as icons, each carrying its own count. */
export function ChannelRailRows({ projectId, orgId }: { projectId: string; orgId: string }) {
  const company = useCompany();
  const groups = groupChannels(company.channels ?? [], S.company.channels.allHands);
  const rows = [
    ...(groups.allHands !== null ? [groups.allHands] : []),
    ...groups.mine,
    ...groups.others,
  ];
  return (
    <>
      {rows.map((channel) => {
        const label = channelLabel(channel, S.company.channels.allHands);
        const note = badgeNote(channel);
        const name = note !== null ? `${label} · ${note}` : label;
        return (
          <NavLink
            key={channel.channelId}
            to={orgChannelPath(projectId, orgId, channel.channelId)}
            title={name}
            aria-label={name}
            className={({ isActive }) =>
              `relative flex h-8 w-8 items-center justify-center rounded-md transition-colors duration-150 ${
                isActive
                  ? "bg-gray-200/70 text-gray-900 dark:bg-gray-800 dark:text-gray-100"
                  : "text-gray-500 hover:bg-gray-200/70 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
              }`
            }
          >
            <GlyphIcon d={channelGlyph(channel.channelId)} size={18} />
            {channel.unread > 0 && (
              // The count itself, not a bare dot: the rail is the whole sidebar while
              // collapsed, and "something is waiting" without "how much" sends the reader
              // back to expanding it just to look.
              <span
                aria-hidden
                className={`absolute -right-0.5 -top-0.5 min-w-[14px] rounded-full px-1 text-[9px] font-semibold leading-[14px] tabular-nums ${
                  channel.mentionsMe > 0
                    ? toneSurface.attention
                    : "bg-gray-300 text-gray-800 dark:bg-gray-700 dark:text-gray-100"
                }`}
              >
                {channel.unread > 99 ? "99+" : channel.unread}
              </span>
            )}
          </NavLink>
        );
      })}
    </>
  );
}
