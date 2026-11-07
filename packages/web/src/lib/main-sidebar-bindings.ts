import type { WebAppPage } from "../web-app";
export interface MainSidebarProps {
  onNavigate?: () => void;
  onCollapse?: () => void;
  initialSearchOpen?: boolean;
}
export type SidebarBindingReader = never;
export type SidebarPagesReader = () => readonly WebAppPage[];
export type SidebarNavSelector = (pages: readonly WebAppPage[]) => readonly WebAppPage[];
