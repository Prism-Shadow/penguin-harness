/**
 * Pure grouping logic for the chat sidebar's Session groups — the "by Workspace" mode
 * (below), and the time buckets of the "by time" mode (TIME_BUCKETS, near the bottom).
 *
 * There is no Workspace entity on the server: a Session only carries the plain
 * filesystem path locked in at creation (SessionInfo.workspace), so grouping works
 * on those path strings. Sessions created without an explicit Workspace get an
 * auto-created temporary workspace shaped like `<agentDir>/workspaces/tmp-<8hex>`
 * (packages/core/src/internal/session-support.ts, createTempWorkspace); each of
 * those is single-use, so per-path groups would be one-session noise — they are all
 * merged into ONE trailing "temporary workspaces" group instead.
 */
import type {
  SessionCategory,
  SessionCategoryCounts,
  SessionInfo,
} from "@prismshadow/penguin-server/api";

/** Group key of the merged temporary-workspace group ("\0" can never appear in a filesystem path, so it never collides with a real Workspace). */
export const TEMP_WORKSPACE_GROUP_KEY = "\0temp-workspaces";

/** Auto-created temporary Workspace tail: `workspaces/tmp-<8hex>` (either path separator; core supports win32). */
const TEMP_WORKSPACE_RE = /[/\\]workspaces[/\\]tmp-[0-9a-f]{8}$/;

/**
 * Whether a Session's Workspace is an auto-created temporary workspace. An empty
 * path also counts as one: the server always backfills the resolved path, so this
 * is defensive only.
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

/**
 * Sidebar page size: sessions fetched per (Agent, category) per page, and the per-group
 * display cap step for active rows — 10 conversations show by default and every "More"
 * click reveals/loads 10 more. Fetches use limit = SIDEBAR_PAGE_SIZE + 1 (see splitPage)
 * so one request both fills a page and answers "is there more" without a
 * response-envelope change.
 */
export const SIDEBAR_PAGE_SIZE = 10;

/**
 * Groups (Agents / Workspace groups) rendered per sidebar page. With dozens of groups the
 * full list renders too tall to scan (#139), so the sidebar paginates them: one page at a
 * time, stepped by the pager below the list. A pure display window — every group's data
 * loading is unchanged, and the manual group order is committed over the whole sequence,
 * not the page on screen.
 */
export const SIDEBAR_GROUP_PAGE_SIZE = 10;

