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
import { navChildKeysFor, navKeysFor } from "../../lib/nav-pages";

import { APP_CENTER_PATH } from "../../lib/app-center-path";
import { glyphOf } from "../../lib/nav-icons";
import { pageTitle } from "../index";
import { UserMenu } from "./user-menu";
import { isCurrentPath, renderRouterLink } from "./router-link";
import type { MainSidebarState } from "@prismshadow/penguin-library-session/web";

/** One page entry as the nav draws it, in either mode. */
interface NavEntryView {
  key: string;
  /** Where the row leads — null for a row with nowhere to lead, which renders disabled. */
  to: string | null;
  label: string;
  /** The resolved drawing. */
  glyph: string;
  /**
   * The rows this entry carries below it (a page's `parent`), drawn indented under it. The
   * collapsed rail draws entries only (rail.tsx lights the parent while a child is open).
   */
  children?: readonly NavEntryView[];
}

/**
 * The nav as the sidebar draws it. `onSystemApp`: the page on screen is a system app or lies under
 * one (lib/system-apps.ts), where the App Center's row is lit, since that is where those open.
 * `appRowLit`: an app's own row in the Apps list is the current page (an app window is open under
 * `/apps?app=…`, or a system app is on screen), so the App Center's row is not: it is lit only
 * while its grid is what shows.
 */
export function createMainSidebarNavigation(
  scope: MainSidebarState,
  onSystemApp = false,
  appRowLit = false,
) {
  const {
    location,
    locale,
    user,
    badges,
    slotBadges,
    modeStates,
    currentMode,
    notes,
    navPages,
    onNavigate,
  } = scope;

  /** The pages each entry carries below it (lib/nav-pages.ts), by the entry's key. */
  const childKeys = navChildKeysFor(navPages, user?.isAdmin === true);
  /** A development-mode page as the nav draws it; nothing for a key with no page. */
  const devNavRow = (key: string): NavEntryView[] => {
    const page = navPages.find((page) => page.key === key);
    if (page === undefined) return [];
    // A page names itself in the interface's language (PageData.title / titleZh).
    return [
      { key, to: page.path, label: pageTitle(page, locale), glyph: glyphOf(page.icon ?? key) },
    ];
  };

  /**
   * The nav's page entries in the current mode, in order. Development mode: the main nav's pages
   * minus the entries this user's role cannot reach (Agents and the App Center), each with the
   * pages under it; New chat heads them in the fixed block (main-frame.tsx). A contributed mode:
   * its own rows (company mode: the organization's six pages and the company-mode pages plugins
   * add — channels are not among them, they are the list below).
   */
  const navEntries: NavEntryView[] =
    currentMode >= 0
      ? modeStates[currentMode]!.navItems.map((item) => ({
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
        }))
      : navKeysFor(navPages, user?.isAdmin === true).flatMap((key) =>
          devNavRow(key).map((entry) => ({
            ...entry,
            children: (childKeys.get(key) ?? []).flatMap(devNavRow),
          })),
        );

  /**
   * One page entry: the column's nav row, bound to its route and its badge trail. In development
   * mode two entries sit on badge trails — Agents (an outdated kernel, fixed on the Agent settings
   * page two clicks down) and the App Center, whose one dot covers the system apps' trails
   * (Plugins, Models and the Cost Center, each cleared on its page; lib/system-app-notes.ts) and
   * whose hint joins their sentences. The row's own label is visible, so the hint only adds what
   * the dot means (marked extra, so it shows over the visible label), and the accessible name
   * keeps the label as its prefix. The dot hangs at the row's right edge, vertically centred on
   * the row.
   *
   * A row with nowhere to go (company mode before there is an organization) keeps its place and
   * its glyph, muted, with nothing to click or tab to.
   */
  const renderNavEntry = ({ key, to, label, glyph, children }: NavEntryView) => {
    if (to === null) {
      return <NavRow key={key} surface="muted" label={label} glyph={glyph} href="" disabled />;
    }
    const note = currentMode < 0 ? (notes.get(key) ?? null) : null;
    const row = (
      <SidebarNavEntry
        key={key}
        label={label}
        glyph={glyph}
        href={to}
        active={
          to === APP_CENTER_PATH
            ? !appRowLit && (isCurrentPath(to, location.pathname) || onSystemApp)
            : isCurrentPath(to, location.pathname)
        }
        renderLink={renderRouterLink}
        onClick={() => onNavigate?.()}
        {...(note !== null
          ? {
              ariaLabel: `${label} · ${note}`,
              // The sentence is not on screen beside the label: the hint shows over it.
              tooltip: note,
              tooltipExtra: true,
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
          /* A child is a plain indented row under its parent. */
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
    navEntries,
    renderNavEntry,
    accountRow,
  };
}
export type MainSidebarView = ReturnType<typeof createMainSidebarNavigation>;
