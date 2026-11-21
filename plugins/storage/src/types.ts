/**
 * The Storage page's wire types (`/api/me/storage*`): what the data root holds by category, the
 * review-then-delete cleanup of what can be regenerated, and the Sessions listed by size and age.
 * The storage plugin's `./types` entry: its server, web and CLI halves and the component gallery's
 * mock speak them.
 */

/**
 * The eight categories every measured byte falls in, exactly one each:
 * - `traces`: an Agent's `traces/`.
 * - `agentState`: `agent_state/`, `agent_state.git/` and `snapshots/`.
 * - `workspaces`: an Agent's `workspaces/` (temporary and Test Workspaces).
 * - `scratchpads`: an Agent's `scratchpad/`.
 * - `caches`: an Agent's `shared_env/`, and the data root's `.cache/`.
 * - `logs`: the data root's `logs/`.
 * - `plugins`: the data root's `plugins/`.
 * - `other`: everything else (Benchmarks, organizations, `web.db`, `hmr/`, `machines/`, …).
 */
export type StorageCategory =
  "traces" | "agentState" | "workspaces" | "scratchpads" | "caches" | "logs" | "plugins" | "other";

/** Bytes per category. */
export type StorageBytes = Record<StorageCategory, number>;

/** One Agent's share of its Project. */
export interface StorageAgentUsage {
  agentId: string;
  /** The Agent's display name (its id when it has none). */
  name: string;
  bytes: number;
  categories: StorageBytes;
}

/** One Project the caller can open. */
export interface StorageProjectUsage {
  projectId: string;
  /** The Project's display name (its id when it has none). */
  name: string;
  /** The Project's directory on the server's disk. */
  path: string;
  bytes: number;
  categories: StorageBytes;
  /** Largest first. */
  agents: StorageAgentUsage[];
}

/** One top-level entry of the data root that is not a Project (`web.db`, `logs/`, `hmr/`, …). */
export interface StorageServerEntry {
  name: string;
  category: StorageCategory;
  bytes: number;
}

/** The whole data root, for an admin. */
export interface StorageServerUsage {
  /** The data root's path. */
  root: string;
  bytes: number;
  categories: StorageBytes;
  /** The Projects the admin cannot open, as one sum: how many, and their bytes. */
  otherProjects: { count: number; bytes: number };
  /** Largest first. */
  entries: StorageServerEntry[];
}

/** GET /api/me/storage and POST /api/me/storage/refresh. */
export interface StorageUsage {
  /** The oldest measurement among the units shown (ISO); null until a first one has ended. */
  measuredAt: string | null;
  /** A measurement of a unit shown is under way. */
  measuring: boolean;
  /** Why the last measurement of a unit shown failed. */
  error?: string;
  /** The sum over the caller's Projects. */
  bytes: number;
  categories: StorageBytes;
  /** Largest first. */
  projects: StorageProjectUsage[];
  /** An admin's alone. */
  server?: StorageServerUsage;
  /**
   * Whether this caller may show a folder in the machine's file manager (`POST /reveal`): a
   * server in desktop mode, asked from the desktop shell's own window.
   */
  reveal: boolean;
}

/**
 * What a cleanup item is:
 * - `scratchpad`: `<agent>/scratchpad/<sessionId>/`;
 * - `workspace`: `<agent>/workspaces/<name>/`;
 * - `agentCache`: `<agent>/shared_env/<name>/`;
 * - `serverCache`: `<root>/.cache/<name>/` (admins only).
 */
export type StorageCleanupKind = "scratchpad" | "workspace" | "agentCache" | "serverCache";

/**
 * Why removing an item is safe: what it belonged to is gone (`orphan`: a scratchpad whose Session
 * is gone, a temporary Workspace no Session points at), or nothing has used it for the age asked or
 * is using it now (`idle`).
 */
export type StorageCleanupReason = "orphan" | "idle";

/** One folder the cleanup may remove. */
export interface StorageCleanupItem {
  /** Names the item to POST /api/me/storage/cleanup; opaque to the page. */
  id: string;
  kind: StorageCleanupKind;
  reason: StorageCleanupReason;
  projectId?: string;
  projectName?: string;
  agentId?: string;
  agentName?: string;
  /** The Session an idle scratchpad belongs to. */
  sessionId?: string;
  /** That Session's title, when the caller can open its Project; null when it has none. */
  title?: string | null;
  /** The folder's own name: the Session id, the Workspace directory, the environment, the cache. */
  name: string;
  bytes: number;
  /** The newest change anywhere under it (ISO); null for an empty folder the walk saw no time of. */
  lastModifiedAt: string | null;
  /** An idle scratchpad's Session's last activity (ISO). */
  lastActiveAt?: string;
  /** Whether the review picks it to begin with. */
  selected: boolean;
}

/** GET /api/me/storage/cleanup. */
export interface StorageCleanupReview {
  /** When the sizes were measured (ISO). */
  measuredAt: string;
  /** The idle age the review applied, in days. */
  olderThanDays: number;
  items: StorageCleanupItem[];
}

/** POST /api/me/storage/cleanup's body. */
export interface StorageCleanupRequest {
  /** 1–500 item ids from a review. */
  items: string[];
  /** The idle age the review applied: each item is judged again by it. */
  olderThanDays: number;
}

/**
 * Why an item was left: `in_use` (in use now, or no longer idle), `gone` (not there, or not the
 * caller's to clean), `failed` (it could not be moved aside).
 */
export type StorageCleanupSkipReason = "in_use" | "gone" | "failed";

/** POST /api/me/storage/cleanup's answer. */
export interface StorageCleanupResult {
  /** Items moved aside; their contents are removed in the background. */
  removed: number;
  /** Their bytes, as the review measured them. */
  bytes: number;
  skipped: Array<{ id: string; reason: StorageCleanupSkipReason }>;
}

/** Which Sessions the Trace list holds, by the listing rule. */
export type StorageSessionListing = "all" | "active" | "archived";

/** How the Trace list is ordered: largest first, or least recently active first. */
export type StorageSessionSort = "size" | "age";

/** GET /api/me/storage/sessions's filters. */
export interface StorageSessionsQuery {
  projectId?: string;
  /** With `projectId`. */
  agentId?: string;
  listing?: StorageSessionListing;
  /** Last active more than this many days ago. */
  olderThanDays?: number;
  sort?: StorageSessionSort;
}

/** One Session in the Trace list. */
export interface StorageSessionRow {
  sessionId: string;
  projectId: string;
  projectName: string;
  agentId: string;
  agentName: string;
  /** Its title, else its first prompt's; null when it has neither. */
  title: string | null;
  createdAt: string;
  lastActiveAt: string;
  archived: boolean;
  /** A Task, a compaction or queued input is under way: the page does not offer it. */
  running: boolean;
  /** Its Trace files' bytes, from the Trace index. */
  traceBytes: number;
  /** Its scratchpad's bytes as the last measurement saw them; absent before one. */
  scratchpadBytes?: number;
}

/** GET /api/me/storage/sessions. */
export interface StorageSessionsResponse {
  /** At most 500, in the order asked. */
  sessions: StorageSessionRow[];
  /** Every Session the filters match. */
  total: number;
  /** Their bytes (Trace and measured scratchpad). */
  totalBytes: number;
  /** More matched than were listed. */
  truncated: boolean;
}

/** POST /api/me/storage/reveal's body: a Project's folder, or the data root (admins). */
export interface StorageRevealRequest {
  projectId?: string;
}
