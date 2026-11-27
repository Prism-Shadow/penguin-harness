/**
 * A channel's stream shaping (pure, unit tested): the loaded day files in
 * order become one list of items — a separator per day, the unread divider at the read
 * cursor, `system` messages on their own, and consecutive messages by one sender folded
 * into a run under a single header — plus which side of the stream a run sits on and where
 * each of its bubbles falls inside it, the day arithmetic the separators and the two paging
 * decisions need (how far the opening load walks back, and which day "earlier" fetches), the
 * immutable append a live message goes through, and when a join made on another surface
 * obliges the view to re-read its own detail.
 */
import type { OrgChannelMessage } from "@prismshadow/penguin-server/api";
import { parsePrincipal } from "./principals";

/** One day file as loaded: the organization-timezone date and its messages in file order. */
export interface ChannelDay {
  date: string;
  messages: OrgChannelMessage[];
}

export type StreamItem =
  | { kind: "day"; date: string }
  | { kind: "unread" }
  | { kind: "system"; message: OrgChannelMessage }
  | { kind: "run"; sender: string; hop: number; messages: OrgChannelMessage[] };

/** Messages by one sender closer together than this join one run (the same idiom as any chat client). */
export const RUN_GAP_MS = 5 * 60_000;

/**
 * Whether a run's header shows its hop count. Hop 1 is the ordinary case — an employee
 * answering a trigger — and a chip on every single answer says nothing; from the second hop
 * the message is an agent answering an agent, which is the thing worth seeing.
 */
export function hopChipShown(hop: number): boolean {
  return hop >= 2;
}

/**
 * Whether a run is the reader's own, which is what puts it on the right of the stream with
 * neither an avatar nor a name. Only a `user:` principal can be: an employee writes as
 * `agent:`, and a reader whose id is not known yet (`me` is "" until the session loads) owns
 * nothing rather than owning every unnamed message.
 */
export function isOwnRun(sender: string, me: string): boolean {
  if (me === "") return false;
  const p = parsePrincipal(sender);
  return p.kind === "user" && p.id === me;
}

/** Where one bubble of a run sits: which side of the stream, and its place inside the run. */
export interface BubbleShape {
  /** The reader's own message: the right-hand side, without an avatar or a name above it. */
  own: boolean;
  /** First of the run — the bubble under the header the sender's name and avatar share. */
  first: boolean;
  /** Last of the run — the run's tail, the bubble whose corner nearest its side is squared. */
  last: boolean;
}

/**
 * How the bubble at `index` of a run is drawn. A run of one message is both its first and its
 * last bubble, so it sits under the name and carries the squared corner at once.
 */
export function bubbleShape(
  run: { sender: string; messages: readonly OrgChannelMessage[] },
  index: number,
  me: string,
): BubbleShape {
  return {
    own: isOwnRun(run.sender, me),
    first: index === 0,
    last: index === run.messages.length - 1,
  };
}

/**
 * The stream in display order. The unread divider goes before the first message whose id
 * sorts after the read cursor (ids sort in write order, which is how the server counts
 * unread), and it breaks a run: the messages either side of it must not share a header. No
 * cursor means the reader has never marked anything — every message is technically unread,
 * and a divider above the whole history would say nothing, so none is drawn.
 */
export function buildStream(
  days: readonly ChannelDay[],
  opts: { unreadAfterId?: string | null; gapMs?: number } = {},
): StreamItem[] {
  const gap = opts.gapMs ?? RUN_GAP_MS;
  const cursor = opts.unreadAfterId ?? null;
  const out: StreamItem[] = [];
  let divided = false;
  for (const day of days) {
    out.push({ kind: "day", date: day.date });
    for (const m of day.messages) {
      if (cursor !== null && !divided && m.id > cursor) {
        out.push({ kind: "unread" });
        divided = true;
      }
      if (parsePrincipal(m.sender).kind === "system") {
        out.push({ kind: "system", message: m });
        continue;
      }
      const last = out[out.length - 1];
      if (
        last !== undefined &&
        last.kind === "run" &&
        last.sender === m.sender &&
        last.hop === m.hop &&
        Date.parse(m.time) - Date.parse(last.messages[last.messages.length - 1]!.time) <= gap
      ) {
        last.messages.push(m);
        continue;
      }
      out.push({ kind: "run", sender: m.sender, hop: m.hop, messages: [m] });
    }
  }
  return out;
}

