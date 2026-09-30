/**
 * The Workspace finder's decisions, kept apart from the modal so they are testable without a
 * DOM: path breadcrumbs, back/forward history, what the list shows and in which order,
 * type-to-select, the sidebar's places (Quick access, with the user's own additions and
 * removals), the context menu's items, the keyboard map, what the box for a folder the
 * server may not read offers, and the footer's no-folder button.
 *
 * Paths come from whichever machine is being browsed, so nothing here asks the browser's own
 * platform about a path — a Windows server's `C:\Users\me` and a Linux one's `/home/me` both
 * have to split correctly in the same tab.
 */
import type {
  DesktopPrivacyPane,
  DirEntryInfo,
  DirListResponse,
} from "@prismshadow/penguin-server/api";
import {
  TEMP_WORKSPACE_GROUP_KEY,
  isTempWorkspace,
  workspaceGroupMachine,
  workspaceGroupPath,
} from "../../lib/session-grouping";

/** A path the dirs API accepts as-is: posix absolute, a drive path, or a UNC share. */
export function isAbsoluteDirPath(path: string): boolean {
  return /^\//.test(path) || /^[A-Za-z]:[\\/]/.test(path) || /^\\\\[^\\]/.test(path);
}

/** One clickable breadcrumb: the label shown, and the absolute path it opens. */
export interface Crumb {
  label: string;
  path: string;
}

/**
 * The segments of an absolute path, root first, each carrying the path up to and including
 * it. The root keeps its own spelling (`/`, `C:\`, `\\server\share\`) because every other
 * segment is joined onto it with the separator that root implies.
 */
export function splitBreadcrumbs(path: string): Crumb[] {
  const p = path.trim();
  if (p === "") return [];
  let root: string;
  let rest: string;
  let sep: string;
  const unc = /^(\\\\[^\\]+\\[^\\]+)\\?(.*)$/.exec(p);
  const drive = /^([A-Za-z]:)[\\/]?(.*)$/.exec(p);
  if (unc) {
    root = `${unc[1]}\\`;
    rest = unc[2] ?? "";
    sep = "\\";
  } else if (drive) {
    root = `${drive[1]}\\`;
    rest = drive[2] ?? "";
    sep = "\\";
  } else {
    root = "/";
    rest = p.replace(/^\/+/, "");
    sep = "/";
  }
  const crumbs: Crumb[] = [{ label: root === "/" ? "/" : root.replace(/\\$/, ""), path: root }];
  let acc = root;
  for (const part of rest.split(/[\\/]+/).filter(Boolean)) {
    acc = acc.endsWith(sep) ? `${acc}${part}` : `${acc}${sep}${part}`;
    crumbs.push({ label: part, path: acc });
  }
  return crumbs;
}

/** The folder above `path`, or null at a root — for a folder that failed to load, whose listing (and its `parent`) never arrived. */
export function parentOf(path: string): string | null {
  const crumbs = splitBreadcrumbs(path);
  return crumbs.length > 1 ? (crumbs[crumbs.length - 2]?.path ?? null) : null;
}

/** The last segment of a path, for a label and for picking a folder out of its parent. */
export function baseName(path: string): string {
  const crumbs = splitBreadcrumbs(path);
  return crumbs[crumbs.length - 1]?.label ?? path;
}

/** The separator a path's own family uses: a drive path or a UNC share splits on `\`. */
function separatorOf(path: string): string {
  return /^[A-Za-z]:|^\\\\/.test(path) ? "\\" : "/";
}

/** The last `count` segments of a path behind an ellipsis (`…/workspaces/tmp-…`); a shorter path as it is. */
export function pathTail(path: string, count: number): string {
  const segments = splitBreadcrumbs(path)
    .slice(1)
    .map((c) => c.label);
  if (segments.length <= count) return path;
  const sep = separatorOf(path);
  return `…${sep}${segments.slice(-count).join(sep)}`;
}

