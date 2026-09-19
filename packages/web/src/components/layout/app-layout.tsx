/**
 * App main layout:
 * - >=md: left single-column sidebar (Project / new chat / nav / Session list / user config) + main content;
 * - <md: top thin bar (hamburger -> sidebar drawer + brand name) + main content.
 * All chrome uses solid backgrounds and avoids stacking contexts (frosted-glass/transform would trap overlay z-index).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useMatch, useNavigate } from "react-router";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { latestConversation, withoutOrgSessions } from "../../lib/session-grouping";
import { navNoteFor, useUpdateBadges } from "../../lib/use-update-badges";
import { useAuth } from "../../state/auth";
import { useProject } from "../../state/project";
import { useSessions } from "../../state/sessions";
import { useCompletionNotifications } from "../../state/use-completion-notifications";
import { useTrayLocale } from "../../state/use-tray-locale";
import { Drawer } from "../ui/drawer";
import { GlyphIcon } from "../ui/glyph-icon";
import { Tooltip } from "../ui/tooltip";
import { UpdateDot } from "../ui/update-dot";
import { UserAvatar } from "../ui/user-avatar";
import { COMPANY_MODE_ICON, CloseIcon, NAV_ICONS } from "../ui/icons";
import { useCompany } from "../../state/company";
import { COMPANY_NAV_ICONS } from "../../features/company/company-nav-icons";
import { ChannelRailRows } from "../../features/company/channel-sidebar";
import { DeskRailRows } from "../../features/company/org-session-groups";
import {
  COMPANY_NAV_KEYS,
  isOrgRoute,
  orgPagePath,
  parseOrgKey,
} from "../../features/company/company-nav";
import { NEW_CHAT_ICON, Sidebar } from "./sidebar";
import { UserMenu } from "./user-menu";
import { DRAFT_SESSION_ID } from "../../features/chat/chat-page";
import { prepareNewChatDraft } from "../../features/chat/new-chat";
import { ChangePasswordDialog } from "../account/change-password-dialog";
import { UpdateModal } from "../account/update-modal";
import { TerminalDockRuntime } from "../../features/terminal/terminal-view-pool";
import { setDockScope } from "../../features/dock/dock-state";
import { AppPalette } from "../../features/palette/app-palette";
import { toneStrip } from "../../lib/tone";

/**
 * "Last conversation" glyph, used only by the rail: lucide's history mark — a clock read
 * backwards. Deliberately not the bare clock the session list's "most recent" sort option
 * wears (group-list.tsx): that one means "ordered by time", this one means "the conversation
 * you were last in", and the returning arrow is what says so.
 */
const HISTORY_ICON = "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5M12 7v5l4 2";

/** Shared look of rail entries (icon buttons and NavLinks alike): solid gray fill when active, gray hover otherwise. `relative` so an entry can anchor an update badge on its corner (no z-index, so it still creates no stacking context). */
const railItemClass = (active: boolean) =>
  `relative flex h-8 w-8 items-center justify-center rounded-md transition-colors duration-150 ${
    active
      ? "bg-gray-200/70 text-gray-900 dark:bg-gray-800 dark:text-gray-100"
      : "text-gray-500 hover:bg-gray-200/70 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
  }`;

/**
 * Collapsed narrow rail: expand button on top; below it, in product-specified order, last
 * conversation / new chat / Agents / Skills / Models / Costs / Benchmark; user avatar at the
 * bottom, opening the same account menu the pinned sidebar's avatar does. No Logo shown.
 *
 * Every entry is an icon with no visible label, so each carries a localized aria-label and
 * the same words in a styled Tooltip — never also a native `title`, which would put a second
 * tooltip under the first. The entries' own names come from the same strings as the pinned
 * nav's, so the rail follows the UI language with it.
 */
