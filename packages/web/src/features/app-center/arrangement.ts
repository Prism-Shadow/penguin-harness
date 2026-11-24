/**
 * The App Center's arrangement: the viewer's stored layout laid over the shortcuts the server
 * lists, and the moves the grid makes on it. Pure, so the rules hold without a DOM.
 *
 * - The default grid starts with the standard system apps, then keeps the incoming order.
 * - A stored app that is no longer listed drops out; a listed app the layout does not name is
 *   appended at the end, in default grid order.
 * - A folder needs two members. Its last app takes its place. An unavailable member
 *   still counts until its catalog confirms removal.
 * - Folders do not nest: a folder dropped beside an app inside a folder lands beside that folder.
 *
 * An item's id is its app key (`<agentId>/<workbenchId>`, which always holds a `/`) or its
 * folder's id (which never does), so one string names either. An app of a machine's Agent is
 * keyed `<machineId>:<agentId>/<workbenchId>` (lib/app-center-path.ts): two machines' Agents
 * may share an id, and so may their workbenches. A system app is keyed `system_agent/<page key>`
 * and arranged like any other app.
 */
import type {
  AppCenterLayout,
  AppCenterLayoutItem,
  AppCenterShortcut,
} from "@prismshadow/penguin-server/api";

import { sessionWorkbenchAppKey } from "../../lib/session-workbenches";
import { SYSTEM_AGENT_ID } from "../../lib/builtin-agents";
import { locatedAppKey } from "../../lib/app-center-path";
import type { SystemShortcut } from "../../lib/system-apps";

/** A shortcut with the server it came from: absent `machineId` is this server. */
export interface LocatedShortcut extends AppCenterShortcut {
  machineId?: string;
  /** The machine's name, written under the tile's name. */
  machineLabel?: string;
  /** Its machine is out of reach, or did not answer the last read: shown, but not opened. */
  unavailable?: boolean;
  /**
   * A system app of the system Agent (system-tiles.ts), drawn with its page's glyph, never removed
   * from the grid. With a `frame` it opens in the App Center's window like any app, and `path` is
   * its full page; without one it opens its page at `path`, never a window.
   */
  system?: SystemShortcut;
}

/** Visible installations of one workbench offered by different Agents on the same machine. */
export function duplicateWorkbenchOwners(shortcuts: readonly LocatedShortcut[]): Set<string> {
  const groups = new Map<string, { owners: Set<string>; apps: string[] }>();
  for (const app of shortcuts) {
    if (app.system || (!app.plugin && !app.packageName)) continue;
    // Installed plugin contributions keep their own folder names under each Agent. A loose
    // workbench can be imported into different folders while retaining its package name.
    const identity = app.plugin
      ? ["plugin", app.plugin, app.workbenchId]
      : ["package", app.packageName];
    const key = JSON.stringify([app.machineId ?? null, ...identity]);
    const group = groups.get(key) ?? { owners: new Set<string>(), apps: [] };
    group.owners.add(app.agentId);
    group.apps.push(appKeyOf(app));
    groups.set(key, group);
  }
  return new Set(
    [...groups.values()].filter((group) => group.owners.size > 1).flatMap((group) => group.apps),
  );
}

/** An app's key in a layout: `<agentId>/<workbenchId>`, after `<machineId>:` for a machine's. */
export function appKeyOf(shortcut: {
  agentId: string;
  workbenchId: string;
  machineId?: string;
}): string {
  return locatedAppKey(shortcut.agentId, shortcut.workbenchId, shortcut.machineId);
}

export interface GridApp {
  type: "app";
  id: string;
  shortcut: LocatedShortcut;
}

export interface GridFolder {
  type: "folder";
  id: string;
  name: string;
  apps: GridApp[];
  /** Stored members whose catalog cannot establish whether they are still present. */
  unseen?: number;
}

export type GridItem = GridApp | GridFolder;

