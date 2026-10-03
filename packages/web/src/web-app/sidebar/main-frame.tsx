import {
  Badge,
  Dropdown,
  ICONS,
  MenuItem,
  MenuRadioItem,
  MenuSeparator,
  NavRow,
  Segmented,
  SidebarFrame,
  SidebarNavArea,
  SidebarNavGroup,
  SidebarSwitcherButton,
} from "@prismshadow/penguin-ui";

import { S } from "../../lib/strings";

import { projectDisplayName } from "../../state/project";

import { DRAFT_SESSION_ID } from "../../features/chat";

import { isCurrentPath, renderRouterLink } from "./router-link";
import {
  NoOrganizationsSidebar,
  OrgSwitcher,
  CompanyBetaBadge,
  ChannelSidebar,
  OrgSessionGroups,
} from "../../features/company";

import { NEW_CHAT_ICON } from "../../lib/main-sidebar-persistence";

import type { MainSidebarView } from "./main-navigation";
import { renderMainSessionList, renderMainSessionDialogs } from "../../features/session-list";

export function renderMainSidebarFrame(scope: MainSidebarView) {
  const {
    navigate,
    location,
    projects,
    currentProject,
    setCurrentProjectId,
    agents,
    countsByAgent,
    loading,
    activeSessionId,
    projectOpen,
    setProjectOpen,
    setCreateProjectOpen,
    setProjectSettingsOpen,
    company,
    inCompany,
    navOrg,
    sessions,
    byAgent,
    currentProjectId,
    navCollapsed,
    navDrag,
    navToggleRef,
    groupMode,
    regrouped,
    collapsedGroups,
    pinnedGroups,
    sortMode,
    setDeletingWorkspace,
    searchOpen,
    setSearchOpen,
    searchInputRef,
    rootRef,
    searchTitle,
    newChatTitle,
    collapseTitle,
    searchQuery,
    setSearchQuery,
    listSettingsOpen,
    setListSettingsOpen,
    canDrag,
    pendingLoads,
    setDeletingDraft,
    setGroupMode,
    toggleNavGroup,
    navAreaDrop,
    workspaceGroupCounts,
    orderedAgents,
    orderedWorkspaceGroups,
    agentGroupSequence,
    workspaceGroupSequence,
    toggleGroup,
    togglePin,
    setSortMode,
    searching,
    groupsOnPage,
    groupPagerRow,
    filterRows,
    timeRows,
    timeGroups,
    timeMoreAgents,
    closeSearch,
    groupDragProps,
    shownDrafts,
    hasSearchMatches,
    trackedLoadMore,
    go,
    newChat,
    browseFiles,
    newEntity,
    newEntityLabel,
    addWorkspace,
    machineNameOf,
    registeredKeys,
    openRenameWorkspace,
    switchMode,
    renderGroupBody,
    companyNavItems,
    pinnedNavPages,
    collapsibleNavPages,
    renderNavEntry,
    accountRow,
    onNavigate,
    onCollapse,
  } = scope;
  const dialogs = renderMainSessionDialogs(scope);

  return (
    <SidebarFrame
      rootRef={rootRef}
      // The page nav and the Session list are one find-in-page region (components/find/).
      findRegion="sessions"
      // The work-mode switch, above the Project switcher: 开发 | 公司. Rendered only while
      // company mode is available (the admin master switch and the user's own switch both on);
      // the choice persists per user. The 内测版 tag rides on 公司 — the switch is the one
      // control that names the mode, so the mark stands on the word it qualifies rather than
      // somewhere inside the mode it describes.
      {...(company.available
        ? {
            modeSwitch: {
              label: S.company.workMode,
              control: (
                <Segmented
                  options={[
                    { value: "dev" as const, label: S.company.modeDev },
                    {
                      value: "company" as const,
                      label: S.company.modeCompany,
                      badge: { node: <CompanyBetaBadge />, name: S.company.beta },
                    },
                  ]}
                  value={company.workMode}
                  onChange={switchMode}
                  cols={2}
                />
              ),
            },
          }
        : {})}
      {...(onCollapse
        ? {
            collapse: { label: S.nav.collapseSidebar, tooltip: collapseTitle, onClick: onCollapse },
          }
        : {})}
      switcher={
        // The Project switcher; the organization switcher in company mode.
        inCompany ? (
          <OrgSwitcher {...(onNavigate ? { onNavigate } : {})} />
        ) : (
          <Dropdown
            open={projectOpen}
            setOpen={setProjectOpen}
            className="min-w-0 flex-1"
            menuClass="left-0 right-0 top-full mt-1 origin-top"
            button={
              <SidebarSwitcherButton
                label={currentProject ? projectDisplayName(currentProject) : S.common.loading}
                onClick={() => setProjectOpen(!projectOpen)}
              />
            }
          >
            {/* Plain rows rather than a role="menu": the switcher's Project rows are named
                like its trigger, and both are reached as buttons. */}
            {projects.map((p) => (
              <MenuRadioItem
                key={p.projectId}
                label={<span className="font-sans">{projectDisplayName(p)}</span>}
                trailing={<Badge>{p.role}</Badge>}
                checked={p.projectId === currentProject?.projectId}
                onSelect={() => {
                  setCurrentProjectId(p.projectId);
                  setProjectOpen(false);
                }}
              />
            ))}
            <MenuSeparator />
            <MenuItem
              glyph={ICONS.plus}
              label={S.project.create}
              onSelect={() => {
                setProjectOpen(false);
                setCreateProjectOpen(true);
              }}
            />
            {currentProject && (
              <MenuItem
                glyph={ICONS.gear}
                label={S.project.settings}
                onSelect={() => {
                  setProjectOpen(false);
                  setProjectSettingsOpen(true);
                }}
              />
            )}
          </Dropdown>
        )
      }
      // New chat: always pinned, in the one slot between the switcher above and the scroll area
      // below; it has no pin button and cannot be dragged. A page row like the nav's (no fill at
      // rest), told apart by its place and its weight, and lit while on the draft page. Its slot
      // belongs to the pinned area, so it also takes an entry dragged out of the collapsible
      // one. Company mode pins nothing here: a channel is made rarely, so "New channel" is the
      // channel list's own header action rather than a permanent row (channel-sidebar.tsx).
      {...(inCompany
        ? {}
        : {
            pinned: (
              <SidebarNavArea drop={navAreaDrop("pinned")}>
                <NavRow
                  surface="muted"
                  label={S.chat.newSessionMenu}
                  tooltip={newChatTitle}
                  // The title adds the shortcut when one is bound.
                  tooltipExtra={newChatTitle !== S.chat.newSessionMenu}
                  glyph={NEW_CHAT_ICON}
                  active={activeSessionId === DRAFT_SESSION_ID}
                  onClick={() => newChat()}
                  className="font-medium"
                />
              </SidebarNavArea>
            ),
          })}
      account={accountRow}
      overlays={dialogs}
    >
      {/* The page nav: in development mode the pinned pages, then the collapsible ones folded
          away under the slim toggle (with nothing collapsible there is no toggle); in company
          mode the organization's six pages, all under the toggle. The fold persists. Folding
          rows tween their height to zero, inert, and leave once folded. The nav and the session
          list scroll together. Mid-drag, an empty pinned run keeps a row's height and a hidden
          toggle band comes back, so either side can take the drop. */}
      <SidebarNavGroup
        collapsed={navCollapsed}
        onToggle={toggleNavGroup}
        expandLabel={S.nav.expandGroup}
        collapseLabel={S.nav.collapseGroup}
        toggleRef={navToggleRef}
        {...(inCompany
          ? {}
          : {
              pinned:
                pinnedNavPages.length > 0 || navDrag !== null ? (
                  <SidebarNavArea
                    drop={navAreaDrop("pinned")}
                    reserve={pinnedNavPages.length === 0}
                  >
                    {pinnedNavPages.map(renderNavEntry)}
                  </SidebarNavArea>
                ) : undefined,
              foldable: collapsibleNavPages.length > 0 || navDrag !== null,
              drop: navAreaDrop("collapsible"),
            })}
      >
        {inCompany
          ? companyNavItems.map((item) => (
              /* A row with nowhere to go keeps its place and its glyph, muted, with nothing to
                 click or tab to. */
              <NavRow
                key={item.key}
                surface="muted"
                label={item.label}
                glyph={item.icon}
                href={item.to ?? ""}
                disabled={item.to === null}
                active={item.to !== null && isCurrentPath(item.to, location.pathname)}
                renderLink={renderRouterLink}
                onClick={() => onNavigate?.()}
              />
            ))
          : collapsibleNavPages.map(renderNavEntry)}
      </SidebarNavGroup>

      {inCompany ? (
        navOrg !== null ? (
          /* Company mode: the organization's channels, where development mode lists
             conversations, and below them its 工位 group — one row per employee's desk. */
          <>
            <ChannelSidebar
              projectId={navOrg.projectId}
              orgId={navOrg.orgId}
              {...(onNavigate ? { onNavigate } : {})}
            />
            <OrgSessionGroups
              projectId={navOrg.projectId}
              orgId={navOrg.orgId}
              activeSessionId={activeSessionId}
              {...(onNavigate ? { onNavigate } : {})}
            />
          </>
        ) : (
          /* No organization to list: the create block, not an empty channel list. */
          <NoOrganizationsSidebar {...(onNavigate ? { onNavigate } : {})} />
        )
      ) : (
        renderMainSessionList(scope)
      )}
    </SidebarFrame>
  );
}