/** Back/forward history: the visited folders and where in them the finder stands. */
export interface NavHistory {
  entries: string[];
  index: number;
}

export const EMPTY_HISTORY: NavHistory = { entries: [], index: -1 };

/**
 * Visiting a folder: anything ahead of the current position is dropped, as in a browser. A
 * reload of the folder already shown is not a visit, or Back would have to be pressed twice.
 */
export function historyVisit(h: NavHistory, path: string): NavHistory {
  if (h.entries[h.index] === path) return h;
  const entries = [...h.entries.slice(0, h.index + 1), path];
  return { entries, index: entries.length - 1 };
}

/** One step back or forward; the same history when there is nowhere to go. */
export function historyStep(h: NavHistory, delta: -1 | 1): NavHistory {
  const index = h.index + delta;
  if (index < 0 || index >= h.entries.length) return h;
  return { entries: h.entries, index };
}

export const canGoBack = (h: NavHistory): boolean => h.index > 0;
export const canGoForward = (h: NavHistory): boolean => h.index < h.entries.length - 1;

/** Whether an entry is a folder: an entry with no kind came from a listing that reports folders only. */
export const isFolder = (entry: DirEntryInfo): boolean => entry.kind !== "file";

/**
 * What the list shows: hidden entries dropped, the filter applied (case-insensitive
 * substring), folders first and then by name.
 */
