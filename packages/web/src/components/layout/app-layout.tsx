/**
 * The app's layout route: the UI package's `AppShell` bound to the app's state.
 * - >=md: the navigation column holds the pinned sidebar (Project / new chat / nav / Session list /
 *   user config), or the rail while it is folded, beside the page;
 * - <md: the phone's top bar (the drawer button + the product's name) above the page, and the
 *   sidebar in a drawer.
 * The shell's chrome uses solid fills and makes no stacking context (a frosted glass or a
 * transform would trap the menus it opens); the package's components say how.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Outlet, useLocation, useMatch, useNavigate } from "react-router";
import {
  AppShell,
  CloseIcon,
  Drawer,
  ICONS,
  MobileTopBar,
  NoticeStrip,
  Rail,
  RailAccountButton,
  RailDivider,
  RailItem,
  Tooltip,
  UpdateDot,
  UserAvatar,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { latestConversation, withoutOrgSessions } from "../../lib/session-grouping";
import { navNoteFor, useUpdateBadges } from "../../lib/use-update-badges";
import { useAuth } from "../../state/auth";
import { useProject } from "../../state/project";
import { useSessions } from "../../state/sessions";
import { useCompletionNotifications } from "../../state/use-completion-notifications";
import { useTrayLocale } from "../../state/use-tray-locale";
import { NAV_ICONS } from "../../lib/nav-icons";
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
import { isCurrentPath, renderRouterLink } from "./router-link";
import { DRAFT_SESSION_ID } from "../../features/chat/chat-page";
import { prepareNewChatDraft } from "../../features/chat/new-chat";
import { ChangePasswordDialog } from "../account/change-password-dialog";
import { UpdateModal } from "../account/update-modal";
import { TerminalDockRuntime } from "../../features/terminal/terminal-view-pool";
import { setDockScope } from "../../features/dock/dock-state";
import { AppPalette } from "../../features/palette/app-palette";

/**
 * The folded navigation column: the unfold button on top; below it, in product-specified order,
 * last conversation / new chat / Agents / Skills / Models / Costs / Benchmark; the user avatar at
 * the bottom, opening the same account menu the pinned sidebar's avatar does. No logo.
 *
 * Every entry is an icon with no visible label, so each carries a localized name and the same
 * words in a styled tooltip (the package's `RailItem`). The entries' names come from the same
 * strings as the pinned nav's, so the rail follows the UI language with it.
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
  // The move INTO company mode says the mode is a beta: the rail has no room for the pill the
  // expanded sidebar carries, and the suffix belongs on the label that offers the mode, not on
  // the one that leaves it.
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
    <Rail
      head={
        <>
          <RailItem
            label={S.nav.expandSidebar}
            glyph={ICONS.chevronRightPipe}
            onClick={onExpand}
            className="shrink-0"
          />
          {/* The work-mode toggle, the rail's compact form of the sidebar's 开发 | 公司 switch:
              one building glyph, pressed while in company mode, the tooltip naming the move a
              click makes. Same availability rule as the switch. */}
          {company.available && (
            <RailItem
              label={companyToggleLabel}
              glyph={ICONS.building}
              pressed={inCompany}
              onClick={toggleMode}
              className="shrink-0"
            />
          )}
        </>
      }
      foot={
        /* The account menu opens here, on the rail, instead of the avatar expanding the sidebar
           first: appearance and Settings, the update row and signing out all stay one click
           away while collapsed. Same component as the pinned sidebar's (user-menu.tsx). */
        <UserMenu
          className="mt-auto shrink-0"
          menuClass="w-56 origin-bottom-left"
          portal={{ direction: "up", align: "left" }}
          anchorRect={menuAnchor}
          anchorOwner={() => avatarRef.current}
          trigger={({ open, toggle }) => (
            /* The tooltip names the same avatar the open menu hangs off, so it stands down
               while the menu is up rather than covering it. */
            <Tooltip label={avatarTooltip} suppressed={open}>
              <RailAccountButton
                buttonRef={avatarRef}
                label={avatarName}
                expanded={open}
                onClick={() => {
                  setMenuAnchor(measureMenuAnchor());
                  toggle();
                }}
              >
                <UserAvatar
                  userId={user?.userId ?? "?"}
                  {...(user?.displayName !== undefined ? { displayName: user.displayName } : {})}
                  {...(user?.avatar !== undefined ? { avatar: user.avatar } : {})}
                >
                  {/* Update reminder, mirroring the pinned sidebar's avatar: the update row sits
                      in the menu this opens, and the label above names what is waiting. */}
                  {badges.software !== null && <UpdateDot />}
                </UserAvatar>
              </RailAccountButton>
            </Tooltip>
          )}
        />
      }
    >
      {/* 1. Last conversation: a history mark (a clock read backwards) — the entry goes BACK to
          where the user was. Lit on any non-draft conversation. Dimmed/disabled (tooltip kept)
          only once the list has settled with no non-archived Session — while it is still
          loading the entry keeps its normal look (no flash) and a click is a graceful no-op. */}
      <RailItem
        label={S.nav.lastConversation}
        glyph={ICONS.history}
        active={onConversation}
        disabled={!lastSession && !loading}
        onClick={openLastSession}
      />
      {/* 2. New chat: lit while on the draft page (pinned-sidebar convention). Company mode
          leaves this slot empty — a channel is made rarely, from the channel list's own header,
          and the rail carries no create control of its own. */}
      {!inCompany && (
        <RailItem
          label={S.chat.newSessionMenu}
          glyph={NEW_CHAT_ICON}
          active={activeSessionId === DRAFT_SESSION_ID}
          onClick={newChat}
        />
      )}
      {/* 3-8. Page entries. Four sit on a badge trail — Agents (an outdated kernel), Skills,
          Models and the Cost Center. The dot is decorative: this rail's icons have no visible
          label, so the name and the hint carry both the entry and what is waiting. An entry
          with nowhere to go keeps its place, muted, with nothing to click or tab to. */}
      {pages.map((item) => {
        const label = item.note !== null ? `${item.label} · ${item.note}` : item.label;
        return (
          <RailItem
            key={item.key}
            label={label}
            glyph={item.icon}
            href={item.to ?? ""}
            disabled={item.to === null}
            active={item.to !== null && isCurrentPath(item.to, location.pathname)}
            renderLink={renderRouterLink}
            {...(item.note !== null ? { badge: <UpdateDot /> } : {})}
          />
        );
      })}
      {/* The organization's channels and then its desks, under the pages the way they sit
          under the nav in the pinned sidebar. A hairline says where each run ends; a channel
          row carries its own unread count and a desk its running dot, since a rail with no
          labels must still say how much is waiting. */}
      {inCompany && navOrg !== null && (
        <>
          <RailDivider />
          <ChannelRailRows projectId={navOrg.projectId} orgId={navOrg.orgId} />
          <RailDivider />
          <DeskRailRows projectId={navOrg.projectId} orgId={navOrg.orgId} />
        </>
      )}
    </Rail>
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
  // The drawer holds the sidebar, so the drawer button is named after what the sidebar lists:
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
    <AppShell
      navCollapsed={collapsed}
      nav={
        collapsed ? (
          <CollapsedRail onExpand={toggleCollapsed} />
        ) : (
          <Sidebar onCollapse={toggleCollapsed} />
        )
      }
      overlays={
        <>
          {/* The software-update modal, opened from the sidebar's update row and the draft
              page's version badge alike; mounted here so it outlives both. */}
          <UpdateModal />
          <ChangePasswordDialog
            open={changePasswordOpen}
            onClose={() => setChangePasswordOpen(false)}
          />
          {/* Mobile: the sidebar in a drawer, on the navigation column's own fill. */}
          <Drawer
            open={drawerOpen}
            side="left"
            title={S.appName}
            onClose={() => setDrawerOpen(false)}
          >
            <div className="h-full bg-surface-muted">
              <Sidebar onNavigate={() => setDrawerOpen(false)} />
            </div>
          </Drawer>
        </>
      }
    >
      {/* The outermost menu on a phone: it carries a dot for EITHER trail, so its wording is
          the combined one — naming one of two updates would point at the wrong trail. Both
          trails continue inside the drawer's sidebar (the Agents entry, the user row's update
          entry). */}
      <MobileTopBar
        title={S.appName}
        menuLabel={badges.note !== null ? `${drawerName} · ${badges.note}` : drawerName}
        {...(badges.note !== null ? { menuHint: badges.note } : {})}
        {...(badges.any ? { menuBadge: <UpdateDot /> } : {})}
        onMenu={() => setDrawerOpen(true)}
      />

      {/* Initial-password notice banner (seed/admin-set password): disappears once passwordIsInitial clears after a successful change.
          Hidden in desktop mode — the seed password there is random and never shown, so "change it" is meaningless nagging.
          Permanently dismissible via the X on the right (per-user ui_prefs); only rendered once
          hydrated prefs confirm it was never dismissed, so it does not flash-then-vanish on load. */}
      {passwordBannerRelevant && passwordBannerDismissed === false && (
        <NoticeStrip
          tone="attention"
          className="relative flex shrink-0 items-center justify-center gap-3 border-b px-8 py-1.5 text-xs"
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
            data-tooltip={S.common.close}
            onClick={dismissPasswordBanner}
            className="absolute inset-y-0.5 right-1.5 flex items-center rounded-md px-1 text-amber-500 transition-colors duration-150 hover:text-amber-950 dark:text-amber-400/70 dark:hover:text-amber-100"
          >
            <CloseIcon size={12} />
          </button>
        </NoticeStrip>
      )}

      <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
        <Outlet />
      </main>
      {/* The docks themselves render inside the chat page (features/dock); the xterm
          views live in this pool and are adopted into dock tab bodies by DOM handoff,
          so navigating between pages never reconnects a terminal. */}
      <TerminalDockRuntime />
      <AppPalette />
    </AppShell>
  );
}
