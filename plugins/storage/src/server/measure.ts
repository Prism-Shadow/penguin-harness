/**
 * Measuring the data root, one unit at a time: a Project's folder, or the server's own entries.
 * What a unit holds is sorted into the categories of ./layout.ts, and the folders a cleanup
 * offers one by one — each Session's scratchpad, each Workspace, each entry of a cache location —
 * are kept measured on their own, with the newest change seen in each.
 *
 * A walk follows a plan of absolute paths, all built by the host's layout: the folders that
 * hold one category whole, the folders to itemize, and the folders another unit measures (to
 * skip). A folder on the way to a planned one is entered entry by entry, so a planned folder may
 * sit at any depth; everything else is measured whole in the category of the folder around it.
 *
 * Every call goes through the shared `FsLimiter` (./tree-size.ts), so a measurement never holds
 * more than its few filesystem calls in flight, however big the root.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { isValidId } from "@prismshadow/penguin-core/plugin";
import type { DataLayout } from "@prismshadow/penguin-server/plugin";
import type { StorageBytes, StorageCategory, StorageServerEntry } from "../types.js";
import {
  addBytes,
  agentItemized,
  agentParts,
  cacheLocations,
  emptyBytes,
  serverParts,
} from "./layout.js";
import {
  addSize,
  measureChildren,
  measureTree,
  readEntries,
  type MeasureOptions,
  type TreeSize,
} from "./tree-size.js";

/** Each entry of a cache location, by the location's `key` and then the entry's name. */
export type CacheEntries = Map<string, Map<string, TreeSize>>;

/** One Agent's folder. */
export interface AgentMeasure {
  agentId: string;
  bytes: number;
  categories: StorageBytes;
  /** Each Session scratchpad, by its folder name (the Session id). */
  scratchpads: Map<string, TreeSize>;
  /** Each temporary or Test Workspace, by name. */
  workspaces: Map<string, TreeSize>;
  caches: CacheEntries;
}

/** One Project's folder. */
export interface ProjectMeasure {
  projectId: string;
  bytes: number;
  categories: StorageBytes;
  agents: Map<string, AgentMeasure>;
}

/** The data root's entries that are not Projects. */
export interface ServerMeasure {
  bytes: number;
  categories: StorageBytes;
  entries: StorageServerEntry[];
  caches: CacheEntries;
}

/** The sum of a category record. */
export function totalOf(categories: StorageBytes): number {
  let sum = 0;
  for (const value of Object.values(categories)) sum += value;
  return sum;
}

/** A folder whose entries are measured one by one, and where their sizes go. */
interface Itemized {
  category: StorageCategory;
  keep(children: Map<string, TreeSize>): void;
}

/** What a walk follows: every path absolute, built by the host's layout. */
interface Plan {
  /** Folders another measurement covers: nothing of them is counted here. */
  skip: ReadonlySet<string>;
  /** Folders that hold one category whole. */
  parts: ReadonlyMap<string, StorageCategory>;
  itemized: ReadonlyMap<string, Itemized>;
}

/** Whether a planned path lies strictly below `abs`. */
function plannedBelow(abs: string, plan: Plan): boolean {
  const prefix = abs.endsWith(path.sep) ? abs : abs + path.sep;
  const below = (p: string) => p.startsWith(prefix);
  return (
    [...plan.skip].some(below) ||
    [...plan.parts.keys()].some(below) ||
    [...plan.itemized.keys()].some(below)
  );
}

/** Measures `abs` into `categories` by `plan`; `category` is what the folder around it holds. */
async function measurePlanned(
  abs: string,
  category: StorageCategory,
  plan: Plan,
  categories: StorageBytes,
  opts: MeasureOptions,
): Promise<TreeSize> {
  if (plan.skip.has(abs)) return { bytes: 0, newestMs: 0 };
  const itemized = plan.itemized.get(abs);
  if (itemized !== undefined) {
    const { total, children } = await measureChildren(abs, opts);
    categories[itemized.category] += total.bytes;
    itemized.keep(children);
    return total;
  }
  const own = plan.parts.get(abs) ?? category;
  if (plannedBelow(abs, plan)) {
    const st = await opts.limiter.run(() => fs.lstat(abs)).catch(() => null);
    if (st?.isDirectory()) {
      const total: TreeSize = { bytes: 0, newestMs: st.mtimeMs };
      for (const entry of await readEntries(abs, opts.limiter)) {
        addSize(
          total,
          await measurePlanned(path.join(abs, entry.name), own, plan, categories, opts),
        );
      }
      return total;
    }
  }
  const size = await measureTree(abs, opts);
  categories[own] += size.bytes;
  return size;
}

