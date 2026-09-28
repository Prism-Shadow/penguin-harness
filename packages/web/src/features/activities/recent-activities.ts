/**
 * The activities an author opened most recently, per project, kept in this browser. A
 * convenience over the full list, not source-of-truth state, so every failure degrades
 * to "nothing recent": storage is injectable (vitest runs in Node, no localStorage),
 * absent / corrupt / foreign-shaped data reads back empty, and writing is best-effort.
 */
import type { ActivityRecord } from "@prismshadow/penguin-server/api";

/** Minimal storage interface (the subset of localStorage used here); tests inject an in-memory one. */
export interface RecentActivitiesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** One opening: the activity and when it was opened (ISO timestamp). */
export interface RecentActivity {
  id: string;
  at: string;
}

/** Holds `{ [projectId]: RecentActivity[] }`, each list most recent first. */
export const RECENT_ACTIVITIES_KEY = "penguin.activities.recent";

/** How many openings each project remembers. */
export const RECENT_KEEP = 15;

/** How many the list page shows. */
export const RECENT_SHOW = 4;

function readAll(storage?: RecentActivitiesStorage): Record<string, unknown> {
  try {
    // `localStorage` is resolved inside the try: touching it throws when site data is blocked.
    const raw = (storage ?? localStorage).getItem(RECENT_ACTIVITIES_KEY);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function entriesOf(value: unknown): RecentActivity[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const entries: RecentActivity[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const { id, at } = entry as { id?: unknown; at?: unknown };
    if (typeof id !== "string" || id === "" || typeof at !== "string" || seen.has(id)) continue;
    seen.add(id);
    entries.push({ id, at });
  }
  return entries.slice(0, RECENT_KEEP);
}

/** The project's openings, most recent first; empty on anything unreadable. */
export function readRecent(
  projectId: string,
  storage?: RecentActivitiesStorage,
): readonly RecentActivity[] {
  const all = readAll(storage);
  return Object.prototype.hasOwnProperty.call(all, projectId) ? entriesOf(all[projectId]) : [];
}

/**
 * Records an opening: moves the activity to the front of its project's list, drops the
 * oldest past {@link RECENT_KEEP}, and persists, leaving other projects' lists as they
 * were. Returns the project's next list; a lost write only costs persistence.
 */
export function pushRecent(
  projectId: string,
  activityId: string,
  now: string,
  storage?: RecentActivitiesStorage,
): readonly RecentActivity[] {
  const all = readAll(storage);
  const before = Object.prototype.hasOwnProperty.call(all, projectId)
    ? entriesOf(all[projectId])
    : [];
  const next = [{ id: activityId, at: now }, ...before.filter((x) => x.id !== activityId)].slice(
    0,
    RECENT_KEEP,
  );
  try {
    (storage ?? localStorage).setItem(
      RECENT_ACTIVITIES_KEY,
      JSON.stringify({ ...all, [projectId]: next }),
    );
  } catch {
    /* best-effort persistence (quota limits / private browsing) */
  }
  return next;
}

/**
 * The listed activities in recent order, at most {@link RECENT_SHOW}. An id the list no
 * longer holds (deleted, or never in this project) is skipped, so the row still fills
 * from older openings.
 */
export function recentActivities(
  items: readonly ActivityRecord[],
  recent: readonly RecentActivity[],
): ActivityRecord[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const result: ActivityRecord[] = [];
  for (const entry of recent) {
    const item = byId.get(entry.id);
    if (item && !result.includes(item)) result.push(item);
    if (result.length === RECENT_SHOW) break;
  }
  return result;
}
