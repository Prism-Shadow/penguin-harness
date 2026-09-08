/**
 * What the draft page opens IN A GIVEN WORKSPACE: the built-in conversation, or a
 * plugin-contributed surface (Claude Code being the first one).
 *
 * The kind belongs to the Workspace, not to the Project. A repository someone drives
 * through Claude Code is driven that way every time they come back to it, while the next
 * directory over is a conversation — so a single remembered pick per Project would be wrong
 * for one of them on every visit. This records the pick against the Workspace it was made
 * for, and the draft page re-applies it whenever that Workspace is the one selected.
 *
 * Its own entry rather than a field of the draft cache (draft-cache.ts), which is cleared
 * outright when a conversation is sent: that entry is one unsent draft, this is a standing
 * preference that has to outlive every send. Same two disciplines otherwise — the key is
 * isolated by "user x Project" (#68: two accounts in one browser must not read each other's
 * choices), and reads validate the stored shape field by field, since anything may have
 * written to localStorage.
 *
 * Only surfaces are stored. The conversation is the built-in default, so choosing it
 * DELETES the entry instead of writing "conversation" — which also keeps the map to the
 * Workspaces where a surface was actually picked, rather than one line per directory ever
 * visited.
 */
import type { DraftStorage } from "./draft-cache";

/** Where the per-Workspace picks for one user x Project live. */
export const surfaceMemoryKey = (userId: string, projectId: string): string =>
  `penguin.chatSurface.${userId}.${projectId}`;

/**
 * The Workspace a pick is about: its path, and the machine that path is on. A path alone
 * does not identify a directory — `/srv/app` exists on many machines and is a different
 * project on each — so both go into the key, exactly as they travel together everywhere
 * else. `""` is the temporary Workspace, which is a legitimate place to prefer a surface.
 */
export const workspaceKey = (workspace: string, machineId: string | null): string =>
  `${machineId ?? ""}:${workspace}`;

/** Parses the stored map, dropping every entry that is not a `workspace -> kind` pair. */
function parseMemory(raw: string | null): Record<string, string> {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === "string" && value !== "") out[key] = value;
  }
  return out;
}

function readMemory(
  userId: string,
  projectId: string,
  storage: DraftStorage,
): Record<string, string> {
  try {
    return parseMemory(storage.getItem(surfaceMemoryKey(userId, projectId)));
  } catch {
    return {};
  }
}

/**
 * The kind last chosen for this Workspace, or null for the conversation — which is both
 * "chosen explicitly" and "never chosen at all", because it is the default either way.
 */
export function recallSurfaceKind(
  userId: string,
  projectId: string,
  workspace: string,
  machineId: string | null,
  storage: DraftStorage = localStorage,
): string | null {
  return readMemory(userId, projectId, storage)[workspaceKey(workspace, machineId)] ?? null;
}

/**
 * The kind a recalled pick actually resolves to, given what the server contributes now.
 *
 * A surface is a plugin's contribution: the Project may have dropped the plugin since the
 * pick was made, and a kind nothing contributes any more draws a composer that can only say
 * "unavailable". Falling back to the conversation is what a Workspace with no pick does, and
 * an unopenable surface is worth no more than that.
 */
export function applicableSurfaceKind(
  remembered: string | null,
  contributed: readonly string[],
): string | null {
  return remembered !== null && contributed.includes(remembered) ? remembered : null;
}

/** Records the pick for this Workspace; `null` (the conversation) drops the entry. */
export function rememberSurfaceKind(
  userId: string,
  projectId: string,
  workspace: string,
  machineId: string | null,
  kind: string | null,
  storage: DraftStorage = localStorage,
): void {
  const memory = readMemory(userId, projectId, storage);
  const key = workspaceKey(workspace, machineId);
  if (kind === null) {
    if (!(key in memory)) return;
    delete memory[key];
  } else {
    if (memory[key] === kind) return;
    memory[key] = kind;
  }
  try {
    storage.setItem(surfaceMemoryKey(userId, projectId), JSON.stringify(memory));
  } catch {
    /* Write fails under quota limits/private browsing: the memory is best-effort */
  }
}
