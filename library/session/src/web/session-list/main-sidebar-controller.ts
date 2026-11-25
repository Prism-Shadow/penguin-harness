import type { MainSidebarProps, SidebarBindingReader, SidebarNavSelector, SidebarPagesReader } from "@prismshadow/penguin-web/internal";
import { useMainSidebarInputs } from "./main-sidebar-inputs";
import { useMainSidebarSessions } from "./main-sidebar-sessions";
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
  const scope2 = useMainSidebarGroupMode(scope1);
  const scope3 = useMainSidebarSearchOpen(scope2);
  const scope4 = useMainSidebarCanDrag(scope3);
  const scope5 = useMainSidebarSetGroupMode(scope4);
  const scope6 = useMainSidebarWorkspaceGroupCounts(scope5);
  const scope7 = useMainSidebarToggleGroup(scope6);
  const scope8 = useMainSidebarCloseSearch(scope7);
  const scope9 = useMainSidebarShownDrafts(scope8);
  const scope10 = useMainSidebarFetchScope(scope9);
  const scope11 = useMainSidebarArchiveSession(scope10);
  const scope12 = useMainSidebarNewEntity(scope11);
  const scope13 = useMainSidebarApplyRegistryChange(scope12);
  const scope14 = useMainSidebarOpenSession(scope13);
  const scope15 = useMainSidebarAgentNameById(scope14);
  const scope16 = useMainSidebarRenderRows(scope15);
  const scope17 = useMainSidebarShowMore(scope16);
  const scope18 = useMainSidebarRenderGroupBody(scope17);
  return scope18;
}
export type MainSidebarState = ReturnType<typeof useMainSidebarController>;
