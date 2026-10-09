/**
 * The Plugins page's rows, and how they are grouped and filtered (pure decisions, unit tested).
 *
 * Every plugin is one row and one card, whatever it carries: a library plugin (Skills and/or a
 * hook package, installed per Agent), a server module (installed on the server, listed per
 * Project), or a package that is both — a library plugin `x` and the module `@penguinharness/x`
 * are one row.
 *
 * Groups default to the plugin's category; the page can group by status or by what a plugin
 * carries instead, or not group at all, and three filters (category, contents, status) plus the
 * search box narrow the rows. The grouping and which groups are folded are remembered per
 * browser (`penguin.pluginsGroupBy`, `penguin.pluginsGroupsFolded`); the filters are not.
 */
import type {
  InstalledPluginsResponse,
  PluginGroupItem,
  PluginIndexEntry,
  PluginItem,
} from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import { localizedText } from "../chat/skill-use";
import { PLUGIN_STATUSES, type ModuleState, type PluginStatus } from "./plugin-status";

/** The server-module side of a row: the package a Project lists, or could. */
export interface ModulePart {
  /** The package specifier a Project's `[plugins]` table names. */
  specifier: string;
  /** Its registry entry, when an index lists it. */
  entry: PluginIndexEntry | undefined;
  state: ModuleState;
  /** Why the process could not load it, when `state` is `failed`. */
  error?: string;
  /** The build ships it: installing it downloads nothing. */
  shipped: boolean;
  /** The machines it is listed for, by name, when the shared table does not list it. */
  onlyOn?: string[];
  /** Why Remove is unavailable in this view, when it is. */
  removeBlocked?: string;
}

/** One plugin of the page. */
export interface PluginRow {
  /** Identity on the page: `library:<name>`, or `module:<specifier>` for a module-only row. */
  key: string;
  /** What the card and the dialog call it: the library name, or the unscoped package name. */
  name: string;
  /** The category the row is grouped and filtered by: a library category id, `sandbox` or `other`. */
  category: string;
  library?: PluginItem;
  module?: ModulePart;
}