const defaultSystemKeys = ["models", "plugins", "machines", "usage", "benchmark"].map((key) =>
  locatedAppKey(SYSTEM_AGENT_ID, key),
);

/** The grid the viewer sees: the stored layout over the live shortcuts. */
export function arrange(
  shortcuts: readonly LocatedShortcut[],
  layout: AppCenterLayout | null,
  awaited: (key: string) => boolean = () => false,
): GridItem[] {
  const live = new Map(shortcuts.map((shortcut) => [appKeyOf(shortcut), shortcut] as const));
  const placed = new Set<string>();
  const take = (key: string): GridApp | null => {
    const shortcut = live.get(key);
    if (shortcut === undefined || placed.has(key)) return null;
    placed.add(key);
    return { type: "app", id: key, shortcut };
  };
  const out: GridItem[] = [];
  for (const item of layout?.items ?? []) {
    if (item.type === "app") {
      const app = take(item.app);
      if (app !== null) out.push(app);
      continue;
    }
    const apps = item.apps.map(take).filter((app): app is GridApp => app !== null);
    if (apps.length === 0) continue;
    const unseen = item.apps.filter((key) => !live.has(key) && awaited(key)).length;
    out.push(...folded({ type: "folder", id: item.id, name: item.name, apps, unseen }));
  }
  const first = defaultSystemKeys.filter((key) => live.get(key)?.system !== undefined);
  for (const key of [...first, ...live.keys()]) {
    const app = take(key);
    if (app !== null) out.push(app);
  }
  return out;
}

/** The survivor takes the folder's slot once the actual membership drops below two. */
function folded(folder: GridFolder): GridItem[] {
  // A temporarily unseen survivor needs the original slot until keepUnseenApps restores its key.
  if ((folder.unseen ?? 0) > 0) return [folder];
  return folder.apps.length < 2 ? folder.apps : [folder];
}

/** Persist only confirmed removals inside actual folders; discovery and filtering never reorder the rest. */
export function pruneFolderMembers(
  layout: AppCenterLayout,
  retained: (key: string) => boolean,
): AppCenterLayout {
  let changed = false;
  const items = layout.items.flatMap((item): AppCenterLayoutItem[] => {
    if (item.type === "app") return [item];
    const apps = item.apps.filter(retained);
    if (apps.length === item.apps.length && apps.length >= 2) return [item];
    changed = true;
    if (apps.length >= 2) return [{ ...item, apps }];
    return apps.map((app) => ({ type: "app", app }));
  });
  return changed ? { v: 1, items } : layout;
}

/** The layout that stores this grid. */
export function layoutOf(grid: readonly GridItem[]): AppCenterLayout {
  return {
    v: 1,
    items: grid.map((item): AppCenterLayoutItem =>
      item.type === "app"
        ? { type: "app", app: item.id }
        : { type: "folder", id: item.id, name: item.name, apps: item.apps.map((app) => app.id) },
    ),
  };
}

/**
 * Whether a stored app is one the grid cannot show yet, and the stored arrangement must keep
 * for it: an app of a machine that has not answered in this tab (and left nothing in it).
 * `machines` is every machine of the Project and whether it has answered; null while that list
 * is not known (it is still being read, or this account reads no machines), when every machine's
 * app is kept. An app of a machine the list no longer names is gone, and is not kept; nor is one
 * of this server's, which the grid always shows.
 */
export function appAwaited(
  key: string,
  machines: readonly { machineId: string; answered: boolean }[] | null,
): boolean {
  // Permissions and active modules determine the system tiles this viewer can see.
  if (key.startsWith(SYSTEM_AGENT_ID + "/")) {
    // Files is a conversation shortcut, including in builds that can still open its direct URL.
    return key !== SYSTEM_AGENT_ID + "/" + sessionWorkbenchAppKey("workspace");
  }
  if (!key.slice(0, key.indexOf("/")).includes(":")) return false;
  if (machines === null) return true;
  return machines.some((m) => !m.answered && key.startsWith(`${m.machineId}:`));
}

