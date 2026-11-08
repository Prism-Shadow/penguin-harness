import { useMainSidebarController } from "../../features/session-list";
import { navPagesOf, useWebAppPages } from "../index";
import type { MainSidebarProps } from "../../lib/main-sidebar-bindings";
import { createMainSidebarNavigation } from "./main-navigation";
import { renderMainSidebarFrame } from "./main-frame";

/** One live state chain; the frame composes the actual contributed list. */
export function Sidebar(props: MainSidebarProps) {
  const state = useMainSidebarController(props, navPagesOf, useWebAppPages);
  return renderMainSidebarFrame(createMainSidebarNavigation(state));
}
