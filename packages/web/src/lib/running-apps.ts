/**
 * The running apps in this browser tab: each app opened in an App Center window and not closed
 * since, whether its window is in front or minimized. A module-level store rather than component
 * state, because its readers live apart and outlast one another: the App Center page launches
 * apps and marks their tiles, the layer over the page area hosts their windows
 * (features/app-center/app-center-windows.tsx) and stays mounted when the viewer leaves the page,
 * and any other surface — the sidebar's app list — lists them, opens one and brings one back.
 *
 * Two faces:
 * - for any surface, `useRunningApps()` lists the current Project's running apps as rows, each
 *   saying whether its window is in front, and `useRestoreApp()` brings one's window to the front
 *   over the main area — the same live window when it runs, a new one from the shortcut the
 *   surface holds when it does not — at the App Center's address (app-window-address.ts), so
 *   minimizing it returns to the page it was opened from;
 * - for the App Center and the windows' host, the records and the calls that change them.
 *
 * An app ends when the viewer closes it, when its workbench is gone (its window learns it,
 * app-center-windows.tsx), with its Project left, or with the app shell. An app a list stops
 * showing keeps running: the App Center hides a workbench the sidebar may still open, and the
 * sidebar lists one Agent's apps at a time.
 *
 * Nothing here is saved: a reload starts with no app running.
 */
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useLocation, useNavigate } from "react-router";
import type { AppCenterShortcut, IconRef } from "@prismshadow/penguin-server/api";
import { useLocale } from "../state/locale";
import { useProject } from "../state/project";
import { windowEntryState, windowInFront, windowSearch } from "./app-window-address";
import { APP_CENTER_PATH } from "./app-center-path";
import { localizedText } from "./skill-use";
import type { SystemShortcut } from "./system-apps";

/**
 * A running app's App Center shortcut, with the machine its Agent lives on (none: this server), and
 * for a system app that opens in the window, the document its window draws.
 */
export type RunningShortcut = AppCenterShortcut & { machineId?: string; system?: SystemShortcut };

/** One running app as its window's host keeps it. */
export interface RunningAppRecord {
  /** The App Center's key: `<agentId>/<workbenchId>`, after `<machineId>:` for a machine's app. */
  key: string;
  /** The Project it was opened in. */
  projectId: string;
  shortcut: RunningShortcut;
}

/** One running app as a surface outside the App Center lists it. */
export interface RunningApp {
  /** What `useRestoreApp()` takes: the App Center's key, as in `RunningAppRecord`. */
  key: string;
  agentId: string;
  /** Its Agent's name, as the surface that opened the app knew it. */
  agentName: string;
  workbenchId: string;
  /** The machine its Agent lives on; null for this server. */
  machineId: string | null;
  /** In the reader's language. */
  title: string;
  /** The app's icon image (the UI package's `ImageIcon` draws it); null for the letter tile. */
  icon: IconRef | null;
  /** Its window is the one in front; false while it is minimized. */
  shown: boolean;
}

let records: readonly RunningAppRecord[] = [];
const listeners = new Set<() => void>();

function publish(next: readonly RunningAppRecord[]): void {
  if (next === records) return;
  records = next;
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): readonly RunningAppRecord[] {
  return records;
}

/** Every running app's record, in the order they were opened, for the host of their windows. */
export function useRunningAppRecords(): readonly RunningAppRecord[] {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** The current Project's running apps, in the order they were opened. */
export function useRunningApps(): readonly RunningApp[] {
  const all = useRunningAppRecords();
  const projectId = useProject().currentProject?.projectId ?? null;
  const { locale } = useLocale();
  const front = windowInFront(useLocation());
  return useMemo(
    () =>
      all
        .filter((record) => record.projectId === projectId)
        .map(({ key, shortcut }) => ({
          key,
          agentId: shortcut.agentId,
          agentName: shortcut.agentName,
          workbenchId: shortcut.workbenchId,
          machineId: shortcut.machineId ?? null,
          title: localizedText(locale, shortcut.title, shortcut.titleZh),
          icon: shortcut.icon ?? null,
          shown: key === front,
        })),
    [all, projectId, locale, front],
  );
}

/**
 * Brings an app's window to the front over the main area, from wherever the viewer is: a running
 * app's comes back as it was left; one not running starts from `shortcut`, or, without one, if
 * the App Center lists it. From a page, the step is a new history entry that names the page, so
 * the window's minimize (or Back) returns to it; from another window in front, that window's
 * entry is replaced and keeps where it was opened over, so leaving one window for another never
 * stacks windows up in history.
 */
export function useRestoreApp(): (key: string, shortcut?: RunningShortcut) => void {
  const navigate = useNavigate();
  const location = useLocation();
  const projectId = useProject().currentProject?.projectId ?? null;
  const front = windowInFront(location);
  const here = location.pathname + location.search;
  const state: unknown = location.state;
  return useCallback(
    (key: string, shortcut?: RunningShortcut) => {
      if (shortcut !== undefined && projectId !== null) launchApp({ key, projectId, shortcut });
      if (key === front) return;
      const to = { pathname: APP_CENTER_PATH, search: windowSearch(key) };
      if (front !== null) void navigate(to, { replace: true, state });
      else void navigate(to, { state: windowEntryState(here) });
    },
    [navigate, projectId, front, here, state],
  );
}

/** Starts the app; one already running keeps its place and its window, with the newer shortcut. */
export function launchApp(record: RunningAppRecord): void {
  const at = records.findIndex((running) => running.key === record.key);
  if (at === -1) publish([...records, record]);
  else if (records[at]!.shortcut !== record.shortcut || records[at]!.projectId !== record.projectId)
    publish(records.map((running, i) => (i === at ? record : running)));
}

/** Ends the app: its window unmounts, and what ran in it stops. */
export function closeApp(key: string): void {
  if (records.some((running) => running.key === key))
    publish(records.filter((running) => running.key !== key));
}

/**
 * Whether two shortcuts say the same thing. A list builds its shortcuts afresh on every render
 * (a machine's tiles do), so an equal copy must not count as news: publishing it would render
 * the list again, which would hand over another copy.
 */
function sameShortcut(a: RunningShortcut, b: RunningShortcut): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Follows a list of `projectId`'s apps: a running app the list has takes the shortcut it gives
 * now (a new title, icon or build). One the list does not have runs on as it is: a list shows
 * only some apps, so not being on it says nothing of the workbench.
 */
export function takeListedShortcuts(
  projectId: string,
  listed: ReadonlyMap<string, RunningShortcut>,
): void {
  let changed = false;
  const next = records.map((running) => {
    const shortcut = running.projectId === projectId ? listed.get(running.key) : undefined;
    if (shortcut === undefined || sameShortcut(shortcut, running.shortcut)) return running;
    changed = true;
    return { ...running, shortcut };
  });
  if (changed) publish(next);
}

/** Ends every app opened in another Project than `projectId`. */
export function keepProjectApps(projectId: string): void {
  if (records.some((running) => running.projectId !== projectId))
    publish(records.filter((running) => running.projectId === projectId));
}

/** Ends every app. */
export function closeAllApps(): void {
  if (records.length > 0) publish([]);
}
