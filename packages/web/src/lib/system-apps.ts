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
 * - A system app opens at its own path, as a page, never in the App Center's window: its page
 *   keeps its state in its own address, which a window's `?app=` would fight over.
 */
import { useMemo } from "react";
import { matchPath, useLocation } from "react-router";
import { useAuth } from "../state/auth";
import type { PageData } from "../web-app/page-table";
import { routeUnder } from "../web-app/route-under";
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
}

/** What the readers need of a page. */
type AppPage = Pick<
  PageData,
  "key" | "path" | "admin" | "released" | "title" | "titleZh" | "icon" | "app"
>;

/** The system apps the viewer sees, in their order. */
export function systemAppsOf(pages: readonly AppPage[], isAdmin: boolean): SystemApp[] {
  const apps: SystemApp[] = [];
  for (const page of pages) {
    const { app, title } = page;
    if (app === undefined || title === undefined || !Number.isFinite(app.order)) continue;
    if (!page.released || (page.admin && !isAdmin)) continue;
    apps.push({
      key: page.key,
      path: page.path,
      title,
      ...(page.titleZh !== undefined ? { titleZh: page.titleZh } : {}),
      ...(page.icon !== undefined ? { icon: page.icon } : {}),
      order: app.order,
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
  return useMemo(() => systemAppsOf(pages, isAdmin), [pages, isAdmin]);
}

/** Whether the page on screen is a system app or lies under one ({@link onSystemApp}). */
export function useOnSystemApp(): boolean {
  const pages = useWebAppPages();
  const isAdmin = useAuth().user?.isAdmin === true;
  return onSystemApp(useLocation().pathname, pages, isAdmin);
}
