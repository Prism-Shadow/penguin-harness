import { backgroundStyle, useBackground } from "../state/background";
/**
 * The app's layout route: the UI package's `AppShell` bound to the app's state.
 * - >=md: the navigation column holds the pinned sidebar (Project / new chat / nav / Session list /
 *   user config), or the rail while it is folded, beside the page;
 * - <md: the phone's top bar (the drawer button + the product's name) above the page, and the
 *   sidebar in a drawer.
 * The shell's chrome uses solid fills and makes no stacking context (a frosted glass or a
 * transform would trap the menus it opens); the package's components say how.
 */
import { useEffect, useRef, useState } from "react";
import { Outlet } from "react-router";
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
import { webAppDeps } from "./deps";
import { useAuth } from "../state/auth";
import { useCompletionNotifications } from "../state/use-completion-notifications";
import { useTrayLocale } from "../state/use-tray-locale";
import { ChangePasswordDialog } from "../components/account/change-password-dialog";
import { AppInfoDialog } from "../components/account/app-info-dialog";

import { setDockScope } from "../features/dock";
import { FindBar } from "../components/find/find-bar";
import { useContributedWidgets, widgetStore, type ContributedWidget } from "../lib/widgets";

/**
 * Whether the pinned sidebar (or its rail) is on screen: the shell's navigation column is
 * `hidden md:block`, and Tailwind's `md` is 768px at the browser's default font size — a media
 * query ignores the app's 18px root. Below it the drawer's own sidebar answers the commands while
 * it is open.
 */
function pinnedSidebarOnScreen(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches;
}

/**
 * The plugin widget dock: the widgets the server contributed (`WebModule.widgets`), one tile
 * each, docked at the layout's bottom-right corner. A tile shows the widget's initial (its
 * title's first grapheme) until clicked, then opens its iframe over the dock — a small
 * always-visible surface a page would be too heavy for. A widget that declares `chrome: "bare"`
 * opens as its own document, which then draws everything including how it is closed
 * (BareWidget); any other opens in a titled card with a close button. Only an iframe widget
 * draws today; builtin names are contributed but wait for a registry entry.
 */
function WidgetDock() {
  const widgets = useContributedWidgets();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    void widgetStore().refresh().then(() => setLoaded(true));
  }, []);
  if (!loaded || widgets.length === 0) return null;
  const open = widgets.find((w) => w.key === openKey) ?? null;
  return (
    <div className="fixed right-3 bottom-10 z-40 flex flex-col items-end gap-2 print:hidden">
      {open !== null &&
        "iframe" in open.renderer &&
        (open.chrome === "bare" ? (
          <BareWidget
            src={open.renderer.iframe.src}
            title={open.titleZh ?? open.title ?? open.key}
          />
        ) : (
          <div className="flex flex-col overflow-hidden rounded-xl border border-border-subtle bg-surface shadow-lg">
            <div className="flex items-center justify-between px-3 py-1.5 text-sm text-content-secondary">
              <span>{open.titleZh ?? open.title ?? open.key}</span>
              <button
                type="button"
                className="ml-3 cursor-pointer text-content-faint hover:text-content"
                aria-label="Close widget"
                onClick={() => setOpenKey(null)}
              >
                ✕
              </button>
            </div>
            <iframe
              src={open.renderer.iframe.src}
              title={open.titleZh ?? open.title ?? open.key}
              className="h-64 w-72 border-0 bg-transparent"
            />
          </div>
        ))}
      <div className="flex gap-2">
        {widgets.map((w) => (
          <WidgetTile key={w.id} widget={w} open={w.key === openKey} onToggle={() => setOpenKey(w.key === openKey ? null : w.key)} />
        ))}
      </div>
    </div>
  );
}

/**
 * A widget that draws itself (`chrome: "bare"`): the iframe alone — no border, no background,
 * no title bar, no close button; the dock's tile above opens and closes it.
 *
 * Left alone, a frame that size would swallow every click over its rectangle, so it is
 * `pointer-events: none` and the page beneath keeps working. While the pointer is over the
 * frame — or a finger taps in it — the host relays the position to the document as
 * `{ penguin: "widget-probe", x, y }` in the frame's own pixels; the document answers
 * `{ penguin: "widget-over", over }` when the position is on something it drew, and only then
 * does the frame take pointer events. The document reports the pointer leaving by itself,
 * which hands the page the pointer back.
 */
