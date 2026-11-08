/**
 * An Agent's own avatar: an image file in its Agent State, `agent_state/avatar.<png|jpg|webp>`.
 *
 * In the Agent State because it is the Agent's — so it travels with everything that carries the
 * State (a snapshot and its restore, an export and its import, a machine's Agents), and the
 * Agent may write it itself like any other file there. The rule it is written and read by is
 * the one every avatar has (avatar-file.ts). An organization pictures its employee with a file
 * of its own first (organization/avatars.ts); this is what every other surface shows, and what
 * an organization falls back to.
 */
import { agentStateDir } from "@prismshadow/penguin-core";
import { avatarFileRev, readAvatarFile, writeAvatarFile } from "./avatar-file.js";
import type { AvatarImage, StoredAvatar } from "./avatar-file.js";

/** The file's name before its extension. */
const STEM = "avatar";

export function readAgentAvatar(
  root: string,
  projectId: string,
  agentId: string,
): Promise<StoredAvatar | null> {
  return readAvatarFile(agentStateDir(root, projectId, agentId), STEM);
}

/** The revision the Agent list carries (`avatarRev`); undefined when the Agent has no picture. */
export function agentAvatarRev(
  root: string,
  projectId: string,
  agentId: string,
): Promise<string | undefined> {
  return avatarFileRev(agentStateDir(root, projectId, agentId), STEM);
}

/** Replaces the Agent's picture; `null` removes it, and the default drawing shows again. */
export function writeAgentAvatar(
  root: string,
  projectId: string,
  agentId: string,
  image: AvatarImage | null,
): Promise<void> {
  return writeAvatarFile(agentStateDir(root, projectId, agentId), STEM, image);
}
