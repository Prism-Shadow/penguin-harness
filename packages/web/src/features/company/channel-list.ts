/**
 * Channels as the sidebar and the dialogs need them (pure, unit tested): the all-hands
 * channel pinned above the channels the caller is in, the channels it is not in and the
 * archived ones folded away; the id a new channel may take; who is left to invite; and the
 * two numbers the sidebar's and the rail's badges sum.
 *
 * The all-hands channel is `default_channel` — created with the organization, holding every
 * employee and every Project member implicitly. Its stored name is never displayed: the list,
 * the header and every reference to it render the localized 全员频道 / "All hands" label
 * instead, so one organization reads the same in both languages whatever its files say.
 */
import type { OrgChannelItem, OrgChannelMember } from "@prismshadow/penguin-server/api";

/** The all-hands channel's id; reserved, so no other channel may take it. */
export const DEFAULT_CHANNEL_ID = "default_channel";

/** Channel ids follow the semantic-id rule the organization ids use (mirrors the server's isChannelId). */
export const CHANNEL_ID_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;

/** Whether a channel is the all-hands one — membership implicit, never archived, never left. */
export function isAllHands(channelId: string): boolean {
  return channelId === DEFAULT_CHANNEL_ID;
}

/** What a channel is called on screen: the localized label for the all-hands channel, the stored name for the rest. */
export function channelLabel(
  channel: { channelId: string; name: string },
  allHandsLabel: string,
): string {
  return isAllHands(channel.channelId) ? allHandsLabel : channel.name;
}

/** Why an id the user typed cannot be created; null when it can. */
export type ChannelIdProblem = "required" | "invalid" | "reserved" | "taken";

/**
 * The new-channel dialog's check, run before the request so the failure lands under the
 * field: the grammar the server enforces, `default_channel` refused because the all-hands
 * channel owns it, and an id the listing already holds refused before it collides.
 */
export function channelIdProblem(
  raw: string,
  taken: Iterable<string> = [],
): ChannelIdProblem | null {
  const id = raw.trim();
  if (id === "") return "required";
  if (!CHANNEL_ID_PATTERN.test(id)) return "invalid";
  if (isAllHands(id)) return "reserved";
  for (const other of taken) if (other === id) return "taken";
  return null;
}

/** The four runs of the channel list, in rendered order. */
export interface ChannelGroups {
  /** The all-hands channel, pinned above everything; null only while an organization's files are being repaired. */
  allHands: OrgChannelItem | null;
  /** Channels the caller is in. */
  mine: OrgChannelItem[];
  /** Channels the caller is not in — a person may join any of them. */
  others: OrgChannelItem[];
  /** Archived channels, whether or not the caller is in them: read-only, folded away. */
  archived: OrgChannelItem[];
}

/** By display name, then by id so two channels sharing a name keep a stable order. */
function byName(allHandsLabel: string) {
  return (a: OrgChannelItem, b: OrgChannelItem): number =>
    channelLabel(a, allHandsLabel).localeCompare(channelLabel(b, allHandsLabel)) ||
    a.channelId.localeCompare(b.channelId);
}

/**
 * The listing split into the list's runs. Archived wins over membership — an archived
 * channel is a record, not a place to work — and the all-hands channel is pinned out of
 * every run, since it cannot be archived and everyone is in it.
 */
export function groupChannels(
  channels: readonly OrgChannelItem[],
  allHandsLabel = "",
): ChannelGroups {
  const groups: ChannelGroups = { allHands: null, mine: [], others: [], archived: [] };
  for (const channel of channels) {
    if (isAllHands(channel.channelId)) groups.allHands = channel;
    else if (channel.archived) groups.archived.push(channel);
    else if (channel.isMember) groups.mine.push(channel);
    else groups.others.push(channel);
  }
  const order = byName(allHandsLabel);
  groups.mine.sort(order);
  groups.others.sort(order);
  groups.archived.sort(order);
  return groups;
}

/**
 * What the summary badges count: unread and @me summed over the channels the caller belongs
 * to — the ones it can be reached in. A channel it merely reads (people see every channel)
 * is waiting for nobody, and an archived one is a record rather than a place to work: both
 * are left out, so the total never claims something the list has folded away.
 */
export function channelBadgeCounts(channels: readonly OrgChannelItem[]): {
  unread: number;
  mentions: number;
} {
  let unread = 0;
  let mentions = 0;
  for (const channel of channels) {
    if (!channel.isMember || channel.archived) continue;
    unread += channel.unread;
    mentions += channel.mentionsMe;
  }
  return { unread, mentions };
}

/** One row of the invite picker: a principal that could be added to the channel. */
export interface InviteCandidate {
  /** `agent:<id>` (an employee) or `user:<id>` (a Project member). */
  principal: string;
  /** The employee's name, or the member's user id. */
  name: string;
  kind: "agent" | "user";
  /** Secondary text beside the name: an employee's title. */
  detail?: string;
}

/**
 * Who is left to invite: the organization's employees, then the Project's members, minus
 * whoever is already in the channel, ranked against what was typed — a name or id that
 * starts with the query above one that merely contains it, ties in list order.
 */
export function inviteCandidates(
  employees: ReadonlyArray<{ agentId: string; name: string; title?: string }>,
  memberUserIds: readonly string[],
  current: ReadonlyArray<OrgChannelMember | { principal: string }>,
  query = "",
): InviteCandidate[] {
  const taken = new Set(current.map((m) => m.principal));
  const list: InviteCandidate[] = [];
  for (const e of employees) {
    const principal = `agent:${e.agentId}`;
    if (taken.has(principal)) continue;
    const detail = e.title?.trim() ?? "";
    list.push({ principal, name: e.name, kind: "agent", ...(detail !== "" ? { detail } : {}) });
  }
  for (const userId of memberUserIds) {
    const principal = `user:${userId}`;
    if (taken.has(principal)) continue;
    list.push({ principal, name: userId, kind: "user" });
  }
  const q = query.trim().toLowerCase();
  if (q === "") return list;
  const scored: Array<{ c: InviteCandidate; score: number; i: number }> = [];
  list.forEach((c, i) => {
    const id = c.principal.slice(c.principal.indexOf(":") + 1).toLowerCase();
    const name = c.name.toLowerCase();
    const score =
      id.startsWith(q) || name.startsWith(q) ? 0 : id.includes(q) || name.includes(q) ? 1 : -1;
    if (score >= 0) scored.push({ c, score, i });
  });
  return scored.sort((a, b) => a.score - b.score || a.i - b.i).map((s) => s.c);
}