function CollapsedRail({ onExpand }: { onExpand: () => void }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { currentProject, setCurrentAgentId } = useProject();
  const { sessions, loading } = useSessions();
  /**
   * Passive: the layout above owns the one fetch per session, so the rail only reads the
   * shared caches — and gets pushed a result that lands while it is mounted. The avatar
   * mirrors the pinned sidebar's software dot (the user menu behind it holds the update row);
   * every other badge here rides on a page entry, which is where its trail continues.
   */
  const badges = useUpdateBadges();
  const company = useCompany();
  const location = useLocation();
  /** Company mode: the organization's pages replace the development ones, and its channels follow them as rows. */
  const inCompany = company.workMode === "company";
  const navOrg = parseOrgKey(company.currentOrgKey ?? company.lastOrgKey);
  /** Same two moves as the pinned sidebar's switch: company mode enters at /org; development mode only leaves an organization page. */
  const toggleMode = () => {
    const next = inCompany ? "dev" : "company";
    company.setWorkMode(next);
    if (next === "company") navigate("/org");
    else if (isOrgRoute(location.pathname)) navigate("/chat");
  };
  const companyToggleLabel = inCompany
    ? S.company.switchToDev
    : `${S.company.switchToCompany} · ${S.company.beta}`;
  const activeSessionId = useMatch("/chat/:sessionId")?.params.sessionId ?? null;
  /** On some conversation (any non-draft /chat/:id): the "you are here" state of the last-conversation entry. */
  const onConversation = activeSessionId !== null && activeSessionId !== DRAFT_SESSION_ID;

  /** Newest loaded conversation across the current Project (active/schedule only — archived and subagent rows are never auto-opened; the flat list is only ordered per Agent). An organization's desk and ticket Sessions are never conversations of this list. */
  const lastSession = useMemo(() => latestConversation(withoutOrgSessions(sessions)), [sessions]);

  /** Mirrors Sidebar.openSession: the current Agent follows the opened Session's Agent. */
  const openLastSession = () => {
    if (!lastSession) return;
    setCurrentAgentId(lastSession.agentId);
    navigate(`/chat/${lastSession.sessionId}`);
  };

  /** Mirrors the pinned sidebar's "New chat": parks any typed-but-unsent draft text first, then opens a draft that names nothing, so it starts on the Project's new-chat defaults (new-chat.ts). */
  const newChat = () => {
    if (user && currentProject) prepareNewChatDraft(user.userId, currentProject.projectId);
    navigate(`/chat/${DRAFT_SESSION_ID}`);
  };

  /** Page entries (rail positions 3-8): same routes, same labels as the pinned nav.
      Traces is not among them: reading a Trace happens in the chat toolbar's panel
      switcher, which is the only place it happens. */
  const pages: ReadonlyArray<{
    key: string;
    /** Where the entry leads — null while company mode has no organization, which renders it disabled. */
    to: string | null;
    label: string;
    icon: string;
    note: string | null;
  }> = inCompany
    ? COMPANY_NAV_KEYS.map((key) => ({
        key,
        // The six entries keep their places with no organization, disabled: a rail that
        // empties itself reads as a broken shell rather than as an empty one.
        to: navOrg === null ? null : orgPagePath(navOrg.projectId, navOrg.orgId, key),
        label: S.nav.org[key],
        icon: COMPANY_NAV_ICONS[key],
        note: null,
      }))
    : [
        { to: "/agents", label: S.nav.agents, icon: NAV_ICONS.agents },
        { to: "/plugins", label: S.nav.plugins, icon: NAV_ICONS.plugins },
        { to: "/models", label: S.nav.models, icon: NAV_ICONS.models },
        { to: "/usage", label: S.nav.usage, icon: NAV_ICONS.usage },
        { to: "/benchmark", label: S.nav.benchmark, icon: NAV_ICONS.benchmark },
      ].map((item) => ({ ...item, key: item.to, note: navNoteFor(badges, item.to) }));

  /**
   * The rail's avatar hangs its menu off the rail's OUTER edge rather than over the rail:
   * measured at click time as a zero-size point at the avatar's bottom and the aside's right,
   * so a 48px column cannot hold (or clip) a 224px panel. A virtual anchor is a position, not
   * an element, so `anchorOwner` is what tells the panel which scrolls moved it.
   */
  const avatarRef = useRef<HTMLButtonElement>(null);
  const [menuAnchor, setMenuAnchor] = useState<{
    top: number;
    bottom: number;
    left: number;
    right: number;
  } | null>(null);
  const measureMenuAnchor = () => {
    const button = avatarRef.current;
    if (!button) return null;
    const rect = button.getBoundingClientRect();
    const left = (button.closest("aside")?.getBoundingClientRect().right ?? rect.right) + 4;
    return { top: rect.bottom, bottom: rect.bottom, left, right: left };
  };

  /**
   * The avatar's accessible name names the signed-in account — its nickname once there is one,
   * since that is the name the account chose to be called. The trigger itself is nothing but an
   * avatar, so without this the collapsed rail offers a control with no name at all; the visible
   * tooltip says what the control does instead, because neither an initial in a circle nor a
   * photograph is a name a reader needs read back. Both carry what the update trail is waiting
   * on, which from this rail is the only route left to the update row.
   */
  const accountName = user?.displayName ?? user?.userId;
  const avatarName =
    badges.softwareNote !== null
      ? `${accountName ?? ""} · ${badges.softwareNote}`
      : (accountName ?? S.auth.admin);
  const avatarTooltip =
    badges.softwareNote !== null
      ? `${S.nav.userSettings} · ${badges.softwareNote}`
      : S.nav.userSettings;

  return (
    <div className="flex h-full flex-col items-center gap-1 py-2.5">
      <Tooltip label={S.nav.expandSidebar} className="shrink-0">
        <button
          type="button"
          aria-label={S.nav.expandSidebar}
          onClick={onExpand}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-gray-500 transition-colors duration-150 hover:bg-gray-200/70 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
        >
          <GlyphIcon d="M9 6l6 6-6 6M20 4v16" size={18} />
        </button>
      </Tooltip>
      {/* The work-mode toggle, the rail's compact form of the sidebar's 开发 | 公司 switch:
          one building glyph, pressed while in company mode, the tooltip naming the move a
          click makes. Same availability rule as the switch. The move INTO company mode says
          the mode is a beta — the rail has no room for the pill the expanded sidebar carries,
          and the suffix belongs on the label that offers the mode, not on the one that leaves
          it. */}
      {company.available && (
        <Tooltip label={companyToggleLabel} className="shrink-0">
          <button
            type="button"
            aria-label={companyToggleLabel}
            aria-pressed={inCompany}
            onClick={toggleMode}
            className={railItemClass(inCompany)}
          >
            <GlyphIcon d={COMPANY_MODE_ICON} size={18} />
          </button>
        </Tooltip>
      )}
      {/* The entries scroll as one block, like the pinned sidebar's nav + session list: the rail
          keeps only the expand control and the account avatar at fixed height, so a window too
          short for the icons scrolls them here instead of pushing them out of the rail and
          growing the document. Scrollbar hidden — at 48px wide it would cost a third of the
          rail's width. */}
      <nav className="no-scrollbar mt-1 flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto">
        {/* 1. Last conversation: a history mark (a clock read backwards) — the entry goes BACK to
            where the user was, which the returning arrow says and a bare clock face does not.
            Lit on any non-draft conversation. Dimmed/disabled (tooltip kept) only once the list
            has settled with no non-archived Session — while it is still loading the entry keeps
            its normal look (no flash) and a click is a graceful no-op. */}
        <Tooltip label={S.nav.lastConversation}>
          <button
            type="button"
            aria-label={S.nav.lastConversation}
            disabled={!lastSession && !loading}
            onClick={openLastSession}
            className={
              lastSession || loading
                ? railItemClass(onConversation)
                : "flex h-8 w-8 cursor-not-allowed items-center justify-center rounded-md text-gray-300 dark:text-gray-700"
            }
          >
            <GlyphIcon d={HISTORY_ICON} size={18} />
          </button>
        </Tooltip>
        {/* 2. New chat: shows the same gray active fill while on the draft page (pinned-sidebar
            convention). Company mode leaves this slot empty — a channel is made rarely, from
            the channel list's own header, and the rail carries no create control of its own. */}
        {!inCompany && (
          <Tooltip label={S.chat.newSessionMenu}>
            <button
              type="button"
              aria-label={S.chat.newSessionMenu}
              onClick={newChat}
              className={railItemClass(activeSessionId === DRAFT_SESSION_ID)}
            >
              <GlyphIcon d={NEW_CHAT_ICON} size={18} />
            </button>
          </Tooltip>
        )}
        {/* 3-8. Page entries */}
        {pages.map((item) => {
          /* Four entries sit on a badge trail — Agents (an outdated kernel), Skills, Models and
             the Cost Center. The dot itself is decorative: the tooltip and the accessible name
             say what is waiting, and this rail's icons have no visible label, so they carry
             both the entry's name and that sentence. */
          const note = item.note;
          const label = note !== null ? `${item.label} · ${note}` : item.label;
          if (item.to === null) {
            /* Nowhere to go: the icon keeps its place, muted, with no hover fill and nothing
               to click or tab to. The name still stands, so the row is readable. */
            return (
              <Tooltip key={item.key} label={label}>
                <span
                  role="link"
                  aria-label={label}
                  aria-disabled="true"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-gray-300 dark:text-gray-700"
                >
                  <GlyphIcon d={item.icon} size={18} />
                </span>
              </Tooltip>
            );
          }
          return (
            <Tooltip key={item.key} label={label}>
              <NavLink
                to={item.to}
                aria-label={label}
                className={({ isActive }) => railItemClass(isActive)}
              >
                <GlyphIcon d={item.icon} size={18} />
                {note !== null && <UpdateDot />}
              </NavLink>
            </Tooltip>
          );
        })}
        {/* The organization's channels and then its desks, under the pages the way they sit
            under the nav in the pinned sidebar. A hairline says where each run ends; a channel
            row carries its own unread count and a desk its running dot, since a rail with no
            labels must still say how much is waiting. */}
        {inCompany && navOrg !== null && (
          <>
            <span aria-hidden className="my-0.5 h-px w-5 shrink-0 bg-gray-200 dark:bg-gray-800" />
            <ChannelRailRows projectId={navOrg.projectId} orgId={navOrg.orgId} />
            <span aria-hidden className="my-0.5 h-px w-5 shrink-0 bg-gray-200 dark:bg-gray-800" />
            <DeskRailRows projectId={navOrg.projectId} orgId={navOrg.orgId} />
          </>
        )}
      </nav>
      {/* The account menu opens here, on the rail, instead of the avatar expanding the sidebar
          first: appearance and System settings, the update row and signing out all stay one
          click away while collapsed. Same component as the pinned sidebar's (user-menu.tsx). */}
      <UserMenu
        className="mt-auto shrink-0"
        menuClass="w-56 origin-bottom-left"
        portal={{ direction: "up", align: "left" }}
        anchorRect={menuAnchor}
        anchorOwner={() => avatarRef.current}
        trigger={({ open, toggle }) => (
          /* The tooltip names the same avatar the open menu hangs off, so it stands down while
             the menu is up rather than covering it. */
          <Tooltip label={avatarTooltip} suppressed={open}>
            <button
              ref={avatarRef}
              type="button"
              aria-label={avatarName}
              aria-haspopup="menu"
              aria-expanded={open}
              onClick={() => {
                setMenuAnchor(measureMenuAnchor());
                toggle();
              }}
              className="flex h-8 w-8 shrink-0 items-center justify-center"
            >
              {/* The tile is the pinned sidebar's avatar, at its size, inside a rail-sized hit
                  box: the two states swap this element outright, so a tile that changed size
                  between them would pop on every collapse while the box beside it animates
                  smoothly. The button keeps the rail's 32px square, which is every other
                  entry's target. */}
              <UserAvatar
                userId={user?.userId ?? "?"}
                {...(user?.displayName !== undefined ? { displayName: user.displayName } : {})}
                {...(user?.avatar !== undefined ? { avatar: user.avatar } : {})}
              >
                {/* Update reminder, mirroring the pinned sidebar's avatar: the update row sits in
                    the menu this opens, and the label above names what is waiting. */}
                {badges.software !== null && <UpdateDot />}
              </UserAvatar>
            </button>
          </Tooltip>
        )}
      />
    </div>
  );
}

