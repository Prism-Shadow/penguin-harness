import { glyphOf } from "../../lib/nav-icons";
import { marksFor } from "../../lib/sidebar-modes";
import {
  SidebarAccountButton,
  SidebarNavEntry,
  UpdateDot,
  UserAvatar,
} from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import {
  isNavPinned,
  navEntryKeysFor,
  splitNavEntries,
  type NavEntryKey as NavGroupKey,
} from "../../lib/sidebar-nav-state";

import { pageTitle } from "..";
import { UserMenu } from "./user-menu";
import { isCurrentPath, renderRouterLink } from "./router-link";
import { isNavPage } from "../../lib/main-sidebar-persistence";
import type { MainSidebarState } from "../../features/session-list";

export function createMainSidebarNavigation(scope: MainSidebarState) {
  const {
    location,
    user,
    locale,
    badges,
    slotBadges,
    modeStates,
    currentMode,
    notes,
    navCollapsed,
    navPages,
    navPins,
    pinFocusRef,
    navToggleRef,
    setNavPinned,
    navEntryDragProps,
    onNavigate,
  } = scope;

  /**
   * Company mode's nav rows: the organization's six pages (COMPANY_NAV_KEYS) — channels are not
   * among them, they are the list below — all in the fold, with no pins and no drag. Always
   * mounted — the fold animates their height to zero and turns them inert.
   */
  const companyNavItems: Array<{
    key: string;
    /** Where the row leads — null for a row with nowhere to lead, which renders disabled. */
    to: string | null;
    label: string;
    icon: string;
  }> = currentMode < 0 ? [] : [...modeStates[currentMode]!.navItems];

  /**
   * Development mode's entries by area (nav-state.ts): New chat, then the main
   * nav's pages minus the entries this user's role cannot reach, each pinned or
   * collapsible, both areas in page order. New chat is always pinned and renders in its
   * fixed slot above the scroll area, so the pinned rows here are the pages after it.
   */
  const navSplit = splitNavEntries(navEntryKeysFor(navPages, user?.isAdmin === true), navPins);
  const pinnedNavPages = navSplit.pinned.filter(isNavPage);
  const collapsibleNavPages = navSplit.collapsible.filter(isNavPage);

  /**
   * One development-mode page entry: the package's pinnable nav row, bound to its route, its
   * badge trail, its pin choice and its drag. Four entries sit on a badge trail — Agents (an
   * outdated kernel, fixed on the Agent settings page two clicks down), Plugins, Models and the
   * Cost Center (each cleared on the page itself). The row's own label is visible, so the hint
   * only adds what the dot means, and the accessible name keeps the label as its prefix. The dot
   * hangs at the row's right edge, vertically centred on the row.
   */
  const renderNavEntry = (key: NavGroupKey) => {
    const page = navPages.find((page) => page.key === key);
    if (page === undefined) return null;
    const to = page.path;
    const label = pageTitle(page, locale);
    const note = notes.get(key) ?? null;
    const pinned = isNavPinned(key, navPins);
    return (
      <SidebarNavEntry
        key={key}
        label={label}
        glyph={glyphOf(page.icon ?? key)}
        href={to}
        active={isCurrentPath(to, location.pathname)}
        renderLink={renderRouterLink}
        onClick={() => onNavigate?.()}
        {...navEntryDragProps(key)}
        pin={{
          pinned,
          label: S.nav.pinEntry,
          tooltip: pinned ? S.nav.unpinEntry : S.nav.pinEntry,
          onToggle: (e) => {
            // A keyboard toggle follows its row into the other area (see pinFocusRef). A row
            // that lands in the folded area is not on screen: the chevron that unfolds it is the
            // nearest place to stand, read once the move has committed, since the commit may be
            // mounting the chevron itself.
            if (e.currentTarget.matches(":focus-visible")) {
              if (pinned && navCollapsed) {
                requestAnimationFrame(() => navToggleRef.current?.focus());
              } else {
                pinFocusRef.current = key;
              }
            }
            setNavPinned(key, !pinned);
          },
          buttonRef: (el) => {
            if (el === null || pinFocusRef.current !== key) return;
            pinFocusRef.current = null;
            el.focus();
            // A row that lands in an area still folding away is inert and cannot take focus:
            // the chevron again, once this commit is done.
            if (document.activeElement !== el) {
              queueMicrotask(() => navToggleRef.current?.focus());
            }
          },
        }}
        {...(note !== null
          ? {
              ariaLabel: `${label} · ${note}`,
              tooltip: note,
              badge: <UpdateDot size="inline" position="right-2.5 top-1/2 -translate-y-1/2" />,
            }
          : {})}
      />
    );
  };

  /**
   * The account row at the column's foot: the trigger for the account menu both this sidebar and
   * the collapsed rail open (user-menu.tsx).
   */
  const accountRow = (
    <UserMenu
      menuClass="bottom-full left-0 right-0 mb-1 origin-bottom"
      trigger={({ open, toggle }) => (
        <SidebarAccountButton
          expanded={open}
          onClick={toggle}
          // The dot alone is mysterious: name what is waiting on the trigger (hover tooltip +
          // accessible name), in the App info row's own wording.
          {...((notes.get("account") ?? null) !== null
            ? {
                hint: notes.get("account") ?? undefined,
                label: `${user?.displayName ?? user?.userId ?? ""} · ${notes.get("account") ?? null}`,
              }
            : {})}
          avatar={
            <UserAvatar
              userId={user?.userId ?? "?"}
              {...(user?.displayName !== undefined ? { displayName: user.displayName } : {})}
              {...(user?.avatar !== undefined ? { avatar: user.avatar } : {})}
            >
              {/* Update reminder: the menu behind this trigger holds the row that acts on it,
                  and the trigger's tooltip/label above say what it is. */}
              {badges.software !== null && <UpdateDot />}
            </UserAvatar>
          }
          name={user?.displayName ?? user?.userId}
          trailing={
            <>
              {marksFor(slotBadges, "account").map(({ id, Mark }) => (
                <Mark key={id} />
              ))}
            </>
          }
          {...(user?.isAdmin ? { role: S.auth.admin } : {})}
        />
      )}
    />
  );
  return {
    ...scope,
    companyNavItems,
    navSplit,
    pinnedNavPages,
    collapsibleNavPages,
    renderNavEntry,
    accountRow,
  };
}
export type MainSidebarView = ReturnType<typeof createMainSidebarNavigation>;