/** One Agent's folder. */
export async function measureAgent(
  layout: DataLayout,
  projectId: string,
  agentId: string,
  opts: MeasureOptions,
): Promise<AgentMeasure> {
  const categories = emptyBytes();
  let scratchpads = new Map<string, TreeSize>();
  let workspaces = new Map<string, TreeSize>();
  const caches: CacheEntries = new Map();
  const where = agentItemized(layout, projectId, agentId);
  const itemized = new Map<string, Itemized>([
    [where.scratchpads, { category: "scratchpads", keep: (c) => (scratchpads = c) }],
    [where.workspaces, { category: "workspaces", keep: (c) => (workspaces = c) }],
  ]);
  for (const location of cacheLocations("agent")) {
    itemized.set(location.dir(layout, projectId, agentId), {
      category: "caches",
      keep: (children) => caches.set(location.key, children),
    });
  }
  const plan: Plan = { skip: new Set(), parts: agentParts(layout, projectId, agentId), itemized };
  await measurePlanned(layout.agentDir(projectId, agentId), "other", plan, categories, opts);
  return {
    agentId,
    bytes: totalOf(categories),
    categories,
    scratchpads,
    workspaces,
    caches,
  };
}

/** The Agents of a Project on disk: the folders in its Agents folder named as ids. */
async function agentIds(
  layout: DataLayout,
  projectId: string,
  opts: MeasureOptions,
): Promise<string[]> {
  const ids: string[] = [];
  for (const entry of await readEntries(layout.agentsDir(projectId), opts.limiter)) {
    if (entry.isDirectory() && isValidId(entry.name)) ids.push(entry.name);
  }
  return ids.sort();
}

/**
 * One Project's folder: each of its Agents (the system Agent's holds the Benchmarks, in its
 * `app/data/`), and everything else — organizations, the config file, the Agents folder's
 * `.deleting/` — as `other`.
 */
export async function measureProject(
  layout: DataLayout,
  projectId: string,
  opts: MeasureOptions,
): Promise<ProjectMeasure> {
  const categories = emptyBytes();
  const agents = new Map<string, AgentMeasure>();
  const skip = new Set<string>();
  for (const agentId of await agentIds(layout, projectId, opts)) {
    const measured = await measureAgent(layout, projectId, agentId, opts);
    agents.set(agentId, measured);
    addBytes(categories, measured.categories);
    skip.add(layout.agentDir(projectId, agentId));
  }
  const plan: Plan = { skip, parts: new Map(), itemized: new Map() };
  await measurePlanned(layout.projectDir(projectId), "other", plan, categories, opts);
  return { projectId, bytes: totalOf(categories), categories, agents };
}

/**
 * The data root's entries other than the Projects (`projectIds`, which their own units measure):
 * each top-level entry's size and category, and the server cache locations' entries. The folder
 * the Projects sit in is an entry only when it holds something besides them, and a link left
 * where a Project's folder used to be is none.
 */
export async function measureServer(
  layout: DataLayout,
  projectIds: readonly string[],
  opts: MeasureOptions,
): Promise<ServerMeasure> {
  const categories = emptyBytes();
  const caches: CacheEntries = new Map();
  const itemized = new Map<string, Itemized>();
  for (const location of cacheLocations("server")) {
    itemized.set(location.dir(layout), {
      category: "caches",
      keep: (children) => caches.set(location.key, children),
    });
  }
  const parts = serverParts(layout);
  const plan: Plan = {
    skip: new Set(projectIds.map((id) => layout.projectDir(id))),
    parts,
    itemized,
  };
  const entries: StorageServerEntry[] = [];
  const root = layout.root();
  const projectsDir = layout.projectsDir();
  for (const entry of await readEntries(root, opts.limiter)) {
    const abs = path.join(root, entry.name);
    if (plan.skip.has(abs)) continue;
    // A Project's folder used to sit at the top level; a link stays there for old paths until
    // 1.0, and it is that Project's, not the server's.
    if (entry.isSymbolicLink() && projectIds.includes(entry.name)) continue;
    const category = itemized.get(abs)?.category ?? parts.get(abs) ?? "other";
    const size = await measurePlanned(abs, category, plan, categories, opts);
    // The folder the Projects sit in is the server's only for what it holds besides them.
    if (abs === projectsDir && size.bytes === 0) continue;
    entries.push({ name: entry.name, category, bytes: size.bytes });
  }
  entries.sort((a, b) => b.bytes - a.bytes || (a.name < b.name ? -1 : 1));
  return { bytes: totalOf(categories), categories, entries, caches };
}

/**
 * The Projects on disk: the folders named as ids where Projects are kept that the Project index
 * knows, or that hold a Project config file (one the CLI made).
 */
export async function listProjectDirs(
  layout: DataLayout,
  indexed: (projectId: string) => boolean,
  opts: MeasureOptions,
): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readEntries(layout.projectsDir(), opts.limiter)) {
    if (!entry.isDirectory() || !isValidId(entry.name)) continue;
    if (indexed(entry.name)) {
      found.push(entry.name);
      continue;
    }
    const config = layout.projectConfigPath(entry.name);
    const st = await opts.limiter.run(() => fs.lstat(config)).catch(() => null);
    if (st?.isFile()) found.push(entry.name);
  }
  return found.sort();
}