function BareWidget({ src, title }: { src: string; title: string }) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [over, setOver] = useState(false);
  useEffect(() => {
    const onAnswer = (e: MessageEvent) => {
      const data = e.data as { penguin?: unknown; over?: unknown } | null;
      if (data?.penguin !== "widget-over" || typeof data.over !== "boolean") return;
      if (e.source !== frameRef.current?.contentWindow) return;
      setOver(data.over);
    };
    addEventListener("message", onAnswer);
    return () => removeEventListener("message", onAnswer);
  }, []);
  useEffect(() => {
    if (over) return; // the frame holds the pointer now; it says when the pointer has left it
    const relay = (e: PointerEvent) => {
      const frame = frameRef.current;
      if (frame === null || frame.contentWindow === null) return;
      const box = frame.getBoundingClientRect();
      const x = e.clientX - box.left;
      const y = e.clientY - box.top;
      if (x < 0 || y < 0 || x > box.width || y > box.height) return;
      frame.contentWindow.postMessage({ penguin: "widget-probe", x, y }, location.origin);
    };
    addEventListener("pointermove", relay);
    // A touch has no move before its tap, so the tap itself asks where it landed.
    addEventListener("pointerdown", relay);
    return () => {
      removeEventListener("pointermove", relay);
      removeEventListener("pointerdown", relay);
    };
  }, [over]);
  return (
    <iframe
      ref={frameRef}
      src={src}
      title={title}
      className="h-64 w-72 border-0 bg-transparent"
      style={{ pointerEvents: over ? "auto" : "none" }}
    />
  );
}

function WidgetTile({
  widget,
  open,
  onToggle,
}: {
  widget: ContributedWidget;
  open: boolean;
  onToggle: () => void;
}) {
  const title = widget.titleZh ?? widget.title ?? widget.key;
  const initial = [...title][0] ?? "?";
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={open}
      title={title}
      className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-border-subtle bg-surface text-base shadow-md hover:bg-surface-muted"
    >
      {initial}
    </button>
  );
}

export function AppLayout() {
  const background = useBackground();
  const { user, desktopMode, sessionVia } = useAuth();
  const { sidebar, drafts } = webAppDeps.useDeps();
  // Desktop shell only (gated inside): system notification when a task finishes while
  // the window is unfocused.
  useCompletionNotifications();
  // Desktop shell only: keeps the tray menu in the language this window is in.
  useTrayLocale();
  const layers = useWebAppLayers();
  // The drawer holds the sidebar, so the drawer button is named after what the sidebar lists:
  // conversations in development mode, the current mode's own list in another; its badge
  // covers every one inside (the sidebar's `menu` anchor).
  const column = sidebar.useColumnState();
  const drawerName = column.listName;
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
  // `md` breakpoint up (below it the drawer's own sidebar answers while open), and a contributed
  // mode has neither a session search nor a development New chat. New chat runs from here rather
  // than from the sidebar so it works with the sidebar collapsed to its rail. The search field
  // only exists in the expanded sidebar: with the rail showing, the command expands the sidebar
  // with the field already open (the pinned Sidebar mounts fresh on every expand and takes the
  // flag as its initial state); otherwise it declines and the sidebar's own handler takes it.
  const inDefaultMode = column.inDefaultMode;
  const newChat = drafts.useNewChat();
  const [openSearchOnExpand, setOpenSearchOnExpand] = useState(false);
  useEffect(() => {
    const offs = [
      onCommand("sidebar.toggle", () => {
        if (!pinnedSidebarOnScreen()) return false;
        setOpenSearchOnExpand(false);
        toggleCollapsed();
      }),
      onCommand("chat.new", () => {
        if (!inDefaultMode) return false;
        newChat();
      }),
      onCommand("sessions.search", () => {
        if (!inDefaultMode || !pinnedSidebarOnScreen() || !collapsed) return false;
        setOpenSearchOnExpand(true);
        toggleCollapsed();
      }),
    ];
    return () => {
      for (const off of offs) off();
    };
  }, [collapsed, inDefaultMode, newChat]);

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
          <sidebar.Rail
            onExpand={() => {
              setOpenSearchOnExpand(false);
              toggleCollapsed();
            }}
          />
        ) : (
          <sidebar.Column
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
              <sidebar.Column onNavigate={() => setDrawerOpen(false)} />
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
        menuLabel={column.menuNote !== null ? `${drawerName} · ${column.menuNote}` : drawerName}
        {...(column.menuNote !== null
          ? { menuHint: column.menuNote, menuBadge: <UpdateDot /> }
          : {})}
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
      {/* The plugin widget dock: one collapsed tile per contributed widget above the status
          bar's corner, clicked open into its frame. The widgets' own fetch runs beside the
          page table's (the dock mounts outside the router), so a plugin install shows here
          on the next refresh. */}
      <WidgetDock />
      {/* The layers modules contributed (WebAppModule.layers): overlays and headless runtimes,
          mounted once here, outside every page, so navigating never remounts or re-parents
          one — a terminal would reconnect, a built-in browser's webview would reload. */}
      {layers.map(({ id, Component }) => (
        <Component key={id} />
      ))}
    </AppShell>
  );
}
