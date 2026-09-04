/**
 * A channel's stream shaping (pure, unit tested): the loaded day files in
 * order become one list of items — a separator per day, the unread divider at the read
 * cursor, `system` messages on their own, and consecutive messages by one sender folded
 * into a run under a single header — plus the day arithmetic the separators and the
 * "earlier" paging need, and the immutable append a live message goes through.
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
