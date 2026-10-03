/**
 * Roadmaps in the company layout (pure, unit tested). The company-roadmaps plugin serves its own
 * page; what the app itself does with roadmaps is two things, both keyed off that page being
 * contributed (key `roadmaps`, an iframe page — the same contribution the org nav used to draw a
 * row for):
 *
 * - the sidebar's ROADMAPS section, below the channel list and apart from it: the most recently
 *   active roadmaps with a room, five at rest, the rest folded under "More (n)", each row
 *   carrying its room's unread count and "@me" chip as a channel row does;
 * - a roadmap's room is its channel, shown by the app's own channel page, and that page puts the
 *   roadmap in a column beside the stream, drawn by the app from the plugin's answer for that
 *   roadmap (roadmap-detail.tsx; the rows it lists are {@link roadmapRows}).
 */
import type { OrgRoadmapApproval, OrgRoadmapDetail, OrgRoadmapItem } from "../../api/endpoints";

/** The contributed page's key the app knows as the roadmaps page. */
export const ROADMAPS_PAGE_KEY = "roadmaps";

/** How many roadmaps the sidebar section shows before its expand. */
export const ROADMAPS_SHOWN = 5;

/** The roadmaps page's iframe src when it is contributed; null when the plugin is not there. */
export function roadmapsPageSrc(
  pages: ReadonlyArray<{
    key: string;
    nav: string;
    renderer: { builtin: string } | { iframe: { src: string } };
  }>,
): string | null {
  for (const page of pages) {
    if (page.key !== ROADMAPS_PAGE_KEY || page.nav !== "org") continue;
    if ("iframe" in page.renderer) return page.renderer.iframe.src;
  }
  return null;
}

/**
 * Where an item stands, as its row says it: `draft` while the roadmap is still discussed,
 * `brief` once established but still waiting for its two approvals (a proposal item), and
 * `delegated` once it went out — its proposal linked, or its roadmap derived, or on the way.
 */
export type RoadmapRowStage = "draft" | "brief" | "delegated";

/** One row of the room's column: an item of the roadmap, with what became of it. */
export interface RoadmapRow {
  key: string;
  kind: "proposal" | "roadmap";
  title: string;
  brief: string;
  /** Who the row names, as principals (`agent:<id>`): a proposal item's owner, a roadmap item's employees. */
  people: string[];
  /** The proposal of a proposal item: the one linked back, or the existing one it took in. */
  proposal: number | null;
  /** The roadmap a roadmap item derived, when there is one. */
  child: number | null;
  stage: RoadmapRowStage;
  /** A brief's two approvals (null where the row is not a brief). */
  approvals: { person: OrgRoadmapApproval | null; moderator: OrgRoadmapApproval | null } | null;
}

/**
 * The column's rows: every item of the roadmap, the proposal items first and the roadmap items
 * after them, each in the draft's own order.
 */
export function roadmapRows(r: OrgRoadmapDetail): RoadmapRow[] {
  const established = r.status === "established";
  const rows = r.items.map((item): RoadmapRow => {
    const d = r.delegations[item.key];
    const stage: RoadmapRowStage = !established
      ? "draft"
      : d !== undefined && d.stage === "brief"
        ? "brief"
        : "delegated";
    return {
      key: item.key,
      kind: item.kind,
      title: item.title,
      brief: item.brief,
      people: (item.kind === "proposal" ? [item.owner] : item.employees).map((id) => `agent:${id}`),
      proposal: item.kind === "proposal" ? (d?.proposal ?? item.proposal ?? null) : null,
      child: item.kind === "roadmap" && d !== undefined ? d.child : null,
      stage,
      approvals:
        stage === "brief"
          ? { person: d?.approvals?.person ?? null, moderator: d?.approvals?.moderator ?? null }
          : null,
    };
  });
  return [
    ...rows.filter((x) => x.kind === "proposal"),
    ...rows.filter((x) => x.kind === "roadmap"),
  ];
}

/** A person may add their approval to a brief that does not have it yet. */
export function personMayApprove(row: RoadmapRow): boolean {
  return row.stage === "brief" && row.approvals !== null && row.approvals.person === null;
}

/**
 * When a roadmap last moved: the latest of when it was opened, its ledger events and the last
 * message in its room (`roomAt`, when known) — a reply in the room is activity too.
 */
export function lastActivity(r: OrgRoadmapItem, roomAt?: string | null): string {
  let latest = r.createdAt;
  for (const e of r.events ?? []) if (e.at > latest) latest = e.at;
  if (roomAt != null && roomAt > latest) latest = roomAt;
  return latest;
}

