import type { ReactNode } from "react";
import {
  MainSidebarFragments,
  renderMainSessionList,
  renderMainSessionDialogs,
} from "../../features/session-list";
import { sectionsIn } from "../../lib/sidebar-modes";
import {
  NavRow,
  Segmented,
  SidebarFrame,
  SidebarNavArea,
  SidebarNavGroup,
} from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { DRAFT_SESSION_ID } from "../../features/chat";
import { isCurrentPath, renderRouterLink } from "./router-link";
import { NEW_CHAT_ICON } from "../../lib/main-sidebar-persistence";
import type { MainSidebarView } from "./main-navigation";

export function renderMainSidebarFrame(scope: MainSidebarView) {
  const {
    location,
    locale,
    activeSessionId,
    sections,
    modeKey,
    offeredModes,
    renderSections,
    inCompany,
    navCollapsed,
    navDrag,
    navToggleRef,
    rootRef,
    newChatTitle,
    collapseTitle,
    canDrag,
    toggleNavGroup,
    navAreaDrop,
    newChat,
    switchMode,
    companyNavItems,
    pinnedNavPages,
    collapsibleNavPages,
    renderNavEntry,
    accountRow,
    onNavigate,
    onCollapse,
    initialSearchOpen,
  } = scope;
  const dialogs = renderMainSessionDialogs(scope);
  const mainSessionList = renderMainSessionList(scope);

  const frame = (
    <SidebarFrame
      rootRef={rootRef}
      // The page nav and the Session list are one find-in-page region (components/find/).
      findRegion="sessions"
      // The work-mode switch, above the Project switcher: 开发 | 公司. Rendered only while
      // company mode is available (the admin master switch and the user's own switch both on);
      // the choice persists per user. The 内测版 tag rides on 公司 — the switch is the one
      // control that names the mode, so the mark stands on the word it qualifies rather than
      // somewhere inside the mode it describes.
      {...(offeredModes.length > 0
        ? {
            modeSwitch: {
              label: S.company.workMode,
              control: (
                <Segmented
                  options={[
                    { value: "dev", label: S.company.modeDev },
                    ...offeredModes.map(({ key, title, titleZh, mode }) => ({
                      value: key,
                      label: locale === "zh" ? titleZh : title,
                      ...(mode.badge
                        ? { badge: { node: <mode.badge.Node />, name: mode.badge.name() } }
                        : {}),
                    })),
                  ]}
                  value={modeKey}
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
        renderSections("header")
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
      overlays={
        <>
          {dialogs}
          {sections.map(({ id, section: { Overlays } }) =>
            Overlays ? <Overlays key={id} /> : null,
          )}
        </>
      }
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
        renderSections("body")
      ) : (
        <MainSidebarFragments.Provider value={{ sessionList: mainSessionList }}>
          {sectionsIn(sections, "dev", "body").map(({ id, section: { Full } }) => (
            <Full key={id} {...(onNavigate ? { onNavigate } : {})} />
          ))}
        </MainSidebarFragments.Provider>
      )}
    </SidebarFrame>
  );
  return sections.reduceRight<ReactNode>(
    (inner, { id, mode, section: { Scope } }) =>
      Scope ? (
        <Scope
          key={id}
          current={mode === modeKey}
          canDrag={canDrag}
          rootRef={rootRef}
          initialSearchOpen={initialSearchOpen}
          {...(onNavigate ? { onNavigate } : {})}
        >
          {inner}
        </Scope>
      ) : (
        inner
      ),
    frame,
  );
}
