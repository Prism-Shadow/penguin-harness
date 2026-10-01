/**
 * The app's side of the grouped Session list: the grouping modes and their glyphs, the stored
 * grouping preference, what the header's "new" button creates in each mode, the list's line
 * icon, and the group pager in the sidebar's words. The rows themselves — the group header, the
 * lazy folder, the "more" row and the pager — are the shared UI package's.
 */
import { GlyphIcon, ICONS, ICON_SIZE, Pager } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import type { SessionSortMode } from "../../lib/session-order";

/** The grouped lists' line icon: GlyphIcon at the nav-row rung, which is what these rows are. */
export function Icon({ d, size = ICON_SIZE.navRow }: { d: string; size?: number }) {
  return <GlyphIcon d={d} size={size} />;
}

/** Grouping mode of a Session list (persisted; Workspace is the default). */
export type GroupMode = "workspace" | "agent" | "time";

/**
 * Leading glyph per grouping mode — the one place these are chosen, read by both the
 * two-icon toggle below and the sidebar's list-options menu, so a row and its toggle can
 * never end up wearing different icons for the same mode. Each glyph names the thing the
 * list is grouped *into*: a folder for Workspaces, the agent glyph for Agents. Time uses the
 * calendar, deliberately not the clock: that glyph already names the recency SORT one section
 * below in the same menu, and two rows wearing one mark would read as one setting.
 */
export const GROUP_MODE_ICONS: Record<GroupMode, string> = {
  workspace: ICONS.folder,
  agent: ICONS.robot,
  time: ICONS.calendar,
};

/**
 * Leading glyph per sort mode, distinguishing what actually decides the order rather than
 * decorating the rows: a clock for recency, and the opposed arrows of the drag that
 * produces a manual order.
 */
export const SORT_MODE_ICONS: Record<SessionSortMode, string> = {
  recent: ICONS.clock,
  manual: ICONS.arrowUpDown,
};

/**
 * One storage key for every grouped-list surface (sidebar + Trace page): the grouping
 * choice is a single user preference, not a per-page one — switching it anywhere
 * switches it everywhere.
 */
const GROUP_MODE_KEY = "penguin.sidebarGroupMode";

export function initialGroupMode(): GroupMode {
  const stored = localStorage.getItem(GROUP_MODE_KEY);
  return stored === "agent" || stored === "time" ? stored : "workspace";
}

/**
 * Entity the sidebar's "new" header button creates, decided by the grouping mode (the
 * created object follows what the list is grouped by): agent mode → an Agent (the
 * Agents page's existing create dialog), workspace mode → a Workspace (a new-chat
 * draft — there is no Workspace entity on the server; a Workspace comes into being
 * with the conversation created in it, chosen or auto-created on the draft card).
 * Time mode groups into buckets nothing can be created in, so its button falls back to
 * the plain new conversation — the one object every mode's list is made of.
 */
export function newEntityForGroupMode(mode: GroupMode): "agent" | "workspace" | "chat" {
  if (mode === "agent") return "agent";
  return mode === "time" ? "chat" : "workspace";
}

export function storeGroupMode(mode: GroupMode): void {
  localStorage.setItem(GROUP_MODE_KEY, mode);
}

/**
 * The pager under the sidebar's grouped list (it renders at most SIDEBAR_GROUP_PAGE_SIZE groups
 * per page): the package's compact `Pager`, in words that say it steps through groups rather than
 * pages of rows. Rendered only by callers that already know there is more than one page.
 */
export function GroupPager({
  page,
  pageCount,
  onChange,
}: {
  page: number;
  pageCount: number;
  onChange: (page: number) => void;
}) {
  return (
    <Pager
      page={page}
      pageCount={pageCount}
      onChange={onChange}
      previousLabel={S.chat.prevGroupPage}
      nextLabel={S.chat.nextGroupPage}
      readoutLabel={S.chat.groupPagePosition(page + 1, pageCount)}
      className="mt-1"
    />
  );
}
