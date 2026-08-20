/**
 * App main layout:
 * - >=md: left single-column sidebar (Project / new chat / nav / Session list / user config) + main content;
 * - <md: top thin bar (hamburger -> sidebar drawer + brand name) + main content.
 * All chrome uses solid backgrounds and avoids stacking contexts (frosted-glass/transform would trap overlay z-index).
 */
import { useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { NavLink, Outlet, useMatch, useNavigate } from "react-router";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { latestConversation } from "../../lib/session-grouping";
import { useVersionInfo } from "../../lib/use-version-info";
import { useAuth } from "../../state/auth";
import { useProject } from "../../state/project";
import { useSessions } from "../../state/sessions";
import { useCompletionNotifications } from "../../state/use-completion-notifications";
import { Drawer } from "../ui/drawer";
import { GlyphIcon } from "../ui/glyph-icon";
import { NAV_ICONS } from "../ui/icons";
import { NEW_CHAT_ICON, Sidebar } from "./sidebar";
import { DRAFT_SESSION_ID } from "../../features/chat/chat-page";
import { parkActiveDraft } from "../../features/chat/draft-sessions";
import { ChangePasswordDialog } from "../account/change-password-dialog";
import { TerminalDock } from "../../features/terminal/terminal-dock";
import { TerminalDockRuntime } from "../../features/terminal/terminal-view-pool";
import {
  dockSlot,
  dockSlotVersion,
  subscribeDockSlots,
} from "../../features/terminal/terminal-dock-slot";
import {
  dockStateVersion,
  isTerminalDockOpen,
  setDockScope,
  paneHasSlot,
  SIDE_SLOT_TRANSITION_MS,
  visiblePanes,
  subscribeTerminalDock,
} from "../../features/terminal/terminal-dock-state";

/** "Last conversation" glyph (chat lines + resume arrow), used only by the rail. */
const LAST_CHAT_ICON = "M8 10h8M8 14h5M21 12a9 9 0 1 1-4.2-7.6L21 4v5h-5";

/** Shared look of rail entries (icon buttons and NavLinks alike): solid gray fill when active, gray hover otherwise. */
const railItemClass = (active: boolean) =>
  `flex h-8 w-8 items-center justify-center rounded-md transition-colors duration-150 ${
    active
      ? "bg-gray-200/70 text-gray-900 dark:bg-gray-800 dark:text-gray-100"
      : "text-gray-500 hover:bg-gray-200/70 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
  }`;

/**
 * Collapsed narrow rail: expand button on top; below it, in product-specified order, last
 * conversation / new chat / Agents / Skills / Models / Costs / Traces / Benchmark (every entry
 * carries a localized title + aria-label, so hover tooltips follow the UI language); user
 * avatar at the bottom. No Logo shown.
 */
function CollapsedRail({ onExpand }: { onExpand: () => void }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { agents, currentProject, setCurrentAgentId } = useProject();
  const { sessions, loading } = useSessions();
  /**
   * Passive (active=false): never triggers a fetch — the rail mirrors whatever the lazy
   * check has already learned (the pinned sidebar's dropdown or the draft page started it),
   * matching the pinned sidebar's avatar dot. Cache pushes keep it live while mounted.
   */
  const { update } = useVersionInfo(false);
  /** Same "named release only" gate as the pinned sidebar's update row (see sidebar.tsx). */
  const newVersion = update?.updateAvailable === true ? (update.latestVersion ?? null) : null;
  const activeSessionId = useMatch("/chat/:sessionId")?.params.sessionId ?? null;
  /** On some conversation (any non-draft /chat/:id): the "you are here" state of the last-conversation entry. */
  const onConversation = activeSessionId !== null && activeSessionId !== DRAFT_SESSION_ID;

  /** Newest loaded conversation across the current Project (active/schedule only — archived and subagent rows are never auto-opened; the flat list is only ordered per Agent). */
  const lastSession = useMemo(() => latestConversation(sessions), [sessions]);

  /** Mirrors Sidebar.openSession: the current Agent follows the opened Session's Agent. */
  const openLastSession = () => {
    if (!lastSession) return;
    setCurrentAgentId(lastSession.agentId);
    navigate(`/chat/${lastSession.sessionId}`);
  };

  /** Mirrors the pinned sidebar's "New chat": parks any typed-but-unsent draft text first (draft-sessions.ts), then a default_agent draft, falling back to the first Agent (an unresolved list defers resolution to the draft page). */
  const newChat = () => {
    if (user && currentProject) parkActiveDraft(user.userId, currentProject.projectId);
    const agentId = (agents.find((a) => a.agentId === "default_agent") ?? agents[0])?.agentId;
    if (agentId) setCurrentAgentId(agentId);
    navigate(`/chat/${DRAFT_SESSION_ID}`, agentId ? { state: { agentId } } : undefined);
  };

  /** Page entries (rail positions 3-8): same routes, same labels as the pinned nav. */
  const pages: ReadonlyArray<{ to: string; label: string; icon: string }> = [
    { to: "/agents", label: S.nav.agents, icon: NAV_ICONS.agents },
    { to: "/skills", label: S.nav.skills, icon: NAV_ICONS.skills },
    { to: "/models", label: S.nav.models, icon: NAV_ICONS.models },
    { to: "/usage", label: S.nav.usage, icon: NAV_ICONS.usage },
    { to: "/traces", label: S.nav.traces, icon: NAV_ICONS.traces },
    { to: "/benchmark", label: S.nav.benchmark, icon: NAV_ICONS.benchmark },
  ];

  return (
    <div className="flex h-full flex-col items-center gap-1 py-2.5">
      <button
        type="button"
        title={S.nav.expandSidebar}
        aria-label={S.nav.expandSidebar}
        onClick={onExpand}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-gray-500 transition-colors duration-150 hover:bg-gray-200/70 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
      >
        <GlyphIcon d="M9 6l6 6-6 6M20 4v16" size={18} />
      </button>
      {/* The entries scroll as one block, like the pinned sidebar's nav + session list: the rail
          keeps only the expand control and the account avatar at fixed height, so a window too
          short for eight icons scrolls them here instead of pushing them out of the rail and
          growing the document. Scrollbar hidden — at 48px wide it would cost a third of the
          rail's width. */}
      <nav className="no-scrollbar mt-1 flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto">
        {/* 1. Last conversation: lit on any non-draft conversation. Dimmed/disabled (tooltip kept) only
            once the list has settled with no non-archived Session — while it is still loading the
            entry keeps its normal look (no flash) and a click is a graceful no-op. */}
        <button
          type="button"
          title={S.nav.lastConversation}
          aria-label={S.nav.lastConversation}
          disabled={!lastSession && !loading}
          onClick={openLastSession}
          className={
            lastSession || loading
              ? railItemClass(onConversation)
              : "flex h-8 w-8 cursor-not-allowed items-center justify-center rounded-md text-gray-300 dark:text-gray-700"
          }
        >
          <GlyphIcon d={LAST_CHAT_ICON} size={18} />
        </button>
        {/* 2. New chat: shows the same gray active fill while on the draft page (pinned-sidebar convention). */}
        <button
          type="button"
          title={S.chat.newSessionMenu}
          aria-label={S.chat.newSessionMenu}
          onClick={newChat}
          className={railItemClass(activeSessionId === DRAFT_SESSION_ID)}
        >
          <GlyphIcon d={NEW_CHAT_ICON} size={18} />
        </button>
        {/* 3-8. Page entries */}
        {pages.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            title={item.label}
            aria-label={item.label}
            className={({ isActive }) => railItemClass(isActive)}
          >
            <GlyphIcon d={item.icon} size={18} />
          </NavLink>
        ))}
      </nav>
      <button
        type="button"
        title={[user?.userId ?? "", S.nav.expandSidebar]
          .concat(newVersion !== null ? [S.update.newVersion(newVersion)] : [])
          .join(" · ")}
        aria-label={
          newVersion !== null
            ? `${user?.userId ?? ""} · ${S.update.newVersion(newVersion)}`
            : (user?.userId ?? S.auth.admin)
        }
        onClick={onExpand}
        className="relative mt-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-900 text-xs font-bold text-white dark:bg-gray-200 dark:text-gray-900"
      >
        {(user?.userId ?? "?").slice(0, 1).toUpperCase()}
        {/* Update reminder dot, mirroring the pinned sidebar's avatar (same look, same
            border trick against the rail background); the title/aria-label above name the
            release, since the rail has no update row of its own. */}
        {newVersion !== null && (
          <span
            aria-hidden
            className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-gray-50 bg-[var(--accent-bg)] dark:border-gray-900"
          />
        )}
      </button>
    </div>
  );
}