/** Pages `total` groups take (always at least one, so an empty list still has a page 1). */
export function groupPageCount(total: number, pageSize = SIDEBAR_GROUP_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/**
 * A stored page number pinned inside the pages that currently exist. Groups come and go
 * (a Workspace is removed, an Agent is deleted, a Project switch swaps the whole list),
 * and a page that outlived its groups must land on the last real one rather than render
 * an empty sidebar.
 */
export function clampGroupPage(
  page: number,
  total: number,
  pageSize = SIDEBAR_GROUP_PAGE_SIZE,
): number {
  return Math.min(Math.max(page, 0), groupPageCount(total, pageSize) - 1);
}

/** The page a group at `index` of the ordered sequence renders on (0-based both ends). */
export function groupPageOf(index: number, pageSize = SIDEBAR_GROUP_PAGE_SIZE): number {
  return Math.floor(Math.max(index, 0) / pageSize);
}

/** The groups of one page, in the order given (the caller has already sorted them). */
export function groupPageSlice<T>(
  groups: readonly T[],
  page: number,
  pageSize = SIDEBAR_GROUP_PAGE_SIZE,
): T[] {
  const start = clampGroupPage(page, groups.length, pageSize) * pageSize;
  return groups.slice(start, start + pageSize);
}

/**
 * Conversations of one group that its reveal row still hides — what "Show N more chats"
 * counts. Computed from the group's OWN numbers only: `loaded` rows are in memory,
 * `shown` of them are past the display cap, and `total` is the group's exact server share
 * — except once every Agent that could hold its rows is fully fetched (`fullyLoaded`),
 * when the loaded rows ARE the share. That last clause is what keeps a count drifting
 * above reality (totals refresh only on reload) from leaving a row that reveals nothing.
 */
export function hiddenRowCount({
  shown,
  loaded,
  total,
  fullyLoaded,
}: {
  shown: number;
  loaded: number;
  total: number;
  fullyLoaded: boolean;
}): number {
  return Math.max((fullyLoaded ? loaded : Math.max(total, loaded)) - shown, 0);
}

/**
 * Applies the limit+1 fetch trick: `fetched` came from a request with `limit = pageSize + 1`;
 * the visible page is the first `pageSize` items, and an overflow item (never shown) proves
 * the server has more.
 */
export function splitPage<T>(fetched: T[], pageSize: number): { items: T[]; hasMore: boolean } {
  return fetched.length > pageSize
    ? { items: fetched.slice(0, pageSize), hasMore: true }
    : { items: fetched, hasMore: false };
}

/**
 * The sidebar category a Session renders under — the same precedence the server's
 * `category` list filter applies, so filtered fetching and client rendering can never
 * disagree: archived wins regardless of `source` (archiving is an explicit user action,
 * so the Archived folder must show everything the user put there); otherwise a Session
 * goes to its origin's bucket, and no (or an unrecognized future) source falls through
 * to the active user rows (visible) rather than vanishing into the wrong folder.
 */
export function sessionCategory(s: SessionInfo): SessionCategory {
  if (s.archived) return "archived";
  return s.source === "subagent" || s.source === "schedule" ? s.source : "active";
}

/**
 * Whether a Session matches the sidebar's live title search: case-insensitive substring
 * over the stored title (untitled Sessions have none and never match a non-empty
 * query); a blank/whitespace query matches everything (search inactive).
 */
export function matchesSessionQuery(s: SessionInfo, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  return (s.title ?? "").toLowerCase().includes(q);
}

/** The collapsed-folder categories of a group, in render order (below the active user rows). */
export const FOLDER_CATEGORIES = ["subagent", "schedule", "archived"] as const;
export type FolderCategory = (typeof FOLDER_CATEGORIES)[number];

/**
 * Four-way split of one sidebar group's Sessions by sessionCategory (rendered top to
 * bottom in this order): active user rows in the group body, then the collapsed
 * Subagents / Scheduled / Archived folders.
 */
export type SessionPartition = Record<SessionCategory, SessionInfo[]>;

/** Partitions a group's Sessions for rendering. Input order is preserved within each part. */
export function partitionSessions(sessions: SessionInfo[]): SessionPartition {
  const parts: SessionPartition = { active: [], subagent: [], schedule: [], archived: [] };
  for (const s of sessions) parts[sessionCategory(s)].push(s);
  return parts;
}

const ALL_CATEGORIES: readonly SessionCategory[] = ["active", ...FOLDER_CATEGORIES];

/** One workspace-mode group's aggregated server counts: exact totals plus which Agents hold rows of each category. */
export interface GroupCounts {
  totals: SessionCategoryCounts;
  /** Per category, the Agents whose share of this group is non-zero — the fetch fan-out set for the group's folders and "More". */
  agents: Record<SessionCategory, string[]>;
}

/**
 * Folds the per-Agent per-Workspace-path category counts (SessionsResponse.workspaceCounts)
 * into workspace-mode groups, keyed like groupSessionsByWorkspace (exact path;
 * temporary-workspace paths merged into the temp group). The sidebar labels a group's
 * folders and decides its "More" from its own share — never from an Agent's other
 * Workspaces, which would advertise folders whose content lives in other groups.
 */
export function aggregateWorkspaceCounts(
  byAgent: ReadonlyMap<string, Readonly<Record<string, SessionCategoryCounts>>>,
): Map<string, GroupCounts> {
  const out = new Map<string, GroupCounts>();
  for (const [agentId, byWorkspace] of byAgent) {
    for (const [workspace, counts] of Object.entries(byWorkspace)) {
      const key = workspaceGroupKey(workspace);
      let group = out.get(key);
      if (!group) {
        group = {
          totals: { active: 0, subagent: 0, schedule: 0, archived: 0 },
          agents: { active: [], subagent: [], schedule: [], archived: [] },
        };
        out.set(key, group);
      }
      for (const category of ALL_CATEGORIES) {
        const n = counts[category];
        // !(n > 0) rather than n <= 0: a missing key (undefined) must not slip through and poison the totals with NaN.
        if (!(n > 0)) continue;
        group.totals[category] += n;
        // Several temp paths of one Agent fold into the temp group: dedupe.
        if (!group.agents[category].includes(agentId)) group.agents[category].push(agentId);
      }
    }
  }
  return out;
}

/**
 * The Session the UI opens as "the last conversation" (the chat home's auto-select and
 * the collapsed rail's entry): the newest loaded row that is a conversation of the
 * user's own. Archived rows are hidden by choice and a subagent Session is a child of
 * some other conversation, so neither is ever auto-opened; schedule-created runs are
 * the user's conversations and qualify. Newest by createdAt (uniform ISO-8601 UTC, so
 * string comparison is chronological), ties broken by sessionId — the list's ordering
 * convention. Input order doesn't matter.
 */
export function latestConversation(sessions: readonly SessionInfo[]): SessionInfo | null {
  let best: SessionInfo | null = null;
  for (const s of sessions) {
    const category = sessionCategory(s);
    if (category !== "active" && category !== "schedule") continue;
    if (
      !best ||
      s.createdAt > best.createdAt ||
      (s.createdAt === best.createdAt && s.sessionId > best.sessionId)
    ) {
      best = s;
    }
  }
  return best;
}

export interface WorkspaceGroup<T = SessionInfo> {
  /** Stable group key: the Workspace path, or TEMP_WORKSPACE_GROUP_KEY for the merged temp group. */
  key: string;
  /** Display label: the path basename; empty for the temp group (the sidebar renders the localized name). */
  label: string;
  /** Full path for tooltips; null for the merged temp group (its members' paths all differ). */
  fullPath: string | null;
  /** True for the merged temporary-workspace group. */
  temp: boolean;
  /** Member Sessions, newest first (createdAt desc). */
  sessions: T[];
}

/**
 * Groups Sessions by their Workspace path. Named groups are sorted by their newest
 * Session's createdAt desc; the merged temp group (if any) always comes last.
 * Sessions inside a group are re-sorted newest first — the flat store list
 * concatenates per-Agent server responses, so its order isn't globally chronological.
 * createdAt is a uniform ISO-8601 UTC string (server: `new Date().toISOString()`),
 * so lexicographic comparison equals chronological comparison.
 * Generic over the row type (defaulting to SessionInfo, the sidebar's rows): the Trace
 * page groups its own Session rows with the same logic — only `workspace` and the
 * `createdAt` sort key are touched.
 */
export function groupSessionsByWorkspace<T extends { workspace: string; createdAt: string }>(
  sessions: T[],
): WorkspaceGroup<T>[] {
  const byKey = new Map<string, WorkspaceGroup<T>>();
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

/**
 * The sidebar's time buckets, in render order: last day, last month, everything older.
 * Bucketing is on `lastActiveAt` — the same key the recency sort and each row's compact
 * timestamp already use, so a row labelled "3m ago" can never sit under "Earlier".
 */
export const TIME_BUCKETS = ["day", "month", "earlier"] as const;
export type TimeBucket = (typeof TIME_BUCKETS)[number];

const DAY_MS = 24 * 60 * 60 * 1000;
/** "Last month" is a rolling 30-day window, not a calendar month — the boundary a user reads off a relative timestamp. */
const MONTH_MS = 30 * DAY_MS;

/** Group key of a time bucket (collapse state / React key); "\0" can never appear in a Workspace path or an Agent id, so these never collide with the other modes' keys. */
export const timeGroupKey = (bucket: TimeBucket): string => `\0time-${bucket}`;

/**
 * Group key the folders (Subagents / Scheduled / Archived) hang off in time mode. They are
 * NOT bucketed: their rows load only when a folder is first expanded, so an unloaded
 * Session's bucket is unknown and no bucket could honestly advertise a share of them. One
 * shared, Project-wide set below the buckets is what the sidebar renders instead.
 */
export const TIME_FOLDERS_GROUP_KEY = "\0time-folders";

/** The bucket an activity timestamp falls in, against `nowMs`. An unparseable stamp counts as the oldest bucket rather than jumping to the top. */
export function timeBucketOf(lastActiveAt: string, nowMs: number): TimeBucket {
  const t = Date.parse(lastActiveAt);
  if (!Number.isFinite(t)) return "earlier";
  const age = nowMs - t;
  if (age < DAY_MS) return "day";
  return age < MONTH_MS ? "month" : "earlier";
}

export interface TimeGroup<T = SessionInfo> {
  /** Stable group key (timeGroupKey of the bucket). */
  key: string;
  bucket: TimeBucket;
  /** Member Sessions, newest activity first. */
  sessions: T[];
}

/**
 * Buckets Sessions by their last activity into the three time groups, in TIME_BUCKETS
 * order. Empty buckets are dropped — a "Last day" header over nothing states an absence
 * the list is not asked to report. Members are sorted by `lastActiveAt` desc (the flat
 * store list concatenates per-Agent responses, so its order isn't globally chronological);
 * the sidebar re-orders them again for pins and manual sort.
 */
export function groupSessionsByTime<T extends { lastActiveAt: string }>(
  sessions: readonly T[],
  nowMs: number,
): TimeGroup<T>[] {
  const byBucket = new Map<TimeBucket, T[]>();
  for (const s of sessions) {
    const bucket = timeBucketOf(s.lastActiveAt, nowMs);
    const list = byBucket.get(bucket);
    if (list) list.push(s);
    else byBucket.set(bucket, [s]);
  }
  const groups: TimeGroup<T>[] = [];
  for (const bucket of TIME_BUCKETS) {
    const rows = byBucket.get(bucket);
    if (rows === undefined) continue;
    rows.sort((a, b) =>
      a.lastActiveAt < b.lastActiveAt ? 1 : a.lastActiveAt > b.lastActiveAt ? -1 : 0,
    );
    groups.push({ key: timeGroupKey(bucket), bucket, sessions: rows });
  }
  return groups;
}

/** Sums per-Agent category totals into one Project-wide set (time mode's shared folders and its whole-list "More" read their share from it). */
export function totalCategoryCounts(
  byAgent: ReadonlyMap<string, SessionCategoryCounts>,
): SessionCategoryCounts {
  const totals: SessionCategoryCounts = { active: 0, subagent: 0, schedule: 0, archived: 0 };
  for (const counts of byAgent.values()) {
    for (const category of ALL_CATEGORIES) {
      const n = counts[category];
      // Same guard as aggregateWorkspaceCounts: a missing key must not poison the sum with NaN.
      if (n > 0) totals[category] += n;
    }
  }
  return totals;
}

/**
 * Stable pinned-first partition for sidebar groups: items whose key is in `pinned`
 * come first, each partition preserving the input order (recency for Workspace
 * groups, the configured order for Agents). Pure and mode-agnostic — callers pass
 * the key extractor; pinned keys with no matching item are simply ignored.
 */
export function pinnedFirst<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  pinned: ReadonlySet<string>,
): T[] {
  if (pinned.size === 0) return [...items];
  const pin: T[] = [];
  const rest: T[] = [];
  for (const item of items) (pinned.has(keyOf(item)) ? pin : rest).push(item);
  return [...pin, ...rest];
}
