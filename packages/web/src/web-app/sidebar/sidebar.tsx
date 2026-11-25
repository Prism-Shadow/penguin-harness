import { useMainSidebarController } from "@prismshadow/penguin-library-session/web";
import { navPagesOf, useWebAppPages } from "../index";
import { sidebarDeps } from "./deps";
import type { MainSidebarProps } from "../../lib/main-sidebar-bindings";
import { useOnSystemApp } from "../../lib/system-apps";
import { createMainSidebarNavigation } from "./main-navigation";
import { renderMainSidebarFrame } from "./main-frame";

/** One live state chain; the frame composes the actual contributed list. */
export function Sidebar(props: MainSidebarProps) {
  const state = useMainSidebarController(props, navPagesOf, useWebAppPages, sidebarDeps.useDeps);
  const onSystemApp = useOnSystemApp();
  return renderMainSidebarFrame(createMainSidebarNavigation(state, onSystemApp));
}
