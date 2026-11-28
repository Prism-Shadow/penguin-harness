import { useMainSidebarController, useSidebarApps } from "@prismshadow/penguin-library-session/web";
import { navPagesOf, useWebAppPages } from "../index";
import { sidebarDeps } from "./deps";
import type { MainSidebarProps } from "../../lib/main-sidebar-bindings";
import { useOnSystemApp } from "../../lib/system-apps";
import { usePageWorkspace } from "../../lib/page-workspace-context";
import { createMainSidebarNavigation } from "./main-navigation";
import { renderMainSidebarFrame } from "./main-frame";

/** One live state chain; the frame composes the actual contributed list. */
export function Sidebar(props: MainSidebarProps) {
  const state = useMainSidebarController(props, navPagesOf, useWebAppPages, sidebarDeps.useDeps);
  const onSystemApp = useOnSystemApp();
  // The Apps list lights the row of the app on screen; the App Center's nav row then stands down,
  // so exactly one row of the column is the current page.
  const workspace = usePageWorkspace();
  const { rows } = useSidebarApps(workspace?.layout.pages);
  const appRowLit = rows.some((row) => row.page.id === workspace?.current?.id);
  return renderMainSidebarFrame(createMainSidebarNavigation(state, onSystemApp, appRowLit));
}
