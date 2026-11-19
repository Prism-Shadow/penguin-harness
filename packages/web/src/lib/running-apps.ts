/**
 * The running apps in this browser tab: each app opened in an App Center window and not closed
 * since, whether its window is in front or minimized. A module-level store rather than component
 * state, because its readers live apart and outlast one another: the App Center page launches
 * apps and marks their tiles, the layer over the page area hosts their windows
 * (features/app-center/app-center-windows.tsx) and stays mounted when the viewer leaves the page,
 * and any other surface — the sidebar's app list — lists them and brings one back.
 *
 * Two faces:
 * - for any surface, `useRunningApps()` lists the current Project's running apps as rows, each
 *   saying whether its window is in front, and `useRestoreApp()` brings one's window back over
 *   the main area: the same live window, at the App Center's address (app-window-address.ts),
 *   so minimizing it again returns to the page it was restored from;
 * - for the App Center, which owns the windows, the records and the calls that change them.
 *
 * Nothing here is saved: a reload starts with no app running.
 */
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useLocation, useNavigate } from "react-router";
import type { AppCenterShortcut, IconRef } from "@prismshadow/penguin-server/api";
import { useLocale } from "../state/locale";
import { useProject } from "../state/project";
import { WINDOW_ENTRY_STATE, windowInFront, windowSearch } from "./app-window-address";
import { APP_CENTER_PATH } from "./app-center-path";
import { localizedText } from "./skill-use";

/** One running app as its window's host keeps it. */
export interface RunningAppRecord {
  /** The App Center's key for the app, `<agentId>/<workbenchId>`. */
  key: string;
  /** The Project it was opened in. */
  projectId: string;
  shortcut: AppCenterShortcut;
}

/** One running app as a surface outside the App Center lists it. */
export interface RunningApp {
  /** What `useRestoreApp()` takes: `<agentId>/<workbenchId>`. */
  key: string;
  agentId: string;
  workbenchId: string;
  /** The machine its Agent lives on; null for this server, the only one the App Center lists yet. */
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
          workbenchId: shortcut.workbenchId,
          machineId: null,
          title: localizedText(locale, shortcut.title, shortcut.titleZh),
          icon: shortcut.icon ?? null,
          shown: key === front,
        })),
    [all, projectId, locale, front],
  );
}

/**
 * Brings an app's window to the front over the main area, from wherever the viewer is: a running
 * app's comes back as it was left, one not running opens if the App Center lists it. The step is
 * a new history entry, so the window's minimize (or Back) returns to the page it came from.
 */
export function useRestoreApp(): (key: string) => void {
  const navigate = useNavigate();
  const location = useLocation();
  const front = windowInFront(location);
  return useCallback(
    (key: string) => {
      if (key === front) return;
      void navigate(
        { pathname: APP_CENTER_PATH, search: windowSearch(key) },
        { state: WINDOW_ENTRY_STATE },
      );
    },
    [navigate, front],
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
 * Follows the App Center's list for `projectId`: an app of that Project the list no longer has
 * ends, and one it has takes the shortcut it gives now (a new title, icon or tab).
 */
export function keepListedApps(
  projectId: string,
  listed: ReadonlyMap<string, AppCenterShortcut>,
): void {
  let changed = false;
  const next: RunningAppRecord[] = [];
  for (const running of records) {
    const shortcut = running.projectId === projectId ? listed.get(running.key) : running.shortcut;
    if (shortcut === undefined) {
      changed = true;
      continue;
    }
    if (shortcut !== running.shortcut) changed = true;
    next.push(shortcut === running.shortcut ? running : { ...running, shortcut });
  }
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
