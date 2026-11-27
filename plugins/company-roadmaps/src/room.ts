/**
 * A roadmap's room is an organization channel like any other: this module only READS what the
 * organization writes for it — `channels/<id>/channel.toml` (name, members, archived) — to
 * check a room before a roadmap is bound to it. Nothing here writes to a channel: its messages
 * are the organization's, delivered by the organization, and the members a roadmap changes go
 * through the organization gateway (members.ts).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseToml } from "smol-toml";

/** The organization's channel id rule: a lowercase letter, then lowercase letters, digits or underscores. */
export const CHANNEL_ID = /^[a-z][a-z0-9_]{1,63}$/;

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
