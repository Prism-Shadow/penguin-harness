/**
 * The system apps: the pages the system Agent owns as its apps (PRFC-0033) — every page of the
 * table whose contribution carries `app` and names a `title`, the five the features contribute
 * (Models, Plugins, Machines, the Cost Center and the Evaluation Center) and any a server module
 * contributes. Nothing here names them: the App Center draws them as tiles, the system Agent's
 * settings list them, and the nav keeps the App Center lit on their pages, all from this reading.
 *
 * - Only offered pages (`released`) whose role rule the viewer meets: an admin-only page
 *   (Machines) is no app for a member, as its nav row was none.
 * - In `app.order`, then by key where two tie.
 * - A system app a feature contributes opens at its own path, as a page: its page keeps its state
 *   in its own address, which a window's `?app=` would fight over. One a server module contributes
 *   as an iframe opens in the App Center's window instead (web-app/page-table.ts `windowFrameOf`),
 *   keyed `system_agent/<page key>`, with its location inside it in the window's `at`; its full
 *   screen is the page `/app/<projectId>/system_agent/<page key>`.
 */
import { useMemo } from "react";
import { matchPath, useLocation } from "react-router";
import { useAuth } from "../state/auth";
import { windowFrameOf, type WebAppPage } from "../web-app/page-table";
import { routeUnder } from "../web-app/route-under";
import { SYSTEM_AGENT_ID } from "./builtin-agents";
import { useLocale } from "../state/locale";
import { useSessionWorkbenchPanels } from "./dock-panel-registry";
import { sessionWorkbenchAppKey, sessionWorkbenchPath } from "./session-workbenches";
import { useWebAppPages } from "./web-app-pages";

/** A system app as its readers draw it. */
export interface SystemApp {
  /** The page's key: the app's id, and its App Center key after `system_agent/`. */
  key: string;
  /** Where the app opens. */
  path: string;
  title: string;
  titleZh?: string;
  /** Its glyph's name in the UI package's icon registry (`ICONS`). */
  icon?: string;
  order: number;
  /** The document it opens in the App Center's window; absent for one that opens as a page. */
  frame?: string;
}

/**
 * What a tile, and a running app, carry of a system app: its page's glyph, drawn on the App
 * Center's icon shape, and the document it opens in the window when it opens in one.
 */
export interface SystemShortcut {
  glyph: string;
  frame?: string;
}

/** What the readers need of a page. */
type AppPage = Pick<
  WebAppPage,
  "key" | "path" | "admin" | "released" | "title" | "titleZh" | "icon" | "app" | "renderer" | "nav"
>;

/** A system app's App Center key, which its window's address names: `system_agent/<page key>`. */
export function systemAppKey(pageKey: string): string {
  return `${SYSTEM_AGENT_ID}/${pageKey}`;
}

/** The full page of a system app that opens in the window, at `at` inside it. */
export function systemAppFullPage(projectId: string, pageKey: string, at?: string | null): string {
  const path = `/app/${encodeURIComponent(projectId)}/${SYSTEM_AGENT_ID}/${encodeURIComponent(pageKey)}`;
  return at === null || at === undefined || at === "/"
    ? path
    : `${path}?${new URLSearchParams({ at }).toString()}`;
}

/** The system apps the viewer sees, in their order. */
export function systemAppsOf(pages: readonly AppPage[], isAdmin: boolean): SystemApp[] {
  const apps: SystemApp[] = [];
  for (const page of pages) {
    const { app, title } = page;
    if (app === undefined || title === undefined || !Number.isFinite(app.order)) continue;
    if (!page.released || (page.admin && !isAdmin)) continue;
    const frame = windowFrameOf(page);
    apps.push({
      key: page.key,
      path: page.path,
      title,
      ...(page.titleZh !== undefined ? { titleZh: page.titleZh } : {}),
      ...(page.icon !== undefined ? { icon: page.icon } : {}),
      order: app.order,
      ...(frame !== null ? { frame } : {}),
    });
  }
  return apps.sort((a, b) => a.order - b.order || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/**
 * Whether `pathname` is one of the viewer's system apps or a page under one by its route
 * (route-under.ts: the Evaluation Center's `/benchmark/:benchmarkId` lies under `/benchmark`).
 * The App Center's nav row is lit there, since the App Center is where those pages are opened.
 */
export function onSystemApp(
  pathname: string,
  pages: readonly AppPage[],
  isAdmin: boolean,
): boolean {
  const roots = systemAppsOf(pages, isAdmin).map((app) => app.path);
  if (roots.length === 0) return false;
  return pages.some(
    (page) =>
      roots.some((root) => routeUnder(page.path, root)) && matchPath(page.path, pathname) !== null,
  );
}

/** The system apps the signed-in viewer sees, read from the page table. */
export function useSystemApps(): readonly SystemApp[] {
  const pages = useWebAppPages();
  const isAdmin = useAuth().user?.isAdmin === true;
  const panels = useSessionWorkbenchPanels();
  const { locale } = useLocale();
  return useMemo(
    () => [
      ...systemAppsOf(pages, isAdmin),
      ...panels.flatMap((panel) =>
        panel.id === "terminal" || panel.id === "builtin-browser"
          ? [
              {
                key: sessionWorkbenchAppKey(panel.id),
                path: sessionWorkbenchPath(panel.id),
                title: panel.label(),
                icon: panel.id === "terminal" ? "terminalWindow" : "globe",
                order: panel.order,
              },
            ]
          : [],
      ),
    ],
    [pages, isAdmin, panels, locale],
  );
}

/** Whether the page on screen is a system app or lies under one ({@link onSystemApp}). */
export function useOnSystemApp(): boolean {
  const pages = useWebAppPages();
  const isAdmin = useAuth().user?.isAdmin === true;
  return onSystemApp(useLocation().pathname, pages, isAdmin);
}
