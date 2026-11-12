/**
 * An employee's avatar: an image file in the organization directory, `avatars/<agent_id>.<ext>`.
 *
 * The organization's rather than the Agent's, like the employee's name: the same Agent may be
 * pictured differently somewhere else, and its own picture (services/agent-avatar.ts) is what
 * an organization view falls back to. The rule the file is written and read by is the one
 * every avatar has (services/avatar-file.ts).
 */
import path from "node:path";
import { avatarFileRev, readAvatarFile, writeAvatarFile } from "../services/avatar-file.js";
import type { AvatarImage, StoredAvatar } from "../services/avatar-file.js";

export function avatarsDir(dir: string): string {
  return path.join(dir, "avatars");
}

/** The employee's avatar, or null when it has none (or one too large to serve). */
export function readAvatar(dir: string, agentId: string): Promise<StoredAvatar | null> {
  return readAvatarFile(avatarsDir(dir), agentId);
}

/** The employee's avatar revision, as the chart lists it; undefined when it has none. */
export function readAvatarRev(dir: string, agentId: string): Promise<string | undefined> {
  return avatarFileRev(avatarsDir(dir), agentId);
}

/** Replaces the employee's avatar; `null` removes it. One file per employee, whatever the format. */
export function writeAvatar(
  dir: string,
  agentId: string,
  image: AvatarImage | null,
): Promise<void> {
  return writeAvatarFile(avatarsDir(dir), agentId, image);
}