/**
 * Keeps a side pane mounted through its 200ms collapse after its slot goes away (Ctrl+`,
 * closing the pane, moving it to another edge). Unmounting the moment the slot empties is
 * a pop: a width transition needs the node on both ends of it. The pane renders `open`
 * false for the grace period — width 0, inert — and then unmounts for real, which is what
 * finally lets the view pool dispose the xterm view.
 */
function useLingeringSlot(slot: boolean): boolean {
  const [lingering, setLingering] = useState(false);
  useEffect(() => {
    if (slot) {
      setLingering(true);
      return;
    }
    if (!lingering) return;
    const timer = window.setTimeout(() => setLingering(false), SIDE_SLOT_TRANSITION_MS);
    return () => window.clearTimeout(timer);
  }, [slot, lingering]);
  return slot || lingering;
}

export function AppLayout() {
  const { user, desktopMode } = useAuth();
  // The terminal dock belongs to the conversation it was opened in, so switching Sessions
  // switches the arrangement with it. Pages with no Session of their own leave the scope
  // where it was — visiting Settings is not leaving the conversation. Layout effect, not a
  // plain one: it has to land before the panes below paint, or the outgoing conversation's
  // dock flashes on the incoming one.
  const dockScope = useMatch("/chat/:sessionId")?.params.sessionId ?? null;
  useLayoutEffect(() => {
    if (dockScope !== null) setDockScope(dockScope);
  }, [dockScope]);
  // Any dock-state change (panes opening/closing/moving) re-renders the slots below.
  useSyncExternalStore(subscribeTerminalDock, dockStateVersion);
  const dockVisible = isTerminalDockOpen();
  // The arrangement minus anything a chat side panel is displacing (terminal-dock-state.ts).
  const panes = visiblePanes();
  // A displaced SIDE pane stays mounted so it can slide out and back on the same 200ms as
  // the panel that took its place; it renders collapsed (TerminalDock's `open`). Hiding the
  // dock outright still unmounts, which is what disposes the view. Note this cannot key off
  // dockVisible: that already answers "is anything on screen", which a displaced pane is not.
  const hasPane = (p: string) => dockVisible && panes.includes(p as never);
  // Mounted through the exit collapse too — see useLingeringSlot.
  const leftMounted = useLingeringSlot(paneHasSlot("left"));
  const rightMounted = useLingeringSlot(paneHasSlot("right"));
  // A page may donate a spot for its side panes (terminal-dock-slot.tsx). The chat page does,
  // so a pane lines up with the panels it shares the slot with — below the page's own top
  // bar, not squeezing it. Without a donation the pane stays here, beside <main>.
  useSyncExternalStore(subscribeDockSlots, dockSlotVersion);
  const sidePane = (position: "left" | "right", mounted: boolean) => {
    if (!mounted) return null;
    const pane = <TerminalDock position={position} open={hasPane(position)} />;
    const slot = dockSlot(position);
    return slot === null ? pane : createPortal(pane, slot);
  };
  // Desktop shell only (gated inside): system notification when a task finishes while
  // the window is unfocused.
  useCompletionNotifications();
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
      {/* Desktop: single-column sidebar (collapsible to a narrow rail) */}
      <aside
        className={`hidden shrink-0 border-r border-gray-200 bg-gray-50 md:block dark:border-gray-800 dark:bg-gray-900 ${
          collapsed ? "w-12" : "w-64 lg:w-72"
        }`}
      >
        {collapsed ? (
          <CollapsedRail onExpand={toggleCollapsed} />
        ) : (
          <Sidebar onCollapse={toggleCollapsed} />
        )}
      </aside>

      {/* data-dock-host: the drag-to-dock overlay measures this box for its edge bands,
          drop-target widget and landing preview (terminal-dock-layout.tsx). */}
      <div data-dock-host className="flex min-w-0 flex-1 flex-col">
        {/* Mobile: top thin bar (hamburger + brand) */}
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-gray-200 bg-white px-2 md:hidden dark:border-gray-800 dark:bg-gray-950">
          <button
            type="button"
            aria-label={S.chat.sessionList}
            onClick={() => setDrawerOpen(true)}
            className="flex h-9 w-9 items-center justify-center rounded-md text-gray-500 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
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
          </button>
          <span className="text-sm font-semibold">{S.appName}</span>
        </header>

        {/* Initial-password notice banner (seed/admin-set password): disappears once passwordIsInitial clears after a successful change.
            Hidden in desktop mode — the seed password there is random and never shown, so "change it" is meaningless nagging.
            Permanently dismissible via the X on the right (per-user ui_prefs); only rendered once
            hydrated prefs confirm it was never dismissed, so it does not flash-then-vanish on load. */}
        {passwordBannerRelevant && passwordBannerDismissed === false && (
          <div className="relative flex shrink-0 items-center justify-center gap-3 border-b border-amber-200 bg-amber-50 px-8 py-1.5 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
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
              <svg
                width="12"
                height="12"
                viewBox="0 0 14 14"
                fill="none"
                stroke="currentColor"
                aria-hidden
              >
                <path d="M2 2l10 10M12 2L2 12" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        )}

        {/* Integrated terminal (Codex-style), on every page, toggled via Ctrl+` or the
            chat toolbar. The dock is a set of PANES, at most one per edge; the xterm
            views live in TerminalDockRuntime's pool and are adopted into pane bodies by
            DOM handoff, so pane churn (opening, closing, moving edges) never reconnects
            a terminal. data-dock-row anchors the drag preview's geometry. */}
        {hasPane("top") && <TerminalDock position="top" />}
        <div data-dock-row className="flex min-h-0 min-w-0 flex-1">
          {sidePane("left", leftMounted)}
          <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
            <Outlet />
          </main>
          {sidePane("right", rightMounted)}
        </div>
        {hasPane("bottom") && <TerminalDock position="bottom" />}
        <TerminalDockRuntime />
      </div>

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