/**
 * The layout to store for a grid the viewer just arranged, with the apps it could not show put
 * back (`awaited`, see {@link appAwaited}): moving the tiles on screen must not drop the place
 * of a machine's tiles that have not arrived yet. Each goes back after the item it followed in
 * the stored layout — inside its folder when that folder is still there, first when nothing it
 * followed is left. A folder the viewer took apart leaves its awaited apps at the top level, after
 * its own apps, rather than coming back holding only those.
 */
export function keepUnseenApps(
  next: AppCenterLayout,
  previous: AppCenterLayout | null,
  awaited: (key: string) => boolean,
): AppCenterLayout {
  if (previous === null) return next;
  const items: AppCenterLayoutItem[] = next.items.map((item) =>
    item.type === "folder" ? { ...item, apps: [...item.apps] } : item,
  );
  const placed = new Set(items.flatMap((item) => (item.type === "app" ? [item.app] : item.apps)));
  const topIndex = (id: string) =>
    items.findIndex((item) => (item.type === "app" ? item.app : item.id) === id);
  /** Where at the top level something that followed `previous.items[before - 1]` goes. */
  const topAfter = (before: number) => {
    for (let i = before - 1; i >= 0; i--) {
      const item = previous.items[i]!;
      // A folder taken apart left its apps where it was: the last of them is what it was.
      const ids = item.type === "app" ? [item.app] : [item.id, ...[...item.apps].reverse()];
      for (const id of ids) {
        const at = topIndex(id);
        if (at >= 0) return at + 1;
      }
    }
    return 0;
  };
  previous.items.forEach((item, index) => {
    if (item.type === "app") {
      if (!awaited(item.app) || placed.has(item.app)) return;
      items.splice(topAfter(index), 0, { type: "app", app: item.app });
      placed.add(item.app);
      return;
    }
    const missing = item.apps.filter((app) => awaited(app) && !placed.has(app));
    if (missing.length === 0) return;
    const folder = items.find((entry) => entry.type === "folder" && entry.id === item.id);
    if (folder?.type === "folder") {
      for (const app of missing) {
        const was = item.apps.indexOf(app);
        let at = 0;
        for (let i = was - 1; i >= 0; i--) {
          const sibling = folder.apps.indexOf(item.apps[i]!);
          if (sibling >= 0) {
            at = sibling + 1;
            break;
          }
        }
        folder.apps.splice(at, 0, app);
        placed.add(app);
      }
      return;
    }
    // A folder with no visible members could not have been explicitly dissolved from the grid.
    if (missing.length === item.apps.length && missing.length > 1) {
      items.splice(topAfter(index), 0, { ...item, apps: missing });
      for (const app of missing) placed.add(app);
      return;
    }
    const own = [...item.apps].reverse().find((app) => topIndex(app) >= 0);
    const at = own === undefined ? topAfter(index) : topIndex(own) + 1;
    items.splice(at, 0, ...missing.map((app): AppCenterLayoutItem => ({ type: "app", app })));
    for (const app of missing) placed.add(app);
  });
  return pruneFolderMembers({ v: 1, items }, () => true);
}

/** Whether two grids store as the same layout (a move that changed nothing writes nothing). */
export function sameArrangement(a: readonly GridItem[], b: readonly GridItem[]): boolean {
  return JSON.stringify(layoutOf(a)) === JSON.stringify(layoutOf(b));
}

/** The folder an app sits in, or null at the top of the grid (or when no item has that id). */
export function folderOf(grid: readonly GridItem[], id: string): GridFolder | null {
  for (const item of grid) {
    if (item.type === "folder" && item.apps.some((app) => app.id === id)) return item;
  }
  return null;
}

