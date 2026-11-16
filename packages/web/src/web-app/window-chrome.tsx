/**
 * The desktop window's chrome as the page draws it, from the shell's bridge (lib/window-bridge.ts).
 * Without the bridge — a browser, or an older desktop shell — both render nothing and change
 * nothing.
 *
 * - `WindowChrome`, mounted once beside the router, is what makes the page the band's owner: it
 *   sets the band's height (`--window-band-height`: the Window Controls Overlay's on macOS, the
 *   bridge's where there is none) and `data-window-controls` on <html>, which tells the shell to
 *   withdraw its fallback band, and on Windows and Linux it draws minimize, maximize or restore and
 *   close at the band's right end. It sits outside every route so the sign-in page and a full-page
 *   Workbench have the buttons too, and a crashed page cannot take them away.
 * - `TitleBand` is the app window's band controls: the sidebar toggle (the same action as the
 *   sidebar's fold button, which the window then leaves out), and back and forward through the
 *   window's history, each available only when there is somewhere to go.
 */
import { useLayoutEffect } from "react";
import { useNavigate } from "react-router";
import { ICONS, WindowBandButton, WindowControls } from "@prismshadow/penguin-ui";
import { S } from "../lib/strings";
import { useShortcutTitle } from "../lib/shortcuts/use-keymap";
import { useHistoryReach, useWindowMaximized, windowBridge } from "../lib/window-bridge";
import type { WindowBridge } from "../lib/window-bridge";

export function WindowChrome() {
  const bridge = windowBridge();
  useLayoutEffect(() => {
    if (bridge === null) return;
    const root = document.documentElement;
    root.style.setProperty(
      "--window-band-height",
      `env(titlebar-area-height, ${bridge.bandHeight}px)`,
    );
    root.setAttribute("data-window-controls", "");
    return () => {
      root.style.removeProperty("--window-band-height");
      root.removeAttribute("data-window-controls");
    };
  }, [bridge]);
  if (bridge === null || bridge.platform === "darwin") return null;
  return <WindowButtons bridge={bridge} />;
}

function WindowButtons({ bridge }: { bridge: WindowBridge }) {
  const maximized = useWindowMaximized(bridge);
  return (
    <WindowControls
      maximized={maximized}
      labels={S.window}
      onMinimize={() => bridge.minimize()}
      onToggleMaximize={() => bridge.toggleMaximize()}
      onClose={() => bridge.close()}
    />
  );
}

export function TitleBand({
  sidebarCollapsed,
  onToggleSidebar,
}: {
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}) {
  const navigate = useNavigate();
  const reach = useHistoryReach();
  const toggleLabel = sidebarCollapsed ? S.nav.expandSidebar : S.nav.collapseSidebar;
  const toggleTitle = useShortcutTitle(toggleLabel, "sidebar.toggle");
  return (
    <>
      {/* The sidebar is pinned only from `md` up; below it the phone bar's button opens the
          drawer instead, so the toggle would have nothing to fold. */}
      <WindowBandButton
        label={toggleLabel}
        tooltip={toggleTitle}
        glyph={ICONS.panelLeft}
        onClick={onToggleSidebar}
        className="max-md:hidden"
      />
      <WindowBandButton
        label={S.nav.back}
        glyph={ICONS.arrowLeftCentered}
        disabled={!reach.back}
        onClick={() => void navigate(-1)}
      />
      <WindowBandButton
        label={S.nav.forward}
        glyph={ICONS.arrowRightCentered}
        disabled={!reach.forward}
        onClick={() => void navigate(1)}
      />
    </>
  );
}
