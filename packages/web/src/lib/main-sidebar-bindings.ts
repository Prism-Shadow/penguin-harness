import type { ModeState } from "./sidebar-contributions";
import type { SectionEntry, ModeEntry, BadgeEntry } from "./sidebar-modes";
import type { WebAppPage } from "../web-app";
export type SidebarPagesReader = () => readonly WebAppPage[];
export interface MainSidebarProps {
  onNavigate?: () => void;
  onCollapse?: () => void;
  initialSearchOpen?: boolean;
}
export interface MainSidebarBindings {
  sections: readonly SectionEntry[];
  modes: readonly ModeEntry[];
  badges: readonly BadgeEntry[];
  useModes: () => readonly ModeState[];
  useNotes: () => ReadonlyMap<string, string>;
}
export type SidebarBindingReader = () => MainSidebarBindings;
export type SidebarNavSelector = (pages: readonly WebAppPage[]) => readonly WebAppPage[];
