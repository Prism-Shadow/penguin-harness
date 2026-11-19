/**
 * Which storage category each part of the data root falls in, and where the caches are.
 *
 * Every byte the Storage page counts falls in exactly one category (api/storage-types.ts
 * StorageCategory). Every place below is built by the path helpers that define the layout —
 * core's (`agentDir`, `tracesDir`, `scratchpadDir`, `workspacesDir`, …) and the server's for its
 * own folders — never joined here by name, so a folder that moves (Projects under a `projects/`
 * level, say) moves for the Storage page with its helper. Anything under a measured unit that no
 * entry names is `other`.
 *
 * {@link CACHE_LOCATIONS} is the one list of folders whose contents can be regenerated, and so
 * cleaned: each is measured as `caches`, and each entry in it is a cleanup item of its own, with
 * the check that says when it may go. A new cache folder joins the Storage page by being added
 * here through its own helper — the workbench cache folders `<agentDir>/app/cache/<id>/`
 * (PRFC-0028) once they ship, with a check that their workbench is not running; `app/data/` then
 * joins {@link agentParts} as Agent State, and the server's `run/` stays `other`.
 */
import path from "node:path";
import {
  agentDir,
  agentStateDir,
  scratchpadDir,
  sharedEnvDir,
  snapshotsDir,
  tracesDir,
  workspacesDir,
} from "@prismshadow/penguin-core";
import type { StorageBytes, StorageCategory, StorageCleanupKind } from "../api/storage-types.js";
import { agentStateRepoDir } from "../workbenches/repo.js";

/** The categories, in the order the page lists them. */
export const STORAGE_CATEGORIES: readonly StorageCategory[] = [
  "traces",
  "agentState",
  "workspaces",
  "scratchpads",
  "caches",
  "logs",
  "plugins",
  "other",
];

/** No bytes in any category. */
export function emptyBytes(): StorageBytes {
  return {
    traces: 0,
    agentState: 0,
    workspaces: 0,
    scratchpads: 0,
    caches: 0,
    logs: 0,
    plugins: 0,
    other: 0,
  };
}

/** Adds `b` into `a`, category by category. */
export function addBytes(a: StorageBytes, b: StorageBytes): void {
  for (const category of STORAGE_CATEGORIES) a[category] += b[category];
}

/** The folders of one Agent that hold one category whole, by absolute path. */
export function agentParts(
  root: string,
  projectId: string,
  agentId: string,
): Map<string, StorageCategory> {
  return new Map<string, StorageCategory>([
    [tracesDir(root, projectId, agentId), "traces"],
    [agentStateDir(root, projectId, agentId), "agentState"],
    [agentStateRepoDir(agentDir(root, projectId, agentId)), "agentState"],
    [snapshotsDir(root, projectId, agentId), "agentState"],
  ]);
}

/** The server's own top-level folders with a category of their own, by absolute path. */
export function serverParts(root: string): Map<string, StorageCategory> {
  return new Map<string, StorageCategory>([
    [path.join(root, "logs"), "logs"],
    [path.join(root, "plugins"), "plugins"],
  ]);
}

/** One Agent's folders whose entries a cleanup offers one by one: Session scratchpads, Workspaces. */
export function agentItemized(
  root: string,
  projectId: string,
  agentId: string,
): { scratchpads: string; workspaces: string } {
  return {
    scratchpads: scratchpadDir(root, projectId, agentId),
    workspaces: workspacesDir(root, projectId, agentId),
  };
}

/** What a cache location's check may ask. */
export interface CacheGuards {
  /** Whether any Session of the Agent is in use (the session runtime's agentInUse). */
  agentInUse(projectId: string, agentId: string): boolean;
}

/** Where a cache entry is: its Agent (agent locations), and its own name. */
export interface CacheEntryRef {
  projectId?: string;
  agentId?: string;
  name: string;
}

/** A folder whose entries can be regenerated. */
export interface CacheLocation {
  /** Names the location in a cleanup item's id; stable however the folder's path changes. */
  key: string;
  scope: "agent" | "server";
  kind: Extract<StorageCleanupKind, "agentCache" | "serverCache">;
  /** The folder: an Agent's (`agent`, with its Project and Agent) or the data root's (`server`). */
  dir(root: string, projectId?: string, agentId?: string): string;
  /** Whether the review ticks its entries to begin with. */
  selected: boolean;
  /** Whether an entry may not go right now. */
  inUse(guards: CacheGuards, entry: CacheEntryRef): boolean;
}

export const CACHE_LOCATIONS: readonly CacheLocation[] = [
  {
    // An Agent's reusable tool environments (the system prompt's `shared_env/<name>/`: virtual
    // environments, model and package caches). Any of the Agent's Sessions may be running a
    // command out of one, so an environment waits until none of them is in use. Not ticked to
    // begin with: the Agent reinstalls what it needs, which costs it time on its next run.
    key: "shared_env",
    scope: "agent",
    kind: "agentCache",
    dir: (root, projectId, agentId) => sharedEnvDir(root, projectId!, agentId!),
    selected: false,
    inUse: (guards, entry) =>
      entry.projectId !== undefined &&
      entry.agentId !== undefined &&
      guards.agentInUse(entry.projectId, entry.agentId),
  },
  {
    // The server's cache root: a dot-name no Project id can take, holding only what the server
    // fetches again when it is missing (the plugin market's pictures, PRFC-0027).
    key: ".cache",
    scope: "server",
    kind: "serverCache",
    dir: (root) => path.join(root, ".cache"),
    selected: true,
    inUse: () => false,
  },
];

/** The locations of one scope. */
export function cacheLocations(scope: CacheLocation["scope"]): CacheLocation[] {
  return CACHE_LOCATIONS.filter((location) => location.scope === scope);
}