/** The item with this id, wherever it sits. */
export function findItem(grid: readonly GridItem[], id: string): GridItem | null {
  for (const item of grid) {
    if (item.id === id) return item;
    if (item.type === "folder") {
      const app = item.apps.find((a) => a.id === id);
      if (app !== undefined) return app;
    }
  }
  return null;
}

/** Applies folder cardinality after a move is complete. */
function normalize(grid: readonly GridItem[]): GridItem[] {
  return grid.flatMap((item) => (item.type === "folder" ? folded(item) : [item]));
}

/** The grid without the item, and the item; folders are left as they are (normalize after). */
function detach(
  grid: readonly GridItem[],
  id: string,
): { rest: GridItem[]; item: GridItem | null } {
  let item: GridItem | null = null;
  const rest: GridItem[] = [];
  for (const entry of grid) {
    if (entry.id === id) {
      item = entry;
      continue;
    }
    if (entry.type === "folder") {
      const app = entry.apps.find((a) => a.id === id);
      if (app !== undefined) {
        item = app;
        rest.push({ ...entry, apps: entry.apps.filter((a) => a.id !== id) });
        continue;
      }
    }
    rest.push(entry);
  }
  return { rest, item };
}

export type Side = "before" | "after";

/**
 * Moves an item beside another: before or after it in the grid, or — when the target is an app
 * inside a folder — inside that folder at that place. A folder never goes into a folder: it lands
 * beside the folder that holds the target.
 */
export function moveBeside(
  grid: readonly GridItem[],
  id: string,
  targetId: string,
  side: Side,
): GridItem[] {
  if (id === targetId) return [...grid];
  const { rest, item } = detach(grid, id);
  if (item === null) return [...grid];
  const offset = side === "after" ? 1 : 0;
  const top = rest.findIndex((entry) => entry.id === targetId);
  if (top >= 0) {
    rest.splice(top + offset, 0, item);
    return normalize(rest);
  }
  const holder = rest.findIndex(
    (entry) => entry.type === "folder" && entry.apps.some((app) => app.id === targetId),
  );
  if (holder < 0) return [...grid];
  const folder = rest[holder] as GridFolder;
  if (item.type === "folder") {
    rest.splice(holder + offset, 0, item);
    return normalize(rest);
  }
  const at = folder.apps.findIndex((app) => app.id === targetId) + offset;
  const apps = [...folder.apps];
  apps.splice(at, 0, item);
  rest[holder] = { ...folder, apps };
  return normalize(rest);
}

/** Moves an item to the end of the grid, out of any folder. */
export function moveToEnd(grid: readonly GridItem[], id: string): GridItem[] {
  const { rest, item } = detach(grid, id);
  if (item === null) return [...grid];
  return normalize([...rest, item]);
}

/** Puts an app into a folder, at its end. A folder dropped on a folder changes nothing. */
export function moveIntoFolder(
  grid: readonly GridItem[],
  id: string,
  folderId: string,
): GridItem[] {
  const { rest, item } = detach(grid, id);
  if (item === null || item.type !== "app") return [...grid];
  const at = rest.findIndex((entry) => entry.type === "folder" && entry.id === folderId);
  if (at < 0) return [...grid];
  const folder = rest[at] as GridFolder;
  rest[at] = { ...folder, apps: [...folder.apps, item] };
  return normalize(rest);
}

/**
 * Makes a folder of two apps: `id` dropped onto `ontoId`, an app at the top of the grid. The
 * folder takes the place of the app it was dropped on, which comes first in it.
 */
export function makeFolder(
  grid: readonly GridItem[],
  id: string,
  ontoId: string,
  folder: { id: string; name: string },
): GridItem[] {
  if (id === ontoId) return [...grid];
  const { rest, item } = detach(grid, id);
  if (item === null || item.type !== "app") return [...grid];
  const at = rest.findIndex((entry) => entry.id === ontoId);
  const onto = rest[at];
  if (onto === undefined || onto.type !== "app") return [...grid];
  rest[at] = { type: "folder", id: folder.id, name: folder.name, apps: [onto, item] };
  return normalize(rest);
}

