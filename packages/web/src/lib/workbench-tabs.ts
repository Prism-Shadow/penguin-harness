/**
 * An Agent's workbench pages as the Web shows them: in the App Center's window (opened from the
 * App Center or the sidebar's app list, switched in the window's title bar when there are
 * several) and as the full page.
 *
 * A page is a CONTRIBUTION: a workbench's manifest puts an entry into `WebModule.sessionTabs`
 * for each page it has — several, or none for a handler-only workbench — and the server hands
 * them over with each page's URL resolved. The slot keeps its name, so no installed manifest has
 * to change. `uiRev`, the content hash of the workbench's `ui/` tree, is only the cache key an
 * open page compares to notice it changed under it (the iframe reloads on a new one). Every page
 * is drawn in a frame; a tab without an iframe renderer, which an older machine may still list
 * for its in-repo Self-Evolution Workbench, is left out: there is nothing to draw it with.
 */
import { useEffect } from "react";
import type { WorkbenchInfo } from "@prismshadow/penguin-server/api";
import { apiUrl } from "./server-context";

export type WorkbenchTab = {
  /** `<workbenchId>/<key>`: what a frame keys its page on. */
  tabId: string;
  workbenchId: string;
  /** The contribution's key, unique within its workbench; the fourth segment of the full-page route. */
  key: string;
  title: string;
  titleZh?: string;
  pointerLock?: true;
  /** The machine whose server holds the workbench (the Agent's Session runs there); null = this server. */
  machineId: string | null;
  /** The workbench's package name, for the frame's bar. */
  name: string;
  version: string | null;
  revision: string;
  /** The cache key of the page: the `ui/` revision (the folder's when there is no `ui/`). */
  uiRev: string;
  /** The load error of the CURRENT files; the tab still shows the last good UI. */
  error: string | null;
  /** The page's URL, routed through the machine that holds it. */
  src: string;
};

/**
 * Dispatched on `window` when the server says a workbench of some Agent was (re)loaded or
 * removed. The detail names the Agent only: the listener refetches the list, which is the
 * one shape that covers both.
 */
export const WORKBENCH_UPDATED_EVENT = "penguin:workbench-updated";

export interface WorkbenchUpdatedDetail {
  machineId?: string | null;
  projectId: string;
  agentId: string;
}

/**
 * How long a listener gathers a burst of workbench news into one read (ms): a restart loads every
 * workbench of an Agent, and each load is one event.
 */
export const WORKBENCH_NEWS_SETTLE_MS = 120;

/**
 * Dispatched on `window` when the server starts loading a workbench's files (the watcher saw an
 * edit, or a list or a reload asked for it). The App Center listens, to show the tile building;
 * the end of the load is the WORKBENCH_UPDATED_EVENT above.
 */
export const WORKBENCH_BUILDING_EVENT = "penguin:workbench-building";

export interface WorkbenchBuildingDetail extends WorkbenchUpdatedDetail {
  workbenchId: string;
}

