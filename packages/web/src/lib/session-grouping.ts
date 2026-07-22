/**
 * Pure grouping logic for the chat sidebar's "by Workspace" mode.
 *
 * There is no Workspace entity on the server: a Session only carries the plain
 * filesystem path locked in at creation (SessionInfo.workspace), so grouping works
 * on those path strings. Sessions created without an explicit Workspace get an
 * auto-created temp directory shaped like `<agentDir>/workspaces/tmp-<8hex>`
 * (packages/core/src/internal/session-support.ts, createTempWorkspace); each of
 * those is single-use, so per-path groups would be one-session noise — they are all
 * merged into ONE trailing "temp workspaces" group instead.
 */
import type { SessionInfo } from "@prismshadow/penguin-server/api";

/** Group key of the merged auto-temp group ("\0" can never appear in a filesystem path, so it never collides with a real Workspace). */
export const TEMP_WORKSPACE_GROUP_KEY = "\0temp-workspaces";

/** Auto-created temp Workspace tail: `workspaces/tmp-<8hex>` (either path separator; core supports win32). */
const TEMP_WORKSPACE_RE = /[/\\]workspaces[/\\]tmp-[0-9a-f]{8}$/;

/**
 * Whether a Session's Workspace is an auto-created temp directory. An empty path
 * also counts as "auto temp": the server always backfills the resolved path, so
 * this is defensive only.
 */
export function isTempWorkspace(workspace: string): boolean {
  const p = workspace.trim();
  return p === "" || TEMP_WORKSPACE_RE.test(p);
}

/** Stable group key for a Session's Workspace (collapse state / React key): the path itself, or the temp sentinel. */
export function workspaceGroupKey(workspace: string): string {
  return isTempWorkspace(workspace) ? TEMP_WORKSPACE_GROUP_KEY : workspace.trim();
}

/** Short display label: the last path segment (the filesystem root yields "/"). */
export function workspaceLabel(workspace: string): string {
  const parts = workspace
    .trim()
    .split(/[/\\]+/)
    .filter(Boolean);
  return parts[parts.length - 1] ?? "/";
}

/** Three-way split of one sidebar group's Sessions (rendered top to bottom in this order). */
export interface SessionPartition {
  /** User-created, not archived: rendered directly in the group body. */
  active: SessionInfo[];
  /** Automation-created (`source` set: schedule / subagent), not archived: the collapsed "Automated" folder. */
  automated: SessionInfo[];
  /** Archived: the collapsed "Archived" folder. Archived wins — an archived Session with a `source` goes here only. */
  archived: SessionInfo[];
}

/**
 * Partitions a group's Sessions for rendering: archived first (regardless of `source` —
 * archiving is an explicit user action, so the Archived folder must show everything the
 * user put there), then automation-created (schedule / subagent), then plain user Sessions.
 * Input order is preserved within each part.
 */
export function partitionSessions(sessions: SessionInfo[]): SessionPartition {
  const parts: SessionPartition = { active: [], automated: [], archived: [] };
  for (const s of sessions) {
    if (s.archived) parts.archived.push(s);
    else if (s.source) parts.automated.push(s);
    else parts.active.push(s);
  }
  return parts;
}

export interface WorkspaceGroup {
  /** Stable group key: the Workspace path, or TEMP_WORKSPACE_GROUP_KEY for the merged temp group. */
  key: string;
  /** Display label: the path basename; empty for the temp group (the sidebar renders the localized name). */
  label: string;
  /** Full path for tooltips; null for the merged temp group (its members' paths all differ). */
  fullPath: string | null;
  /** True for the merged auto-temp group. */
  temp: boolean;
  /** Member Sessions, newest first (createdAt desc). */
  sessions: SessionInfo[];
}

/**
 * Groups Sessions by their Workspace path. Named groups are sorted by their newest
 * Session's createdAt desc; the merged temp group (if any) always comes last.
 * Sessions inside a group are re-sorted newest first — the flat store list
 * concatenates per-Agent server responses, so its order isn't globally chronological.
 * createdAt is a uniform ISO-8601 UTC string (server: `new Date().toISOString()`),
 * so lexicographic comparison equals chronological comparison.
 */
export function groupSessionsByWorkspace(sessions: SessionInfo[]): WorkspaceGroup[] {
  const byKey = new Map<string, WorkspaceGroup>();
  for (const s of sessions) {
    const key = workspaceGroupKey(s.workspace);
    let group = byKey.get(key);
    if (!group) {
      const temp = key === TEMP_WORKSPACE_GROUP_KEY;
      group = {
        key,
        label: temp ? "" : workspaceLabel(s.workspace),
        fullPath: temp ? null : s.workspace.trim(),
        temp,
        sessions: [],
      };
      byKey.set(key, group);
    }
    group.sessions.push(s);
  }
  const byCreatedDesc = (a: string, b: string) => (a < b ? 1 : a > b ? -1 : 0);
  const groups = [...byKey.values()];
  for (const g of groups) g.sessions.sort((a, b) => byCreatedDesc(a.createdAt, b.createdAt));
  groups.sort((a, b) => {
    if (a.temp !== b.temp) return a.temp ? 1 : -1;
    return byCreatedDesc(a.sessions[0]?.createdAt ?? "", b.sessions[0]?.createdAt ?? "");
  });
  return groups;
}
