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
import { NEW_CHAT_ICON } from "../../lib/main-sidebar-persistence";
import type { MainSidebarView } from "./main-navigation";

export function renderMainSidebarFrame(scope: MainSidebarView) {
  const {
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
    navAreas,
    renderNavEntry,
    accountRow,
    onNavigate,
    onCollapse,
    initialSearchOpen,
  } = scope;
  const dialogs = renderMainSessionDialogs(scope);
  const mainSessionList = renderMainSessionList(scope);

  /**
   * The fixed block under the switcher, which never scrolls: New chat, then the favourites, one
   * run with one row spacing. New chat is always pinned: no star, no drag. A page row like the
   * nav's (no fill at rest), told apart by its place and its weight, and lit while on the draft
   * page. Company mode has no New chat — a channel is made rarely, so "New channel" is the
   * channel list's own header action rather than a permanent row (channel-sidebar.tsx) — so its
   * block holds only its favourites, and with none it is not drawn at all (the frame keeps the
   * gap) unless a drag needs somewhere to land.
   */
  const fixedNav: ReactNode | undefined = inCompany ? (
    navAreas.pinned.length > 0 || navDrag !== null ? (
      <SidebarNavArea drop={navAreaDrop("pinned")} reserve={navAreas.pinned.length === 0}>
        {navAreas.pinned.map(renderNavEntry)}
      </SidebarNavArea>
    ) : undefined
  ) : (
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
      {navAreas.pinned.map(renderNavEntry)}
    </SidebarNavArea>
  );

  const frame = (
    <SidebarFrame
      rootRef={rootRef}
      // The nav's fold and the Session list are one find-in-page region (components/find/).
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
      {...(fixedNav === undefined ? {} : { pinned: fixedNav })}
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
      {/* The nav's fold, at the top of the scroll area: the entries that are not favourites,
          folded away under the slim toggle (with nothing collapsible there is no toggle), in
          either mode. The fold persists. Folding rows tween their height to zero, inert, and
          leave once folded. The fold scrolls with the list; the favourites above it do not.
          Mid-drag, an empty fixed block keeps a row's height and a hidden toggle band comes
          back, so either side can take the drop. */}
      <SidebarNavGroup
        collapsed={navCollapsed}
        onToggle={toggleNavGroup}
        expandLabel={S.nav.expandGroup}
        collapseLabel={S.nav.collapseGroup}
        toggleRef={navToggleRef}
        foldable={navAreas.collapsible.length > 0 || navDrag !== null}
        drop={navAreaDrop("collapsible")}
      >
        {navAreas.collapsible.map(renderNavEntry)}
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
