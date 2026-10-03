/**
 * A roadmap's room is an organization channel, borrowed as it is: this module only READS what
 * the organization writes for a channel — `channels/<id>/channel.toml` (name, members,
 * archived) and `channels/<id>/<yyyy-mm-dd>.jsonl` (one message per line). Nothing here writes
 * to a channel; every line in a room was sent by a person or an employee with the channel's
 * own commands. The read is by a cursor — a day file and the number of complete lines taken
 * from it — so the relay picks up where it left off, across days and restarts.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseToml } from "smol-toml";

/** The organization's channel id rule: a lowercase letter, then lowercase letters, digits or underscores. */
export const CHANNEL_ID = /^[a-z][a-z0-9_]{1,63}$/;

const DAY_FILE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;

export function channelDir(orgDir: string, channelId: string): string {
  return path.join(orgDir, "channels", channelId);
}

export interface RoomConfig {
  name: string;
  archived: boolean;
  /** Principals, as the channel lists them (`agent:<id>`, `user:<id>`). */
  members: string[];
}

/** The member Agent ids, in the channel's order. */
export function agentMembers(room: RoomConfig): string[] {
  return room.members.filter((m) => m.startsWith("agent:")).map((m) => m.slice("agent:".length));
}

/** The channel's configuration, or null when there is no such channel (or it cannot be read). */
export async function readRoom(orgDir: string, channelId: string): Promise<RoomConfig | null> {
  if (!CHANNEL_ID.test(channelId)) return null;
  let raw: string;
  try {
    raw = await fs.readFile(path.join(channelDir(orgDir, channelId), "channel.toml"), "utf8");
  } catch {
    return null;
  }
  let doc: Record<string, unknown>;
  try {
    doc = parseToml(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  const members = Array.isArray(doc.members)
    ? doc.members.filter((m): m is string => typeof m === "string")
    : [];
  return {
    name: typeof doc.name === "string" ? doc.name : channelId,
    archived: doc.archived === true,
    members,
  };
}

export interface RoomMessage {
  id: string;
  time: string;
  sender: string;
  hop: number;
  text: string;
  mentions: string[];
}

/** Where the relay stands in a room: the day file, and how many complete lines of it are read. */
export interface RoomCursor {
  date: string;
  line: number;
}

/** One message line, or null when it is not one (the organization reports those; here they are skipped). */
export function parseMessage(line: string): RoomMessage | null {
  let v: unknown;
  try {
    v = JSON.parse(line);
  } catch {
    return null;
  }
  const o = v as Record<string, unknown> | null;
  if (o === null || typeof o !== "object") return null;
  if (typeof o.id !== "string" || typeof o.time !== "string" || typeof o.sender !== "string")
    return null;
  if (typeof o.text !== "string") return null;
  const hop = typeof o.hop === "number" && Number.isInteger(o.hop) && o.hop >= 0 ? o.hop : 0;
  const mentions = Array.isArray(o.mentions)
    ? o.mentions.filter((m): m is string => typeof m === "string")
    : [];
  return { id: o.id, time: o.time, sender: o.sender, hop, text: o.text, mentions };
}

async function days(orgDir: string, channelId: string): Promise<string[]> {
  let names: string[];
  try {
    names = await fs.readdir(channelDir(orgDir, channelId));
  } catch {
    return [];
  }
  return names
    .map((n) => DAY_FILE.exec(n)?.[1])
    .filter((d): d is string => d !== undefined)
    .sort();
}

/** The complete lines of a day file: a last line not yet ended by a newline is still being written. */
async function completeLines(orgDir: string, channelId: string, date: string): Promise<string[]> {
  let text: string;
  try {
    text = await fs.readFile(path.join(channelDir(orgDir, channelId), `${date}.jsonl`), "utf8");
  } catch {
    return [];
  }
  const cut = text.lastIndexOf("\n");
  if (cut < 0) return [];
  return text.slice(0, cut).split("\n");
}

/** The room's end: the cursor that reads nothing that is already there. */
export async function endCursor(orgDir: string, channelId: string): Promise<RoomCursor> {
  const all = await days(orgDir, channelId);
  const last = all.at(-1);
  if (last === undefined) return { date: "0000-00-00", line: 0 };
  return { date: last, line: (await completeLines(orgDir, channelId, last)).length };
}

/** The messages after `cursor`, in order, and the cursor after them; a bad line is skipped (and counted). */
export async function readSince(
  orgDir: string,
  channelId: string,
  cursor: RoomCursor,
): Promise<{ messages: RoomMessage[]; cursor: RoomCursor; skipped: number }> {
  const messages: RoomMessage[] = [];
  let skipped = 0;
  let next = cursor;
  for (const date of await days(orgDir, channelId)) {
    if (date < cursor.date) continue;
    const lines = await completeLines(orgDir, channelId, date);
    const from = date === cursor.date ? cursor.line : 0;
    for (const line of lines.slice(from)) {
      if (line.trim() === "") continue;
      const msg = parseMessage(line);
      if (msg === null) skipped++;
      else messages.push(msg);
    }
    // Never step back: a day file that shrank (edited by hand) is read from where it now ends.
    next = { date, line: Math.max(lines.length, date === cursor.date ? cursor.line : 0) };
  }
  return { messages, cursor: next, skipped };
}

/** The last `count` messages of the room's latest days: the context a new room session starts with. */
export async function recentMessages(
  orgDir: string,
  channelId: string,
  count: number,
): Promise<RoomMessage[]> {
  const out: RoomMessage[] = [];
  for (const date of (await days(orgDir, channelId)).reverse()) {
    const lines = await completeLines(orgDir, channelId, date);
    for (let i = lines.length - 1; i >= 0 && out.length < count; i--) {
      const msg = parseMessage(lines[i]!);
      if (msg !== null) out.push(msg);
    }
    if (out.length >= count) break;
  }
  return out.reverse();
}
