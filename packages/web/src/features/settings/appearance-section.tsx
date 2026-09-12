/**
 * Appearance page: the look-and-feel preferences that used to sit as rows in the sidebar
 * user menu. Everything applies on the spot (the theme store persists per browser), so
 * there is no Save button. The terminal keeps its own theme row because plenty of people
 * pin a dark terminal inside a light app; it follows the app unless pinned (see
 * TerminalThemeMode). The workbench launcher's row is here rather than with the chat's own
 * settings because it is the same kind of choice: whether a piece of chrome is drawn. The
 * tool short-name row is here for the same reason — it changes how a tool call is spelled
 * on screen, never what runs. So is the tray-icon row, the one piece of chrome here that
 * is not drawn by this page at all: it is the desktop shell's, and only the shell's own
 * window may reach it (see isDesktopShellWindow), so the row is absent in a browser.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { S } from "../../lib/strings";
import * as api from "../../api/endpoints";
import { Segmented } from "../../components/ui/segmented";
import { Switch } from "../../components/ui/switch";
import { isDesktopShellWindow } from "../../lib/account-menu";
import {
  launcherHiddenVersion,
  readLauncherHidden,
  subscribeLauncherHidden,
  writeLauncherHidden,
} from "../dock/dock-launcher-state";
import { useAuth } from "../../state/auth";
import { useTheme } from "../../state/theme";
import type { FontScale, TerminalThemeMode, ThemeMode } from "../../state/theme";
import { AccentPicker, PrefRow } from "./setting-row";

export function AppearanceSection() {
  const {
    mode,
    setMode,
    fontScale,
    setFontScale,
    accent,
    setAccent,
    terminalMode,
    setTerminalMode,
    toolAliases,
    setToolAliases,
  } = useTheme();
  // The fan's "hide launcher" entry writes the same preference, so this row follows it.
  useSyncExternalStore(subscribeLauncherHidden, launcherHiddenVersion);
  const launcherShown = !readLauncherHidden();
  const { desktopMode, sessionVia } = useAuth();
  const offersTrayIcon = isDesktopShellWindow({ desktopMode, sessionVia });
  // The shell owns this one, so it is fetched rather than read from a store. Anything the
  // shell has not told us — no push yet, a request that failed — reads as on, the shell's
  // own default, so the row never claims the icon is off while it is sitting in the tray.
  const [trayIcon, setTrayIcon] = useState(true);
  useEffect(() => {
    if (!offersTrayIcon) return;
    let live = true;
    void api.getDesktopTray().then(
      (res) => {
        if (live) setTrayIcon(res.status?.showTrayIcon ?? true);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [offersTrayIcon]);
  // Optimistic: the switch answers the click, and a refused write snaps it back rather
  // than leaving the row disagreeing with the icon the user is looking at.
  const changeTrayIcon = (next: boolean): void => {
    setTrayIcon(next);
    void api.setDesktopTray(next).catch(() => setTrayIcon(!next));
  };

  const themeOptions: ReadonlyArray<{ value: ThemeMode; label: string }> = [
    { value: "light", label: S.settings.themeLight },
    { value: "dark", label: S.settings.themeDark },
    { value: "system", label: S.settings.followSystem },
  ];
  // Follow-the-app first: it is the default, and the pinned modes are the opt-out.
  const terminalThemeOptions: ReadonlyArray<{ value: TerminalThemeMode; label: string }> = [
    { value: "app", label: S.settings.followAppTheme },
    { value: "light", label: S.settings.themeLight },
    { value: "dark", label: S.settings.themeDark },
  ];
  const fontOptions: ReadonlyArray<{ value: FontScale; label: string }> = [
    { value: "sm", label: S.settings.fontSmall },
    { value: "md", label: S.settings.fontMedium },
    { value: "lg", label: S.settings.fontLarge },
  ];

  return (
    <div className="divide-y divide-gray-100 dark:divide-gray-800/60">
      <PrefRow label={S.settings.theme} info={S.settings.themeInfo}>
        <Segmented options={themeOptions} value={mode} onChange={setMode} />
      </PrefRow>
      <PrefRow label={S.settings.terminalTheme} info={S.settings.terminalThemeInfo}>
        <Segmented options={terminalThemeOptions} value={terminalMode} onChange={setTerminalMode} />
      </PrefRow>
      <PrefRow label={S.settings.fontSize} info={S.settings.fontSizeInfo}>
        <Segmented options={fontOptions} value={fontScale} onChange={setFontScale} />
      </PrefRow>
      <PrefRow label={S.settings.accent} info={S.settings.accentInfo}>
        <AccentPicker value={accent} onChange={setAccent} />
      </PrefRow>
      <PrefRow label={S.settings.launcher} info={S.settings.launcherInfo}>
        <Switch checked={launcherShown} onChange={(shown) => writeLauncherHidden(!shown)} />
      </PrefRow>
      <PrefRow label={S.settings.toolAliases} info={S.settings.toolAliasesInfo}>
        <Switch checked={toolAliases} onChange={setToolAliases} />
      </PrefRow>
      {offersTrayIcon && (
        <PrefRow label={S.settings.trayIcon} info={S.settings.trayIconInfo}>
          <Switch checked={trayIcon} onChange={changeTrayIcon} />
        </PrefRow>
      )}
    </div>
  );
}
