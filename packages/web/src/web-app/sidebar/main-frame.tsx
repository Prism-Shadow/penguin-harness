import type { ReactNode } from "react";
import { DRAFT_SESSION_ID, MainSidebarFragments, renderMainSessionDialogs, renderMainSessionList } from "@prismshadow/penguin-library-session/web";
import { sectionsIn } from "../../lib/sidebar-modes";
import { NavRow, Segmented, SidebarFrame, SidebarNavArea } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";

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
    rootRef,
    newChatTitle,
    collapseTitle,
    canDrag,
    newChat,
    switchMode,
    navEntries,
    renderNavEntry,
    accountRow,
    onNavigate,
    onCollapse,
    initialSearchOpen,
  } = scope;
  const dialogs = renderMainSessionDialogs(scope);
  const mainSessionList = renderMainSessionList(scope);

  /**
   * The fixed block under the switcher, which never scrolls: New chat, then the nav's entries
   * (Agents and the App Center), one run with one row spacing. No entry can be starred, dragged
   * or folded away (PRFC-0033). New chat is a page row like the nav's (no fill at rest), told
   * apart by its place and its weight, and lit while on the draft page. Company mode has no New
   * chat — a channel is made rarely, so "New channel" is the channel list's own header action
   * rather than a permanent row (channel-sidebar.tsx) — and its rows scroll with its lists, so it
   * has no fixed block (the frame keeps the gap).
   */
  const fixedNav: ReactNode | undefined = inCompany ? undefined : (
    <SidebarNavArea>
      <NavRow
        surface="muted"
        label={S.chat.newSessionMenu}
        tooltip={newChatTitle}
        // The title adds the shortcut when one is bound.
        tooltipExtra={newChatTitle !== S.chat.newSessionMenu}
        glyph={NEW_CHAT_ICON}
        active={activeSessionId === DRAFT_SESSION_ID}
        onClick={() => newChat()}
        primary
        className="font-medium"
      />
      {navEntries.map(renderNavEntry)}
    </SidebarNavArea>
  );

  const frame = (
    <SidebarFrame
      rootRef={rootRef}
      // The scroll area (the Session list, or company mode's rows and lists) is one find-in-page
      // region (components/find/).
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
      {/* Company mode's rows (the organization's pages) at the top of the scroll area, above its
          channel list: plain rows that scroll with the lists under them. */}
      {inCompany && navEntries.length > 0 && (
        <nav>
          <SidebarNavArea>{navEntries.map(renderNavEntry)}</SidebarNavArea>
        </nav>
      )}

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
