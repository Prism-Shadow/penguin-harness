import { Fragment } from "react";
import { marksFor } from "../../lib/sidebar-modes";
import {
  NavRow,
  SidebarAccountButton,
  SidebarNavEntry,
  UpdateDot,
  UserAvatar,
} from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import {
  navChildKeysFor,
  navEntryKeysFor,
  splitModeNavItems,
  splitNavEntries,
  type NavEntryKey as NavGroupKey,
} from "../../lib/sidebar-nav-state";

import { glyphOf } from "../../lib/nav-icons";
import { pageTitle } from "../index";
import { UserMenu } from "./user-menu";
import { isCurrentPath, renderRouterLink } from "./router-link";
import { isNavPage } from "../../lib/main-sidebar-persistence";
import type { MainSidebarState } from "../../features/session-list";

/** One page entry as the nav draws it, in either mode. */
interface NavEntryView {
  key: string;
  /** Where the row leads — null for a row with nowhere to lead, which renders disabled. */
  to: string | null;
  label: string;
  /** The resolved drawing. */
  glyph: string;
  /**
   * The rows this entry carries below it (a page's `parent`), drawn indented: a child has no
   * pin choice and no drag of its own, and it follows its parent's area (nav-state.ts). The
   * collapsed rail draws entries only (rail.tsx lights the parent while a child is open).
   */
  children?: readonly NavEntryView[];
}

export function createMainSidebarNavigation(scope: MainSidebarState) {
  const {
    location,
    locale,
    user,
    badges,
    slotBadges,
    modeStates,
    currentMode,
    notes,
    navCollapsed,
    navPages,
    navPins,
    modeNavPins,
    pinFocusRef,
    navToggleRef,
    setNavPinned,
    isNavEntryPinned,
    navEntryDragProps,
    onNavigate,
  } = scope;

  /** The pages each entry carries below it (nav-state.ts), by the entry's key. */
  const childKeys = navChildKeysFor(navPages, user?.isAdmin === true);
  /** A development-mode page as the nav draws it; nothing for a key with no page. */
  const devNavEntry = (key: NavGroupKey): NavEntryView[] => {
    const page = navPages.find((page) => page.key === key);
    if (page === undefined) return [];
    // A page names itself in the interface's language (PageData.title / titleZh).
    return [
      {
        key,
        to: page.path,
        label: pageTitle(page, locale),
        glyph: glyphOf(page.icon ?? key),
        children: (childKeys.get(key) ?? []).flatMap((child) => devNavRow(child)),
      },
    ];
  };
  /** A page under an entry: a plain indented row — no pin choice and no drag of its own. */
  const devNavRow = (key: NavGroupKey): NavEntryView[] => {
    const page = navPages.find((page) => page.key === key);
    return page === undefined
      ? []
      : [
          {
            key,
            to: page.path,
            label: pageTitle(page, locale),
            glyph: glyphOf(page.icon ?? key),
          },
        ];
  };

  /**
   * The nav's page entries by area, in the current mode. Development mode (nav-state.ts): the
   * main nav's pages minus the entries this user's role cannot reach, after New chat, which is
   * always pinned and drawn as a plain row at the head of the fixed block. A contributed mode:
   * its own rows (company mode: the organization's six pages and the company-mode pages plugins
   * add — channels are not among them, they are the list below), none pinned until the user
   * pins one. Both areas keep their order.
   */
  const navAreas: { pinned: NavEntryView[]; collapsible: NavEntryView[] } = (() => {
    if (currentMode >= 0) {
      const rows = modeStates[currentMode]!.navItems.map((item) => ({
        key: item.key,
        to: item.to,
        label: item.label,
        glyph: glyphOf(item.icon),
        children: item.children?.map((child) => ({
          key: child.key,
          to: child.to,
          label: child.label,
          glyph: glyphOf(child.icon),
        })),
      }));
      return splitModeNavItems(rows, modeNavPins);
    }
    const split = splitNavEntries(navEntryKeysFor(navPages, user?.isAdmin === true), navPins);
    return {
      pinned: split.pinned.filter(isNavPage).flatMap(devNavEntry),
      collapsible: split.collapsible.filter(isNavPage).flatMap(devNavEntry),
    };
  })();

  /**
   * One page entry: the package's pinnable nav row, bound to its route, its badge trail, its pin
   * choice and its drag. In development mode four entries sit on a badge trail — Agents (an
   * outdated kernel, fixed on the Agent settings page two clicks down), Plugins, Models and the
   * Cost Center (each cleared on the page itself). The row's own label is visible, so the hint
   * only adds what the dot means, and the accessible name keeps the label as its prefix. The dot
   * hangs at the row's right edge, vertically centred on the row.
   *
   * A row with nowhere to go (company mode before there is an organization) keeps its place —
   * the area its pin choice puts it in — and its glyph, muted, with nothing to click, drag or tab
   * to, the star included: a live star would be the one control on a row that otherwise answers
   * nothing.
   */
  const renderNavEntry = ({ key, to, label, glyph, children }: NavEntryView) => {
    if (to === null) {
      return <NavRow key={key} surface="muted" label={label} glyph={glyph} href="" disabled />;
    }
    const note = currentMode < 0 ? (notes.get(key) ?? null) : null;
    const pinned = isNavEntryPinned(key);
    const row = (
      <SidebarNavEntry
        key={key}
        label={label}
        glyph={glyph}
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
    if (children === undefined || children.length === 0) return row;
    return (
      <Fragment key={key}>
        {row}
        {children.map((child) => (
          /* A child has no pin choice and no drag of its own (navChildKeysFor): a plain
             indented row under its parent, wherever the parent sits. */
          <div key={child.key} className="ps-5">
            <NavRow
              surface="muted"
              label={child.label}
              glyph={child.glyph}
              href={child.to ?? ""}
              disabled={child.to === null}
              active={child.to !== null && isCurrentPath(child.to, location.pathname)}
              renderLink={renderRouterLink}
              onClick={() => onNavigate?.()}
            />
          </div>
        ))}
      </Fragment>
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
    navAreas,
    renderNavEntry,
    accountRow,
  };
}
export type MainSidebarView = ReturnType<typeof createMainSidebarNavigation>;