export function workbenchesBase(projectId: string, agentId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/workbenches`;
}

/** A tab's page, keyed on the UI revision so a changed page is a new URL. */
export function workbenchUiUrl(tab: { src: string; uiRev: string }): string {
  return `${tab.src}${tab.src.includes("?") ? "&" : "?"}rev=${tab.uiRev}`;
}

/**
 * The workbenches that run, out of an Agent's list: none while the Agent-wide switch is off, and
 * of the rest each only while its own switch is on. A switched-off workbench is still listed by
 * the server (its settings row needs it) but loads nothing, so nothing outside the settings may
 * offer it: no tab, no notice, no full page. A server older than the switches sends neither
 * flag, and everything it lists runs.
 */
export function runningWorkbenches(list: {
  workbenches: readonly WorkbenchInfo[];
  enabled?: boolean;
}): WorkbenchInfo[] {
  if (list.enabled === false) return [];
  return list.workbenches.filter((w) => w.enabled !== false);
}

export function workbenchTabsOf(
  workbenches: readonly WorkbenchInfo[],
  machineId: string | null = null,
): WorkbenchTab[] {
  return workbenches.flatMap((w) =>
    w.tabs.flatMap((tab): WorkbenchTab[] => {
      const shared = {
        tabId: w.id + "/" + tab.key,
        workbenchId: w.id,
        key: tab.key,
        title: tab.title,
        ...(tab.titleZh === undefined ? {} : { titleZh: tab.titleZh }),
        machineId,
        name: w.name,
        version: w.version,
        revision: w.revision,
        uiRev: w.uiRev ?? w.revision,
        error: w.error,
      };
      const iframe = (tab.renderer as Partial<typeof tab.renderer>).iframe;
      if (iframe === undefined) return [];
      const { src, pointerLock } = iframe;
      return [
        { ...shared, src: apiUrl(src, machineId), ...(pointerLock ? { pointerLock: true } : {}) },
      ];
    }),
  );
}

/**
 * The route that shows one workbench page as the whole app (no sidebar, no chat): what
 * `penguin web --app <project>/<agent>/<workbench>[/<tab>]` opens, and what a window's "Open
 * full screen" navigates to. Without a tab key the workbench's first page is shown. The exit
 * button and the command palette are the way out.
 */
export function workbenchAppPath(
  projectId: string,
  agentId: string,
  workbenchId: string,
  tabKey?: string,
  machineId: string | null = null,
): string {
  const segments = [projectId, agentId, workbenchId, ...(tabKey === undefined ? [] : [tabKey])];
  const path = `/app/${segments.map(encodeURIComponent).join("/")}`;
  // The machine is not part of the workbench's name, only of where to ask for it.
  return machineId === null ? path : `${path}?machine=${encodeURIComponent(machineId)}`;
}

/** The tab a full-page route names: that key, or the workbench's first tab when it names none. */
export function appPageTab(
  tabs: readonly WorkbenchTab[],
  workbenchId: string,
  tabKey: string | undefined,
): WorkbenchTab | null {
  const own = tabs.filter((t) => t.workbenchId === workbenchId);
  return (tabKey === undefined ? own[0] : own.find((t) => t.key === tabKey)) ?? null;
}

/** A page's own request to fill the app, posted to its parent: `{ type: "penguin:fill-app" }`. */
export const FILL_APP_MESSAGE = "penguin:fill-app";

/**
 * A page's question about a chat model, posted to its parent by the page SDK's
 * `chooseChatModel()` / `getChatModel()`: `{ type, id, op: "choose" | "get", current }`. The app
 * answers on the same id with {@link CHAT_MODEL_REPLY}: `{ accepted: true }` at once, then
 * `{ model }` (null when none was chosen) or `{ error }`.
 */
export const CHAT_MODEL_MESSAGE = "penguin:chat-model";
/** A visible workbench's request to open its Project's Models page, answered on the same id. */
export const OPEN_MODEL_SETTINGS_MESSAGE = "penguin:open-model-settings";
export const CHAT_MODEL_REPLY = "penguin:chat-model-reply";

/** The main app's manifest, the literal the template ships and what leaving the page restores. */
export const MAIN_MANIFEST_HREF = "/manifest.webmanifest";

/** A workbench manifest's path on the local server (the auth-less gate), per tab or whole. */
export function workbenchManifestHref(
  projectId: string,
  agentId: string,
  workbenchId: string,
  tabKey?: string,
  machineId: string | null = null,
): string {
  const segments = [projectId, agentId, workbenchId, ...(tabKey === undefined ? [] : [tabKey])].map(
    encodeURIComponent,
  );
  return (
    `/api/projects/${segments[0]}/agents/${segments[1]}/workbenches/${segments[2]}` +
    (tabKey === undefined ? "" : `/tabs/${segments[3]}`) +
    "/manifest.webmanifest" +
    (machineId === null ? "" : `?machine=${encodeURIComponent(machineId)}`)
  );
}

/**
 * This page is its own installable app: while it is mounted, the document's manifest link
 * names the page's own manifest (the tab's, or the workbench's when no tab key is in the
 * route), and on unmount it is restored to the main app's literal link. The restore is the
 * literal — NEVER the href found on arrival: on a page the server had already rewritten, the
 * arrival href IS a workbench manifest, and keeping it would leave the install surface on
 * the workbench after the page is gone.
 *
 * Returns the href the link now carries (the same string the server's rewrite builds), for
 * the page's tests to assert against.
 */
export function useInstallManifest(
  projectId: string,
  agentId: string,
  workbenchId: string,
  tabKey: string | undefined,
  machineId: string | null = null,
): string {
  const href = workbenchManifestHref(projectId, agentId, workbenchId, tabKey, machineId);
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (link === null) return;
    if (link.getAttribute("href") !== href) link.setAttribute("href", href);
    return () => {
      link.setAttribute("href", MAIN_MANIFEST_HREF);
    };
  }, [href]);
  return href;
}