/**
 * Makes a folder of the apps `ids` names, wherever each sits now, in the grid's order: an app in
 * another folder leaves it. The folder takes the place of the first of them — its own place at
 * the top of the grid, or, for an app in a folder, that folder's place when the folder is left
 * empty and the place right after it otherwise. With none of the ids in the grid, nothing changes.
 */
export function groupApps(
  grid: readonly GridItem[],
  ids: readonly string[],
  folder: { id: string; name: string },
): GridItem[] {
  const picked = new Set(ids);
  const apps = grid
    .flatMap((item) => (item.type === "app" ? [item] : item.apps))
    .filter((app) => picked.has(app.id));
  const first = apps[0];
  if (first === undefined || apps.length < 2) return [...grid];
  const made: GridFolder = { type: "folder", id: folder.id, name: folder.name, apps };
  const out: GridItem[] = [];
  for (const item of grid) {
    if (item.type === "app") {
      if (item.id === first.id) out.push(made);
      else if (!picked.has(item.id)) out.push(item);
      continue;
    }
    const kept = item.apps.filter((app) => !picked.has(app.id));
    out.push(...folded({ ...item, apps: kept }));
    if (item.apps.some((app) => app.id === first.id)) out.push(made);
  }
  return out;
}

/** Takes an app out of its folder and puts it right after that folder. */
export function takeOutOfFolder(grid: readonly GridItem[], id: string): GridItem[] {
  const folder = folderOf(grid, id);
  if (folder === null) return [...grid];
  const { rest, item } = detach(grid, id);
  const at = rest.findIndex((entry) => entry.id === folder.id);
  rest.splice(at + 1, 0, item!);
  return normalize(rest);
}

/** Whether an item can move one step forward (-1) or backward (+1) within where it sits. */
export function canStep(grid: readonly GridItem[], id: string, delta: -1 | 1): boolean {
  const siblings: readonly GridItem[] = folderOf(grid, id)?.apps ?? grid;
  const at = siblings.findIndex((entry) => entry.id === id);
  return at >= 0 && at + delta >= 0 && at + delta < siblings.length;
}

/** Moves an item one step forward (-1) or backward (+1) within the grid or its folder. */
export function stepItem(grid: readonly GridItem[], id: string, delta: -1 | 1): GridItem[] {
  if (!canStep(grid, id, delta)) return [...grid];
  const swap = <T extends GridItem>(list: readonly T[]): T[] => {
    const out = [...list];
    const at = out.findIndex((entry) => entry.id === id);
    [out[at], out[at + delta]] = [out[at + delta]!, out[at]!];
    return out;
  };
  const folder = folderOf(grid, id);
  if (folder === null) return swap(grid);
  return grid.map((entry) =>
    entry.id === folder.id ? { ...folder, apps: swap(folder.apps) } : entry,
  );
}

export function renameFolder(
  grid: readonly GridItem[],
  folderId: string,
  name: string,
): GridItem[] {
  return grid.map((entry) =>
    entry.type === "folder" && entry.id === folderId ? { ...entry, name } : entry,
  );
}

/** Ungroups a folder: its apps take its place, in its order. */
export function dissolveFolder(grid: readonly GridItem[], folderId: string): GridItem[] {
  return grid.flatMap((entry) =>
    entry.type === "folder" && entry.id === folderId ? entry.apps : [entry],
  );
}

/** A folder id no item of the grid has: the layout's id rule, `[A-Za-z0-9_-]`, 1 to 32 long. */
export function newFolderId(grid: readonly GridItem[], random: () => number = Math.random): string {
  const taken = new Set(grid.map((item) => item.id));
  for (;;) {
    const id = `f${Math.floor(random() * 36 ** 8)
      .toString(36)
      .padStart(8, "0")}`;
    if (!taken.has(id)) return id;
  }
}