export function visibleEntries(entries: readonly DirEntryInfo[], filter: string): DirEntryInfo[] {
  const q = filter.trim().toLowerCase();
  return entries
    .filter((e) => !e.name.startsWith("."))
    .filter((e) => q === "" || e.name.toLowerCase().includes(q))
    .sort((a, b) => {
      const fa = isFolder(a);
      if (fa !== isFolder(b)) return fa ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

/**
 * Type-to-select: the first selectable entry whose name starts with what has been typed,
 * ignoring case. Only folders can be selected, so a file never catches the prefix. -1 when
 * nothing matches, so the selection stays where it was.
 */
export function typeSelectIndex(entries: readonly DirEntryInfo[], typed: string): number {
  const q = typed.toLowerCase();
  if (q === "") return -1;
  return entries.findIndex((e) => isFolder(e) && e.name.toLowerCase().startsWith(q));
}

/**
 * The next selectable row from `from` in direction `delta`, skipping files; -1 when there is
 * none. From no selection (-1), Down lands on the first folder and Up on the last.
 */
export function stepSelection(
  entries: readonly DirEntryInfo[],
  from: number,
  delta: -1 | 1,
): number {
  let i = from === -1 ? (delta === 1 ? 0 : entries.length - 1) : from + delta;
  for (; i >= 0 && i < entries.length; i += delta) {
    const entry = entries[i];
    if (entry !== undefined && isFolder(entry)) return i;
  }
  return from;
}

/** A standard folder that a platform's own file manager lists in its sidebar. */
export type StandardFolder = "desktop" | "documents" | "downloads" | "pictures";

/** A sidebar place. `key` picks its icon (and a standard folder's label); `path` is what clicking it opens. */
export interface Place {
  key: "home" | StandardFolder | "drive" | "folder";
  path: string;
  /** The label for places named by their path: home by its folder name, a drive by its letter, an added folder by its name. */
  label: string;
}

/** The three families of Quick access defaults. */
export type QuickAccessPlatform = "win32" | "darwin" | "linux";

/**
 * Anything other than Windows and macOS reads as Linux — including a machine browsed over ssh,
 * which reports no platform at all and is nearly always a Linux server.
 */
export function quickAccessPlatform(platform: string | undefined): QuickAccessPlatform {
  return platform === "win32" || platform === "darwin" ? platform : "linux";
}

/**
 * Each platform's standard folders, in the order its own file manager lists them: Explorer's
 * Quick access pins Desktop, Downloads, Documents and Pictures; Finder's Favourites list
 * Desktop, Documents and Downloads; a Linux desktop's Files shows the XDG folders Desktop,
 * Documents, Downloads and Pictures. Media-only folders (Music, Videos) and Applications are
 * left out — none of them is somewhere a Workspace lives.
 */
const STANDARD_FOLDERS: Record<
  QuickAccessPlatform,
  ReadonlyArray<readonly [StandardFolder, string]>
> = {
  win32: [
    ["desktop", "Desktop"],
    ["downloads", "Downloads"],
    ["documents", "Documents"],
    ["pictures", "Pictures"],
  ],
  darwin: [
    ["desktop", "Desktop"],
    ["documents", "Documents"],
    ["downloads", "Downloads"],
  ],
  linux: [
    ["desktop", "Desktop"],
    ["documents", "Documents"],
    ["downloads", "Downloads"],
    ["pictures", "Pictures"],
  ],
};

/**
 * Quick access as the machine offers it before the user changes anything, from that machine's
 * own home listing: home itself, then the platform's standard folders that exist there. The
 * home listing is the source rather than a guessed path because only that machine knows
 * whether the folder is there (a Linux server without a desktop has none of them). Windows
 * matches the names ignoring case, as its filesystem does.
 */
export function defaultPlaces(home: DirListResponse | null): Place[] {
  if (home === null) return [];
  const platform = quickAccessPlatform(home.platform);
  const places: Place[] = [{ key: "home", path: home.path, label: baseName(home.path) }];
  for (const [key, name] of STANDARD_FOLDERS[platform]) {
    const found = home.entries.find(
      (e) =>
        isFolder(e) &&
        (platform === "win32" ? e.name.toLowerCase() === name.toLowerCase() : e.name === name),
    );
    if (found !== undefined) places.push({ key, path: found.path, label: found.name });
  }
  return places;
}

/** Windows' drive roots, for the This PC section; nothing on other platforms. */
export function drivePlaces(home: DirListResponse | null): Place[] {
  return (home?.roots ?? []).map((root) => ({
    key: "drive",
    path: root,
    label: root.replace(/\\$/, ""),
  }));
}

/** What the user changed in one machine's Quick access. */
export interface QuickAccessEdits {
  /** Folders the user added, oldest first. */
  added: string[];
  /** Default places the user removed. */
  removed: string[];
}

export const NO_EDITS: QuickAccessEdits = { added: [], removed: [] };

/**
 * Quick access as shown: the defaults the user kept, in their own order, then the folders the
 * user added. Kept as edits against the defaults rather than as a stored list, so a standard
 * folder that appears on the machine later still turns up unless it was removed.
 */
export function quickAccessPlaces(defaults: readonly Place[], edits: QuickAccessEdits): Place[] {
  const shown = defaults.filter((p) => !edits.removed.includes(p.path));
  for (const path of edits.added) {
    if (!shown.some((p) => p.path === path))
      shown.push({ key: "folder", path, label: baseName(path) });
  }
  return shown;
}

/** Adds a folder: a removed default comes back in its own place; anything else joins the end. */
export function addToQuickAccess(
  edits: QuickAccessEdits,
  defaults: readonly Place[],
  path: string,
): QuickAccessEdits {
  if (defaults.some((p) => p.path === path)) {
    return edits.removed.includes(path)
      ? { ...edits, removed: edits.removed.filter((p) => p !== path) }
      : edits;
  }
  return edits.added.includes(path) ? edits : { ...edits, added: [...edits.added, path] };
}

/** Removes a folder: an added one is forgotten, a default one is remembered as removed. */
export function removeFromQuickAccess(
  edits: QuickAccessEdits,
  defaults: readonly Place[],
  path: string,
): QuickAccessEdits {
  const added = edits.added.filter((p) => p !== path);
  const hide = defaults.some((p) => p.path === path) && !edits.removed.includes(path);
  if (added.length === edits.added.length && !hide) return edits;
  return { added, removed: hide ? [...edits.removed, path] : edits.removed };
}

/** Minimal storage interface (the subset of localStorage used here); tests inject an in-memory one. */
export interface QuickAccessStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Storage key of one machine's Quick access edits. Per machine because a path means something
 * only on the machine it is on; `local` is the server serving this page, whose paths no other
 * machine shares.
 */
export const quickAccessKey = (machineId: string | null): string =>
  `penguin.finderQuickAccess.${machineId ?? "local"}`;

/** One machine's edits; nothing stored, or anything unreadable, is no edits at all. */
export function loadQuickAccess(
  machineId: string | null,
  storage?: QuickAccessStorage,
): QuickAccessEdits {
  try {
    // Resolved inside the try: touching localStorage throws when site data is blocked.
    const raw: unknown = JSON.parse(
      (storage ?? localStorage).getItem(quickAccessKey(machineId)) ?? "null",
    );
    if (typeof raw !== "object" || raw === null) return NO_EDITS;
    const paths = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x !== "") : [];
    const record = raw as Record<string, unknown>;
    return { added: paths(record.added), removed: paths(record.removed) };
  } catch {
    return NO_EDITS;
  }
}

/** Writes one machine's edits (best-effort: quota limits and blocked storage fail silently). */
export function saveQuickAccess(
  machineId: string | null,
  edits: QuickAccessEdits,
  storage?: QuickAccessStorage,
): void {
  try {
    (storage ?? localStorage).setItem(quickAccessKey(machineId), JSON.stringify(edits));
  } catch {
    /* best-effort persistence */
  }
}

/**
 * What a secondary click landed on: a folder (a list row or a sidebar place), a file row, or
 * the list's empty space, which stands for the folder on screen.
 */
export interface FinderMenuTarget {
  kind: "folder" | "file" | "here";
  path: string;
  /** The machine the path is on (null: this server) — a Recent entry may be on another one. */
  machine: string | null;
}

export type FinderMenuItem =
  "open" | "choose" | "addToQuickAccess" | "removeFromQuickAccess" | "copyPath" | "refresh";

/**
 * The context menu's rows, the way Explorer orders them: what opening the thing does first,
 * then choosing it, then Quick access, then copying its path. A file row only copies (files
 * are listed for context and cannot be picked); the empty space acts on the open folder, and
 * adds Refresh as Explorer's background menu does.
 */
export function finderMenuItems(
  target: FinderMenuTarget,
  inQuickAccess: boolean,
): FinderMenuItem[] {
  if (target.kind === "file") return ["copyPath"];
  const quick = inQuickAccess ? "removeFromQuickAccess" : "addToQuickAccess";
  return target.kind === "here"
    ? ["choose", quick, "copyPath", "refresh"]
    : ["open", "choose", quick, "copyPath"];
}

/** A Workspace recently used in this Project, and the machine it is on (null: this server). */
export interface RecentWorkspace {
  path: string;
  machineId: string | null;
  /** Newest Session's createdAt there — what orders the list. */
  at: string;
}

/**
 * Recent Workspaces, newest first: the Sessions list already reports, per Agent, each
 * Workspace's newest Session (keyed by machine and path), so this folds those stamps across
 * Agents. Temporary Workspaces are left out — they are made per conversation and are never
 * worth picking again. `machines` restricts the list to the machines the finder may browse.
 */
export function recentWorkspaces(
  latestByAgent: ReadonlyMap<string, Readonly<Record<string, string>>>,
  machines: (machineId: string | null) => boolean,
  limit = 6,
): RecentWorkspace[] {
  const newest = new Map<string, RecentWorkspace>();
  for (const byGroup of latestByAgent.values()) {
    for (const [groupKey, at] of Object.entries(byGroup)) {
      const path = workspaceGroupPath(groupKey);
      if (path === TEMP_WORKSPACE_GROUP_KEY || isTempWorkspace(path)) continue;
      const machineId = workspaceGroupMachine(groupKey);
      if (!machines(machineId)) continue;
      const held = newest.get(groupKey);
      if (held === undefined || held.at < at) newest.set(groupKey, { path, machineId, at });
    }
  }
  return [...newest.values()]
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, limit);
}

/**
 * "Go to folder" input → the path to load: `~` and `~/…` resolve against the machine's home
 * when it is known (the dirs API takes absolute paths only); anything else is sent as typed
 * and the server decides.
 */
export function resolveGoTo(input: string, home: string | null): string {
  const p = input.trim();
  if (home === null) return p;
  if (p === "~") return home;
  const m = /^~[\\/](.*)$/.exec(p);
  if (m === null) return p;
  const sep = /^[A-Za-z]:|^\\\\/.test(home) ? "\\" : "/";
  return home.endsWith(sep) ? `${home}${m[1]}` : `${home}${sep}${m[1]}`;
}

/** What a key press asks the finder to do. */
export type FinderAction =
  "up" | "down" | "first" | "last" | "open" | "parent" | "back" | "forward" | "goto" | "choose";

/** The keyboard-event fields the map reads (a subset of KeyboardEvent, for tests). */
export type FinderKey = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">;

/**
 * The finder's keyboard map. The modifier is ⌘ on a Mac and Ctrl elsewhere, so the Finder
 * chords (⌘↑ parent, ⌘↓ open, ⌘[ / ⌘] back and forward, ⌘⇧G type a path into the address
 * bar) read the same on every platform; Alt+arrows are accepted too off the Mac, where
 * Explorer and the browsers taught them. Plain arrows, Home/End and Enter are list keys — `inList` is false
 * for a text field, where they belong to the field (Up/Down excepted: the filter box steers
 * the list the way a combobox does).
 */
export function finderKeyAction(
  e: FinderKey,
  isMac: boolean,
  inList: boolean,
): FinderAction | null {
  const mod = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  const bare = !e.metaKey && !e.ctrlKey && !e.altKey;
  if (mod && e.shiftKey && !e.altKey && (e.key === "g" || e.key === "G")) return "goto";
  if (mod && !e.shiftKey && !e.altKey) {
    if (e.key === "ArrowUp") return "parent";
    if (e.key === "ArrowDown") return "open";
    if (e.key === "[") return "back";
    if (e.key === "]") return "forward";
    if (e.key === "Enter") return "choose";
  }
  if (!isMac && e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
    if (e.key === "ArrowLeft") return "back";
    if (e.key === "ArrowRight") return "forward";
    if (e.key === "ArrowUp") return "parent";
  }
  if (!bare || e.shiftKey) return null;
  if (e.key === "ArrowDown") return "down";
  if (e.key === "ArrowUp") return "up";
  if (!inList) return null;
  if (e.key === "Home") return "first";
  if (e.key === "End") return "last";
  if (e.key === "Enter") return "open";
  return null;
}

/** Whether a key press is a character to feed type-to-select: one printable character, no modifier. */
export function isTypeSelectKey(e: FinderKey): boolean {
  return e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey;
}

/** How long type-to-select keeps adding to what was typed before starting over. */
export const TYPE_SELECT_RESET_MS = 900;

/**
 * Where the "Allow access" exchange for a refused folder stands: not asked yet, waiting on the
 * desktop shell (its read holds until the user answers the macOS prompt), or asked — and the
 * folder still refused, whether it was the shell's own read or the listing after it. `packaged`
 * is the shell's word on whose permission it is: the app's, or for a development instance
 * started from a terminal, that terminal's.
 */
export type AccessAsk =
  { phase: "idle" } | { phase: "asking" } | { phase: "asked"; packaged: boolean };

/** What the box for a refused folder says (a key of the finder's strings), and what it offers. */
export interface DeniedBox {
  text: "denied" | "deniedMacServer" | "deniedMacAsk" | "deniedMacRefused" | "deniedMacRefusedDev";
  /** "Allow access": not offered, ready, or disabled while the shell waits on the user. */
  allow: "none" | "ready" | "waiting";
  /** The Privacy & Security pane "Open System Settings" goes to; null when it is not offered. */
  settings: DesktopPrivacyPane | null;
  retry: boolean;
}

/**
 * The box for a folder the server may not read. Only a Mac has anything to ask for. There, a
 * page in the desktop shell that is browsing its own server has the shell read the folder in
 * the app's own name — what makes macOS ask — and, if the folder is still refused, offers
 * System Settings: Full Disk Access for a packaged app, where it can be added by hand when
 * macOS never listed it under Files and Folders, and Files and Folders for a development
 * instance, whose permission is its terminal's. A browser tab has no shell to ask, and a
 * machine's listing comes from another computer, so both can only say which process has to be
 * allowed. Retry is offered wherever the user may have changed something outside the app, and
 * never before the app has asked: it would only repeat the refusal.
 */
export function deniedBox(input: {
  /** The browsed machine's platform, from its listing. */
  platform: string | undefined;
  /** The page is drawn by the desktop shell, and the shell answers this server. */
  desktopShell: boolean;
  /** The machine being browsed (null: this server). */
  machine: string | null;
  ask: AccessAsk;
}): DeniedBox {
  if (input.platform !== "darwin") {
    return { text: "denied", allow: "none", settings: null, retry: true };
  }
  if (!input.desktopShell || input.machine !== null) {
    return { text: "deniedMacServer", allow: "none", settings: null, retry: true };
  }
  const { ask } = input;
  if (ask.phase === "asked") {
    return ask.packaged
      ? { text: "deniedMacRefused", allow: "none", settings: "fullDisk", retry: true }
      : { text: "deniedMacRefusedDev", allow: "none", settings: "files", retry: true };
  }
  return {
    text: "deniedMacAsk",
    allow: ask.phase === "asking" ? "waiting" : "ready",
    settings: null,
    retry: false,
  };
}

/**
 * The folder a temporary Workspace would get. Core creates `<agent dir>/workspaces/tmp-<8hex>`
 * for a Session started without one, and the Agent's config names `<agent dir>/agent_state`,
 * which locates that Agent directory. The random part is drawn only with the Session, so it
 * stays `tmp-…`. Null for a directory not shaped like an Agent State one: no path beats a
 * wrong one.
 */
export function tempWorkspacePath(stateDir: string): string | null {
  const agentDir = parentOf(stateDir);
  if (agentDir === null || baseName(stateDir) !== "agent_state") return null;
  const sep = separatorOf(agentDir);
  return `${agentDir}${agentDir.endsWith(sep) ? "" : sep}workspaces${sep}tmp-…`;
}

/** The footer's "no folder" button (see clearButton). */
export interface ClearButton {
  /** The host's value is already empty, so the button is the current choice. */
  pressed: boolean;
  /** The temporary Workspace's folder cut to its tail, shown on the button; null when not known here. */
  path: string | null;
  /** The same folder in full, for the tooltip. */
  fullPath: string | null;
}

/**
 * The footer's "no folder" button: there whenever the host offers going back to no folder,
 * whatever is chosen now, and pressed while nothing is. It names the folder a temporary
 * Workspace would get once the Agent's `agent_state` directory is known, and only while this
 * server is browsed: that directory is this server's, and another machine lays out its own.
 */
export function clearButton(input: {
  /** The host offers no folder: a temporary Workspace, or its own empty value. */
  offered: boolean;
  /** The host's current value. */
  workspace: string;
  /** The Agent's `agent_state` directory on this server; null when unknown. */
  stateDir: string | null;
  /** The machine being browsed (null: this server). */
  machine: string | null;
}): ClearButton | null {
  if (!input.offered) return null;
  const full =
    input.stateDir !== null && input.machine === null ? tempWorkspacePath(input.stateDir) : null;
  return {
    pressed: input.workspace.trim() === "",
    path: full === null ? null : pathTail(full, 4),
    fullPath: full,
  };
}
