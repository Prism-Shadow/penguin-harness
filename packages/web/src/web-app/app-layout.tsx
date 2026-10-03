import { backgroundStyle, useBackground } from "../state/background";
import { FindBar } from "../components/find/find-bar";
/**
 * The app's layout route: the UI package's `AppShell` bound to the app's state.
 * - >=md: the navigation column holds the pinned sidebar (Project / new chat / nav / Session list /
 *   user config), or the rail while it is folded, beside the page;
 * - <md: the phone's top bar (the drawer button + the product's name) above the page, and the
 *   sidebar in a drawer.
 * The shell's chrome uses solid fills and makes no stacking context (a frosted glass or a
 * transform would trap the menus it opens); the package's components say how.
 */
import { useEffect, useLayoutEffect, useState } from "react";
import { Outlet, useMatch } from "react-router";
import {
  AppShell,
  Drawer,
  MobileTopBar,
  Notice,
  UpdateDot,
} from "@prismshadow/penguin-ui";
import * as api from "../api/endpoints";
import { nagsAboutInitialPassword } from "../lib/account-menu";
import { S } from "../lib/strings";
import { onCommand } from "../lib/shortcuts/dispatcher";
import { useWebAppLayers } from "./index";
import { useUpdateBadges } from "../lib/use-update-badges";
import { backgroundStyle, useBackground } from "../state/background";
import { dispatchBrowser } from "../features/builtin-browser";
import { useAuth } from "../state/auth";
import { useCompletionNotifications } from "../state/use-completion-notifications";
import { useTrayLocale } from "../state/use-tray-locale";
import { useCompany } from "../lib/company-context";
import { Sidebar } from "./sidebar/sidebar";
import { CollapsedRail } from "./sidebar/rail";
import { useNewChat } from "../features/chat";
import { ChangePasswordDialog } from "../components/account/change-password-dialog";
import { AppInfoDialog } from "../components/account/app-info-dialog";

import { setDockScope } from "../features/dock";

/**
 * Whether the pinned sidebar (or its rail) is on screen: the shell's navigation column is
 * `hidden md:block`, and Tailwind's `md` is 768px at the browser's default font size — a media
 * query ignores the app's 18px root. Below it the drawer's own sidebar answers the commands while
 * it is open.
 */
function pinnedSidebarOnScreen(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches;
}

export function AppLayout() {
  const background = useBackground();
  const { user, desktopMode, sessionVia } = useAuth();
  // The docks belong to the conversation they were arranged in, so switching Sessions
  // switches the arrangement with it (dock-state.ts). The draft page's route id ("new" /
  // a parked draft id), qualified by its Project like the browser's, is a scope of its own,
  // handed to the Session the first send creates; pages with no Session scope to a
  // placeholder. Layout effect, not a plain one: it has to land before the chat page's docks
  // paint, or the outgoing conversation's docks flash on the incoming one.
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
  const layers = useWebAppLayers();
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
  const passwordBannerRelevant =
    Boolean(user?.passwordIsInitial) && nagsAboutInitialPassword({ desktopMode, sessionVia });
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
  // The commands whose surface is this layout. Each declines (returns false, so the browser's
  // own key runs) when its effect could not be seen: the pinned sidebar exists only from the
  // `md` breakpoint up (below it the drawer's own sidebar answers while open), and company mode
  // has neither a session search nor a development New chat. New chat runs from here rather
  // than from the sidebar so it works with the sidebar collapsed to its rail. The search field
  // only exists in the expanded sidebar: with the rail showing, the command expands the sidebar
  // with the field already open (the pinned Sidebar mounts fresh on every expand and takes the
  // flag as its initial state); otherwise it declines and the sidebar's own handler takes it.
  const inCompany = company.workMode === "company";
  const newChat = useNewChat();
  const [openSearchOnExpand, setOpenSearchOnExpand] = useState(false);
  useEffect(() => {
    const offs = [
      onCommand("sidebar.toggle", () => {
        if (!pinnedSidebarOnScreen()) return false;
        setOpenSearchOnExpand(false);
        toggleCollapsed();
      }),
      onCommand("chat.new", () => {
        if (inCompany) return false;
        newChat();
      }),
      onCommand("sessions.search", () => {
        if (inCompany || !pinnedSidebarOnScreen() || !collapsed) return false;
        setOpenSearchOnExpand(true);
        toggleCollapsed();
      }),
    ];
    return () => {
      for (const off of offs) off();
    };
  }, [collapsed, inCompany, newChat]);

  return (
    <AppShell
      background={
        background.image === null
          ? undefined
          : backgroundStyle(background.image, background.settings)
      }
      navCollapsed={collapsed}
      nav={
        collapsed ? (
          <CollapsedRail
            onExpand={() => {
              setOpenSearchOnExpand(false);
              toggleCollapsed();
            }}
          />
        ) : (
          <Sidebar
            onCollapse={() => {
              setOpenSearchOnExpand(false);
              toggleCollapsed();
            }}
            initialSearchOpen={openSearchOnExpand}
          />
        )
      }
      overlays={
        <>
          {/* The App info dialog, opened from the account menu's App info row and the draft
              page's version badge alike; mounted here so it outlives both. */}
          <AppInfoDialog />
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
          {/* The find bar (`find.open` / `find.all`): in the layout, so it serves every route
              that mounts a [data-find-region] container, not only the chat page. */}
          <FindBar />
        </>
      }
    >
      {/* The outermost menu on a phone: it carries a dot for EITHER trail, so its wording is
          the combined one — naming one of two updates would point at the wrong trail. Both
          trails continue inside the drawer's sidebar (the Agents entry, the user row's App info
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
          The shared notice's banner: the sentence and its "change it now" word centred, the
          close cross at the far edge. Permanently dismissible (per-user ui_prefs); only rendered
          once hydrated prefs confirm it was never dismissed, so it does not flash-then-vanish on
          load. */}
      {passwordBannerRelevant && passwordBannerDismissed === false && (
        <Notice
          variant="banner"
          tone="attention"
          action={{ label: S.account.changeNow, onClick: () => setChangePasswordOpen(true) }}
          dismiss={{ ariaLabel: S.common.close, onClick: dismissPasswordBanner }}
        >
          {S.account.initialPasswordBanner}
        </Notice>
      )}

      <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
        <Outlet />
      </main>
      {/* The layers modules contributed (WebAppModule.layers): overlays and headless runtimes,
          mounted once here, outside every page, so navigating never remounts or re-parents
          one — a terminal would reconnect, a built-in browser's webview would reload. */}
      {layers.map(({ id, Component }) => (
        <Component key={id} />
      ))}
    </AppShell>
  );
}