/** The display name of a package: its name without the scope. */
export function unscopedName(specifier: string): string {
  return specifier.replace(/^@[^/]+\//, "");
}

/**
 * Which machine the page shows: `machineId` null for all machines (the shared table), or a
 * machine's own id. `remote` is that machine's own answer when it is not this server — what it
 * actually runs — and null when it is this server or could not be read.
 */
export interface PluginView {
  machineId: string | null;
  remote: InstalledPluginsResponse | null;
  /** A machine's display name, by its own id. */
  nameOf: (machineId: string) => string;
}

export const ALL_MACHINES: PluginView = { machineId: null, remote: null, nameOf: (id) => id };

/** Whether a listed plugin belongs in the view: shared, or listed for the machine in view. */
function inView(listed: InstalledPluginsResponse["plugins"][number], view: PluginView): boolean {
  return (
    view.machineId === null ||
    listed.everywhere !== false ||
    (listed.machines ?? []).includes(view.machineId)
  );
}

/** A listed plugin's state as the machine in view has it. */
function stateIn(
  listed: InstalledPluginsResponse["plugins"][number],
  view: PluginView,
  selfId: string | undefined,
): { state: ModuleState; error?: string } {
  const local = (row: InstalledPluginsResponse["plugins"][number]) =>
    row.active
      ? { state: "active" as const }
      : row.error !== undefined
        ? { state: "failed" as const, error: row.error }
        : { state: "pending" as const };
  if (view.machineId === null)
    return listed.here === false ? { state: "elsewhere" } : local(listed);
  if (view.machineId === selfId) return local(listed);
  const there = view.remote?.plugins.find((p) => p.specifier === listed.specifier);
  return there === undefined ? { state: "unsynced" } : local(there);
}

/**
 * The server modules of the page, as the machine in view has them: first what this Project
 * lists (each with its registry entry when an index has one), then what it could ask for — the
 * registry's entries it does not list, and what the build ships that no index knows (offered
 * without a description: the build has it, so it installs without a download).
 */
export function moduleParts(
  deployment: InstalledPluginsResponse | null,
  index: readonly PluginIndexEntry[],
  view: PluginView = ALL_MACHINES,
): ModulePart[] {
  const parts: ModulePart[] = [];
  for (const listed of deployment?.plugins ?? []) {
    if (!inView(listed, view)) continue;
    const shared = listed.everywhere !== false;
    const ownTable = view.machineId !== null && (listed.machines ?? []).includes(view.machineId);
    parts.push({
      specifier: listed.specifier,
      entry: index.find((e) => e.name === listed.specifier),
      ...stateIn(listed, view, deployment?.machineId),
      shipped:
        listed.builtin || (view.remote ?? deployment)?.shipped.includes(listed.specifier) === true,
      ...(shared ? {} : { onlyOn: (listed.machines ?? []).map(view.nameOf) }),
      // A machine's view edits that machine's own table; a shared entry is not in it.
      ...(view.machineId !== null && shared && !ownTable
        ? { removeBlocked: S.plugins.sharedCannotRemove }
        : {}),
    });
  }
  // What the machine in view does not run yet: in the all-machines view, anything the shared
  // table lacks — a plugin listed for some machines is still offered for all of them.
  const listed = new Set(
    (deployment?.plugins ?? [])
      .filter((p) => (view.machineId === null ? p.everywhere !== false : inView(p, view)))
      .map((p) => p.specifier),
  );
  const shippedList = (view.remote ?? deployment)?.shipped ?? [];
  const seen = new Set(parts.map((p) => p.specifier));
  for (const entry of index) {
    if (listed.has(entry.name) || seen.has(entry.name)) continue;
    seen.add(entry.name);
    parts.push({
      specifier: entry.name,
      entry,
      state: "none",
      shipped: shippedList.includes(entry.name),
    });
  }
  for (const name of shippedList) {
    if (listed.has(name) || seen.has(name)) continue;
    seen.add(name);
    parts.push({ specifier: name, entry: undefined, state: "none", shipped: true });
  }
  return parts;
}

/**
 * Every row of the page: the library's plugins under the category their group gave them, and
 * the server modules under the first category of their index entry the page knows (else
 * `other`). A module whose package is a library plugin's (its `package`) joins that plugin's row.
 */
export function pluginRows(
  groups: readonly PluginGroupItem[],
  modules: readonly ModulePart[],
): PluginRow[] {
  const rows: PluginRow[] = [];
  const byPackage = new Map<string, PluginRow>();
  for (const group of groups) {
    for (const plugin of group.plugins) {
      const row: PluginRow = {
        key: `library:${plugin.name}`,
        name: plugin.name,
        category: group.id,
        library: plugin,
      };
      rows.push(row);
      byPackage.set(plugin.package, row);
    }
  }
  const known = new Set([...groups.map((g) => g.id), SANDBOX_CATEGORY]);
  for (const part of modules) {
    const both = byPackage.get(part.specifier);
    if (both !== undefined) {
      both.module = part;
      continue;
    }
    rows.push({
      key: `module:${part.specifier}`,
      name: unscopedName(part.specifier),
      category: (part.entry?.categories ?? []).find((c) => known.has(c)) ?? OTHER_CATEGORY,
      module: part,
    });
  }
  return rows;
}

/** The category of the sandbox backends, which no library plugin needs to fill. */
export const SANDBOX_CATEGORY = "sandbox";
const OTHER_CATEGORY = "other";

/**
 * The categories in display order with their titles in the UI language: the library's, in the
 * order the server sends them, then Agent Sandbox, then Other last.
 */
export function pluginCategories(
  groups: readonly PluginGroupItem[],
  locale: "zh" | "en",
): { id: string; title: string }[] {
  const title = (id: string, fallback: string) => {
    const group = groups.find((g) => g.id === id);
    return group === undefined ? fallback : localizedText(locale, group.title, group.titleZh);
  };
  return [
    ...groups
      .filter((g) => g.id !== SANDBOX_CATEGORY && g.id !== OTHER_CATEGORY)
      .map((g) => ({ id: g.id, title: localizedText(locale, g.title, g.titleZh) })),
    { id: SANDBOX_CATEGORY, title: title(SANDBOX_CATEGORY, S.plugins.sandboxCategory) },
    { id: OTHER_CATEGORY, title: title(OTHER_CATEGORY, S.plugins.otherCategory) },
  ];
}

/** What a plugin carries: the payloads the "contents" filter and grouping name. */
export const PLUGIN_KINDS = ["skills", "hooks", "modules"] as const;
export type PluginKind = (typeof PLUGIN_KINDS)[number];

/** Everything a row carries. */
export function rowKinds(row: PluginRow): PluginKind[] {
  const kinds: PluginKind[] = [];
  if ((row.library?.skills.length ?? 0) > 0) kinds.push("skills");
  if ((row.library?.hooks.length ?? 0) > 0) kinds.push("hooks");
  if (row.module !== undefined) kinds.push("modules");
  return kinds;
}

/** The one kind a row is grouped under: a server module first, then Skills, then hooks. */
export function primaryKind(row: PluginRow): PluginKind {
  if (row.module !== undefined) return "modules";
  return (row.library?.skills.length ?? 0) > 0 ? "skills" : "hooks";
}

/** The filters' choices; "" is "all". */
export interface PluginFilters {
  category: string;
  kind: PluginKind | "";
  status: PluginStatus | "";
}
export const NO_FILTERS: PluginFilters = { category: "", kind: "", status: "" };

/** Whether a row passes the filters and the search box (its names, descriptions and keywords). */
export function rowMatches(
  row: PluginRow,
  status: PluginStatus,
  filters: PluginFilters,
  query: string,
): boolean {
  if (filters.category !== "" && row.category !== filters.category) return false;
  if (filters.kind !== "" && !rowKinds(row).includes(filters.kind)) return false;
  if (filters.status !== "" && status !== filters.status) return false;
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  const plugin = row.library;
  const entry = row.module?.entry;
  const text = [
    row.name,
    plugin?.description,
    plugin?.descriptionZh,
    plugin?.shortDescription,
    plugin?.shortDescriptionZh,
    row.module?.specifier,
    entry?.description,
    entry?.descriptionZh,
    entry?.shortDescription,
    entry?.shortDescriptionZh,
    ...(entry?.keywords ?? []),
  ]
    .filter((t): t is string => t !== undefined)
    .join(" ");
  return text.toLowerCase().includes(q);
}

/** How the rows are grouped. */
export const PLUGIN_GROUP_BYS = ["category", "status", "kind", "none"] as const;
export type PluginGroupBy = (typeof PLUGIN_GROUP_BYS)[number];

/** One section of the page; `none` makes one untitled group of everything. */
export interface PluginGroup {
  id: string;
  title: string;
  rows: PluginRow[];
}

/**
 * The rows in sections: by category in the categories' order, by status in PLUGIN_STATUSES
 * order (what wants a look first), by what a plugin carries (Skills, hooks, server modules), or
 * one untitled section. A section with no rows is left out; rows are in name order.
 */
export function groupRows(
  rows: readonly PluginRow[],
  statusOf: (row: PluginRow) => PluginStatus,
  by: PluginGroupBy,
  categories: readonly { id: string; title: string }[],
): PluginGroup[] {
  const sorted = [...rows].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const sections: { id: string; title: string; keep: (row: PluginRow) => boolean }[] =
    by === "category"
      ? categories.map((c) => ({ ...c, keep: (row) => row.category === c.id }))
      : by === "status"
        ? PLUGIN_STATUSES.map((s) => ({
            id: s,
            title: S.plugins.status[s],
            keep: (row) => statusOf(row) === s,
          }))
        : by === "kind"
          ? PLUGIN_KINDS.map((k) => ({
              id: k,
              title: S.plugins.kindLabel[k],
              keep: (row) => primaryKind(row) === k,
            }))
          : [{ id: "all", title: "", keep: () => true }];
  return sections
    .map(({ id, title, keep }) => ({ id, title, rows: sorted.filter(keep) }))
    .filter((group) => group.rows.length > 0);
}

/** Minimal storage interface (the subset of localStorage used here); tests inject an in-memory one. */
export interface PluginsPageStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const PLUGINS_GROUP_BY_KEY = "penguin.pluginsGroupBy";
export const PLUGINS_GROUPS_FOLDED_KEY = "penguin.pluginsGroupsFolded";

/**
 * The grouping this browser last chose; category when nothing usable is stored, or storage
 * throws (it does where site data is blocked — `localStorage` is touched inside the try).
 */
export function initialPluginsGroupBy(storage?: PluginsPageStorage): PluginGroupBy {
  try {
    const stored = (storage ?? localStorage).getItem(PLUGINS_GROUP_BY_KEY);
    return PLUGIN_GROUP_BYS.find((by) => by === stored) ?? "category";
  } catch {
    return "category";
  }
}

/** Remembers the grouping (best-effort: quota limits / private browsing fail silently). */
export function storePluginsGroupBy(by: PluginGroupBy, storage?: PluginsPageStorage): void {
  try {
    (storage ?? localStorage).setItem(PLUGINS_GROUP_BY_KEY, by);
  } catch {
    /* best-effort persistence */
  }
}

/** A section's fold key: the grouping and the section, so a status section never folds a category. */
export const foldKey = (by: PluginGroupBy, id: string): string => `${by}:${id}`;

/** The sections this browser folded, as fold keys; none when nothing usable is stored. */
export function initialFoldedGroups(storage?: PluginsPageStorage): Set<string> {
  try {
    const parsed: unknown = JSON.parse(
      (storage ?? localStorage).getItem(PLUGINS_GROUPS_FOLDED_KEY) ?? "[]",
    );
    return new Set(
      Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === "string") : [],
    );
  } catch {
    return new Set();
  }
}

/** Remembers the folded sections (best-effort, like the grouping). */
export function storeFoldedGroups(folded: ReadonlySet<string>, storage?: PluginsPageStorage): void {
  try {
    (storage ?? localStorage).setItem(PLUGINS_GROUPS_FOLDED_KEY, JSON.stringify([...folded]));
  } catch {
    /* best-effort persistence */
  }
}