/**
 * What the sidebar knows of a roadmap's room, the way it knows a listed channel: the last
 * message, and the unread count and "@me" count a channel row carries. Rooms are unlisted, so
 * the channel listing and the store's counters never hold them; the sidebar reads each room on
 * its own and moves the counts with the message events.
 *
 * `countedAt` is when the counts were taken (the read's start, or the event's arrival). The
 * store's rule for channel rows carries over: a channel marked read at or after that moment
 * shows no badge — the server's read cursor may lag the reader, and a badge that comes back
 * after the room was read looks like a bug.
 */
export interface RoomState {
  lastMessageAt: string | null;
  unread: number;
  mentionsMe: number;
  isMember: boolean;
  countedAt: number;
}

/**
 * A room after its detail read, started at `startedAt`, answered: the later last message of the
 * two wins; the read's counts win unless a message event counted after the read went out, in
 * which case the event's counts are the newer ones and stay.
 */
export function roomFromRead(
  prev: RoomState | undefined,
  read: { lastMessageAt: string | null; unread: number; mentionsMe: number; isMember: boolean },
  startedAt: number,
): RoomState {
  const lastMessageAt =
    prev?.lastMessageAt != null &&
    (read.lastMessageAt === null || prev.lastMessageAt > read.lastMessageAt)
      ? prev.lastMessageAt
      : read.lastMessageAt;
  if (prev !== undefined && prev.countedAt > startedAt && prev.isMember) {
    return { ...prev, lastMessageAt, isMember: read.isMember };
  }
  return {
    lastMessageAt,
    unread: read.unread,
    mentionsMe: read.mentionsMe,
    isMember: read.isMember,
    countedAt: startedAt,
  };
}

/** The counts a room's row shows now: zero when the room was marked read since they were taken. */
export function roomCounts(
  room: RoomState | undefined,
  readAt: number | undefined,
): { unread: number; mentionsMe: number } {
  if (room === undefined || (readAt ?? 0) >= room.countedAt) return { unread: 0, mentionsMe: 0 };
  return { unread: room.unread, mentionsMe: room.mentionsMe };
}

/**
 * A room after a new message: its last message moves, and — as the store counts a channel —
 * a message from someone else in a room the reader belongs to adds one unread, and one "@me"
 * when it names the reader. A room not read yet takes the message's time (so it still rises)
 * but no counts: its read brings them, and a guess before it could only be wrong.
 */
export function roomAfterMessage(
  room: RoomState | undefined,
  message: { time: string; sender: string; mentions: readonly string[] },
  me: string,
  readAt: number | undefined,
  now: number,
): RoomState {
  if (room === undefined) {
    return {
      lastMessageAt: message.time,
      unread: 0,
      mentionsMe: 0,
      isMember: false,
      countedAt: now,
    };
  }
  const lastMessageAt =
    room.lastMessageAt !== null && room.lastMessageAt >= message.time
      ? room.lastMessageAt
      : message.time;
  if (!room.isMember || message.sender === me) return { ...room, lastMessageAt };
  const base = roomCounts(room, readAt);
  return {
    ...room,
    lastMessageAt,
    unread: base.unread + 1,
    mentionsMe: base.mentionsMe + (message.mentions.includes(me) ? 1 : 0),
    countedAt: now,
  };
}

/**
 * Listed in the sidebar: a roadmap with a room to go to that is not shelved — under discussion
 * or established alike, since an established roadmap's room is still where it is talked about.
 */
export function isListedRoadmap(r: OrgRoadmapItem): r is OrgRoadmapItem & { channelId: string } {
  return !r.archived && r.channelId !== null;
}

/**
 * The sidebar section's rows: the listed roadmaps, most recently active first (ties: the higher
 * number first), split into the first {@link ROADMAPS_SHOWN} and the rest. `roomActivity` maps a
 * room's channel id to its last message's time.
 */
export function sidebarRoadmaps(
  roadmaps: readonly OrgRoadmapItem[],
  roomActivity: Readonly<Record<string, string>> = {},
): {
  shown: Array<OrgRoadmapItem & { channelId: string }>;
  more: Array<OrgRoadmapItem & { channelId: string }>;
} {
  const active = roadmaps
    .filter(isListedRoadmap)
    .map((r) => ({ r, at: lastActivity(r, roomActivity[r.channelId]) }))
    .sort((a, b) => (a.at === b.at ? b.r.number - a.r.number : a.at < b.at ? 1 : -1))
    .map((x) => x.r);
  return { shown: active.slice(0, ROADMAPS_SHOWN), more: active.slice(ROADMAPS_SHOWN) };
}
