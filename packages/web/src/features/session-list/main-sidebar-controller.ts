import type {
  MainSidebarProps,
  SidebarBindingReader,
  SidebarNavSelector,
  SidebarPagesReader,
} from "../../lib/main-sidebar-bindings";
import { useMainSidebarInputs } from "./main-sidebar-inputs";
import { useMainSidebarSessions } from "./main-sidebar-sessions";
import { useMainSidebarNavCollapsed } from "./main-sidebar-nav-collapsed";
import { useMainSidebarGroupMode } from "./main-sidebar-group-mode";
import { useMainSidebarSearchOpen } from "./main-sidebar-search-open";
import { useMainSidebarCanDrag } from "./main-sidebar-can-drag";
import { useMainSidebarSetGroupMode } from "./main-sidebar-set-group-mode";
import { useMainSidebarWorkspaceGroupCounts } from "./main-sidebar-workspace-group-counts";
import { useMainSidebarToggleGroup } from "./main-sidebar-toggle-group";
import { useMainSidebarCloseSearch } from "./main-sidebar-close-search";
import { useMainSidebarShownDrafts } from "./main-sidebar-shown-drafts";
import { useMainSidebarFetchScope } from "./main-sidebar-fetch-scope";
import { useMainSidebarArchiveSession } from "./main-sidebar-archive-session";
import { useMainSidebarNewEntity } from "./main-sidebar-new-entity";
import { useMainSidebarApplyRegistryChange } from "./main-sidebar-apply-registry-change";
import { useMainSidebarOpenSession } from "./main-sidebar-open-session";
import { useMainSidebarAgentNameById } from "./main-sidebar-agent-name-by-id";
import { useMainSidebarRenderRows } from "./main-sidebar-render-rows";
import { useMainSidebarShowMore } from "./main-sidebar-show-more";
import { useMainSidebarRenderGroupBody } from "./main-sidebar-render-group-body";

export function useMainSidebarController(
  props: MainSidebarProps,
  selectNavPages: SidebarNavSelector,
  readPages: SidebarPagesReader,
  useBindings: SidebarBindingReader,
) {
  const scope0 = useMainSidebarInputs(props, selectNavPages, readPages, useBindings);
  const scope1 = useMainSidebarSessions(scope0);
  const scope2 = useMainSidebarNavCollapsed(scope1);
  const scope3 = useMainSidebarGroupMode(scope2);
  const scope4 = useMainSidebarSearchOpen(scope3);
  const scope5 = useMainSidebarCanDrag(scope4);
  const scope6 = useMainSidebarSetGroupMode(scope5);
  const scope7 = useMainSidebarWorkspaceGroupCounts(scope6);
  const scope8 = useMainSidebarToggleGroup(scope7);
  const scope9 = useMainSidebarCloseSearch(scope8);
  const scope10 = useMainSidebarShownDrafts(scope9);
  const scope11 = useMainSidebarFetchScope(scope10);
  const scope12 = useMainSidebarArchiveSession(scope11);
  const scope13 = useMainSidebarNewEntity(scope12);
  const scope14 = useMainSidebarApplyRegistryChange(scope13);
  const scope15 = useMainSidebarOpenSession(scope14);
  const scope16 = useMainSidebarAgentNameById(scope15);
  const scope17 = useMainSidebarRenderRows(scope16);
  const scope18 = useMainSidebarShowMore(scope17);
  const scope19 = useMainSidebarRenderGroupBody(scope18);
  return scope19;
}
export type MainSidebarState = ReturnType<typeof useMainSidebarController>;