export function AppLayout() {
  const { user, desktopMode } = useAuth();
  // The docks belong to the conversation they were arranged in, so switching Sessions
  // switches the arrangement with it (dock-state.ts). The draft page's route id ("new" /
  // a parked draft id) is a scope of its own, handed to the Session the first send
  // creates; pages with no Session scope to a placeholder. Layout effect, not a plain
  // one: it has to land before the chat page's docks paint, or the outgoing
  // conversation's docks flash on the incoming one.
  const dockScope = useMatch("/chat/:sessionId")?.params.sessionId ?? null;
  useLayoutEffect(() => {
    setDockScope(dockScope);
  }, [dockScope]);
  // Desktop shell only (gated inside): system notification when a task finishes while
  // the window is unfocused.
  useCompletionNotifications();
  // Desktop shell only: keeps the tray menu in the language this window is in.
  useTrayLocale();
  // The single eager owner of the update checks (use-update-badges.ts): one request per
  // browser session, so a dot can be there on a fresh load instead of waiting for someone to
  // open the sidebar menu. Every other anchor reads the same caches passively.
  const badges = useUpdateBadges(true);
  // The drawer holds the sidebar, so the hamburger is named after what the sidebar lists:
  // conversations in development mode, channels in company mode.
  const company = useCompany();
  const drawerName =
    company.workMode === "company" ? S.company.channels.drawerLabel : S.chat.sessionList;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  // Initial-password banner dismissal: server-persisted per user (ui_prefs). null = prefs not
  // hydrated yet — the banner stays unrendered until the stored answer arrives, so an already
  // dismissed banner never flashes before disappearing. Hydration only runs when the banner
  // would show at all; unreachable prefs fail open (treated as not dismissed, banner shows).
  const [passwordBannerDismissed, setPasswordBannerDismissed] = useState<boolean | null>(null);
  const passwordBannerRelevant = Boolean(user?.passwordIsInitial) && !desktopMode;
  useEffect(() => {
    if (!passwordBannerRelevant) return;
    let cancelled = false;
    void api
      .getPrefs()
      .then((res) => {
        if (!cancelled)
          setPasswordBannerDismissed(res.prefs.initialPasswordBannerDismissed === true);
      })
      .catch(() => {
        if (!cancelled) setPasswordBannerDismissed(false);
      });
    return () => {
      cancelled = true;
    };
  }, [passwordBannerRelevant]);
  const dismissPasswordBanner = () => {
    setPasswordBannerDismissed(true);
    // Fire-and-forget: PUT /me/prefs merges shallowly; a lost write only costs persistence,
    // the banner is already hidden for this tab.
    void api.putPrefs({ initialPasswordBannerDismissed: true }).catch(() => undefined);
  };
  // Desktop sidebar collapse (persisted): collapsed state leaves a narrow rail to expand from.
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem("penguin.sidebarCollapsed") === "1",
  );
  const toggleCollapsed = () =>
    setCollapsed((v) => {
      const next = !v;
      localStorage.setItem("penguin.sidebarCollapsed", next ? "1" : "0");
      return next;
    });

  return (
    <div className="flex h-full">
      {/* Desktop: single-column sidebar (collapsible to a narrow rail).
          Collapsing animates the WIDTH, which is the one animation here that transform cannot
          carry: the sidebar is in flow, so the main content reflows beside it rather than
          being slid over. Width is also the only property this box may animate at all —
          transform, will-change and any opacity below 1 each make it a stacking context and
          would trap the z-40 menus the sidebar opens inside it (see the file header).
          `prefers-reduced-motion` is answered globally in styles.css, which drops the
          transition and leaves the resting width correct.
          The panes do NOT cross-fade. Each is rendered at its own final width inside the box
          and clipped by it, so neither is ever laid out against a width it will not keep: the
          rail sits at its final 48px from the first frame while the box closes around it, and
          the pinned sidebar is uncovered left to right instead of reflowing on every frame. */}
      <aside
        className={`hidden shrink-0 overflow-hidden border-r border-gray-200 bg-gray-50 transition-[width] duration-200 ease-out md:block dark:border-gray-800 dark:bg-gray-900 ${
          collapsed ? "w-12" : "w-64 lg:w-72"
        }`}
      >
        <div className={`h-full ${collapsed ? "w-12" : "w-64 lg:w-72"}`}>
          {collapsed ? (
            <CollapsedRail onExpand={toggleCollapsed} />
          ) : (
            <Sidebar onCollapse={toggleCollapsed} />
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile: top thin bar (hamburger + brand) */}
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-gray-200 bg-white px-2 md:hidden dark:border-gray-800 dark:bg-gray-950">
          {/* The outermost menu on a phone: it carries a dot for EITHER trail, so its wording
              is the combined one — naming one of two updates would point at the wrong trail.
              Both trails continue inside the drawer's sidebar (the Agents entry, the user
              row's update entry). */}
          <button
            type="button"
            aria-label={badges.note !== null ? `${drawerName} · ${badges.note}` : drawerName}
            {...(badges.note !== null ? { title: badges.note } : {})}
            onClick={() => setDrawerOpen(true)}
            className="relative flex h-9 w-9 items-center justify-center rounded-md text-gray-500 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              aria-hidden
            >
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
            {badges.any && <UpdateDot />}
          </button>
          <span className="text-sm font-semibold">{S.appName}</span>
        </header>

        {/* Initial-password notice banner (seed/admin-set password): disappears once passwordIsInitial clears after a successful change.
            Hidden in desktop mode — the seed password there is random and never shown, so "change it" is meaningless nagging.
            Permanently dismissible via the X on the right (per-user ui_prefs); only rendered once
            hydrated prefs confirm it was never dismissed, so it does not flash-then-vanish on load. */}
        {passwordBannerRelevant && passwordBannerDismissed === false && (
          <div
            className={`relative flex shrink-0 items-center justify-center gap-3 border-b px-8 py-1.5 text-xs ${toneStrip.attention}`}
          >
            <span>{S.account.initialPasswordBanner}</span>
            <button
              type="button"
              className="shrink-0 font-medium underline underline-offset-2 hover:text-amber-950 dark:hover:text-amber-100"
              onClick={() => setChangePasswordOpen(true)}
            >
              {S.account.changeNow}
            </button>
            {/* Amber-toned twin of the shared CloseButton (same glyph + aria-label) — its hardcoded
                gray colors would clash here. Flat: hover feedback is icon-color-only (no background
                fill), same hover shades as the change-now link. Absolutely positioned at the right
                edge: near-full-height hit area without growing the banner and without transform (see
                the stacking-context note in the file header); the banner's symmetric px-8 keeps the
                centered text clear. */}
            <button
              type="button"
              aria-label={S.common.close}
              title={S.common.close}
              onClick={dismissPasswordBanner}
              className="absolute inset-y-0.5 right-1.5 flex items-center rounded-md px-1 text-amber-500 transition-colors duration-150 hover:text-amber-950 dark:text-amber-400/70 dark:hover:text-amber-100"
            >
              <CloseIcon size={12} />
            </button>
          </div>
        )}

        <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
          <Outlet />
        </main>
        {/* The docks themselves render inside the chat page (features/dock); the xterm
            views live in this pool and are adopted into dock tab bodies by DOM handoff,
            so navigating between pages never reconnects a terminal. */}
        <TerminalDockRuntime />
        <AppPalette />
      </div>

      {/* The software-update modal, opened from the sidebar's update row and the draft
          page's version badge alike; mounted here so it outlives both. */}
      <UpdateModal />
      <ChangePasswordDialog
        open={changePasswordOpen}
        onClose={() => setChangePasswordOpen(false)}
      />

      {/* Mobile: sidebar drawer */}
      <Drawer open={drawerOpen} side="left" title={S.appName} onClose={() => setDrawerOpen(false)}>
        <div className="h-full bg-gray-50 dark:bg-gray-900">
          <Sidebar onNavigate={() => setDrawerOpen(false)} />
        </div>
      </Drawer>
    </div>
  );
}