const pad2 = (n: number): string => (n < 10 ? `0${n}` : `${n}`);

/** `yyyy-mm-dd` shifted by whole days; null for anything not of that shape. */
export function shiftDate(date: string, deltaDays: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + deltaDays));
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** How a day separator names its day, relative to the organization's today. */
export function dayKind(date: string, today: string): "today" | "yesterday" | "other" {
  if (date === today) return "today";
  if (shiftDate(today, -1) === date) return "yesterday";
  return "other";
}

/**
 * The day file to load next when paging back: the newest day older than the earliest one
 * loaded, from the server's newest-first list; null at the start of history.
 */
export function earlierDay(days: readonly string[], earliest: string): string | null {
  return days.find((d) => d < earliest) ?? null;
}

/** How many messages the opening load tries to have in hand before it stops walking back. */
export const INITIAL_MESSAGES = 30;

/** How many day files that walk may hold in total, today's included — its bound on requests. */
export const INITIAL_DAYS_MAX = 7;

/**
 * The day file the opening load fetches next, or null when it has what it needs: enough
 * messages, the day budget spent, or no history left. A channel is served one day file at a
 * time, and today's may well be empty — without this walk a channel opened on a quiet day
 * shows a blank stream with its whole history hidden behind the "earlier" button.
 *
 * `loaded` is what the load holds so far, oldest day first; `days` is the server's
 * newest-first list of the day files that exist. Only today's file can come back empty (a day
 * file is written when a message lands), so each further step adds at least one message and
 * the walk always terminates.
 */
export function initialDaysToLoad(
  days: readonly string[],
  today: string,
  loaded: readonly ChannelDay[],
  want: number = INITIAL_MESSAGES,
): string | null {
  if (messageCount(loaded) >= want) return null;
  if (loaded.length >= INITIAL_DAYS_MAX) return null;
  return earlierDay(days, loaded[0]?.date ?? today);
}

/**
 * Whether the view has to re-read its channel detail because the reader joined from somewhere
 * else. The sidebar's own Join posts and then reloads the LISTING; the detail behind the
 * composer is not part of that, so the view would keep offering Join until a re-navigation.
 *
 * Only the moment the listing flips to "member" counts. A listing that has said so all along
 * while the detail disagrees is the server's own answer, and re-reading on every render would
 * turn that disagreement into a refetch loop.
 */
export function joinedElsewhere(
  previous: boolean | null,
  listed: boolean | null,
  detailIsMember: boolean,
): boolean {
  return previous === false && listed === true && !detailIsMember;
}

/**
 * A message appended to its day (created at the end when that day is not loaded yet) — a
 * new array, or the same one back when the id is already present, so a live event that
 * repeats a message the send already added changes nothing.
 */
export function appendMessage(
  days: ChannelDay[],
  date: string,
  message: OrgChannelMessage,
): ChannelDay[] {
  if (days.some((d) => d.messages.some((m) => m.id === message.id))) return days;
  const idx = days.findIndex((d) => d.date === date);
  if (idx === -1) return [...days, { date, messages: [message] }];
  return days.map((d, i) => (i === idx ? { ...d, messages: [...d.messages, message] } : d));
}

/** The id of the newest loaded message, or null when nothing is loaded. */
export function lastMessageId(days: readonly ChannelDay[]): string | null {
  for (let i = days.length - 1; i >= 0; i--) {
    const list = days[i]!.messages;
    if (list.length > 0) return list[list.length - 1]!.id;
  }
  return null;
}

/** How many messages are loaded across every day. */
export function messageCount(days: readonly ChannelDay[]): number {
  return days.reduce((n, d) => n + d.messages.length, 0);
}

/** ISO timestamp → local `HH:mm` (the day separator already names the day); "" when unparsable. */
export function clockTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
