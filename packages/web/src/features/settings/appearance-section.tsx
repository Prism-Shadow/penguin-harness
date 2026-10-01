/**
 * Appearance page: the look-and-feel preferences. Theme, light or dark, accent, text size and
 * font pairing come first, since each restyles the whole app. Everything applies on the spot
 * (the theme store persists per browser), so there is no Save button. The terminal keeps its
 * own theme row because plenty of people pin a dark terminal inside a light app; it follows
 * the app unless pinned (see TerminalThemeMode). The workbench launcher's row is here rather
 * than with the chat's own settings because it is the same kind of choice: whether a piece of
 * chrome is drawn. The tool short-name row is here for the same reason — it changes how a
 * tool call is spelled on screen, never what runs. So is the tray-icon row, the one piece of
 * chrome here that is not drawn by this page at all: it is the desktop shell's, and only the
 * shell's own window may reach it (see isDesktopShellWindow), so the row is absent in a
 * browser.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  PrefRow,
  Segmented,
  Select,
  SwatchPicker,
  THEME_IDS,
  ToggleRow,
} from "@prismshadow/penguin-ui";
import { FONT_CJK_OPTIONS, FONT_LATIN_OPTIONS, TEXT_SIZES } from "@prismshadow/penguin-ui/boot";
import { S } from "../../lib/strings";
import * as api from "../../api/endpoints";
import { isDesktopShellWindow } from "../../lib/account-menu";
import {
  launcherHiddenVersion,
  readLauncherHidden,
  subscribeLauncherHidden,
  writeLauncherHidden,
} from "../dock/dock-launcher-state";
import { useAuth } from "../../state/auth";
import { accentSwatches, useTheme } from "../../state/theme";
import type {
  FontCjk,
  FontLatin,
  TerminalThemeMode,
  TextSize,
  ThemeId,
  ThemeMode,
} from "../../state/theme";
import { FONT_FOLLOWS_THEME, effectiveAccent } from "../../state/theme-prefs";

/**
 * A font select's choices: the theme's own face first — it is the default, and the named faces
 * are the opt-out — then the faces the package lists. The package names each bundled face by
 * its proper name, the same in both languages; "theme" and "system" are not names, so their
 * words come from this app's dictionaries.
 */
export function fontChoices<T extends string>(
  options: ReadonlyArray<{ id: T; label: string }>,
): Array<{ value: T; label: string }> {
  return [
    { value: FONT_FOLLOWS_THEME as T, label: S.settings.fontFollowTheme },
    ...options
      .filter((option) => option.id !== FONT_FOLLOWS_THEME)
      .map((option) => ({
        value: option.id,
        label: option.id === "system" ? S.settings.fontSystem : option.label,
      })),
  ];
}

/** One of the two font selects, with the short visible name that tells the pair apart. */
function FontSelect<T extends string>({
  name,
  value,
  choices,
  onChange,
}: {
  name: string;
  value: T;
  choices: ReadonlyArray<{ value: T; label: string }>;
  onChange: (next: T) => void;
}) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span
        aria-hidden
        className="shrink-0 whitespace-nowrap text-xs text-gray-500 dark:text-gray-400"
      >
        {name}
      </span>
      <span className="w-36 min-w-0 shrink">
        <Select
          aria-label={`${S.settings.fonts} · ${name}`}
          value={value}
          onChange={(e) => {
            const next = choices.find((choice) => choice.value === e.target.value);
            if (next) onChange(next.value);
          }}
        >
          {choices.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </Select>
      </span>
    </span>
  );
}

export function AppearanceSection() {
  const {
    mode,
    setMode,
    themeId,
    setThemeId,
    textSize,
    setTextSize,
    fontLatin,
    setFontLatin,
    fontCjk,
    setFontCjk,
    accent,
    setAccent,
    terminalMode,
    setTerminalMode,
    toolAliases,
    setToolAliases,
    dark,
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
    void api.setDesktopTray({ showTrayIcon: next }).catch(() => setTrayIcon(!next));
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
  const themeIdOptions: ReadonlyArray<{ value: ThemeId; label: string }> = THEME_IDS.map((id) => ({
    value: id,
    label: S.settings.themeNames[id],
  }));
  const textSizeOptions: ReadonlyArray<{ value: TextSize; label: string }> = TEXT_SIZES.map(
    (size) => ({ value: size, label: S.settings.textSizeNames[size] }),
  );

  return (
    <div className="divide-y divide-gray-100 dark:divide-gray-800/60">
      <PrefRow label={S.settings.theme} info={S.settings.themeInfo}>
        <Segmented options={themeIdOptions} value={themeId} onChange={setThemeId} />
      </PrefRow>
      <PrefRow label={S.settings.colorMode} info={S.settings.colorModeInfo}>
        <Segmented options={themeOptions} value={mode} onChange={setMode} />
      </PrefRow>
      {/* The swatches are the active theme's own; a stored preset it does not list is shown
          as the theme's own accent, which is what the page paints, and comes back with the
          theme that lists it. */}
      <PrefRow label={S.settings.accent} info={S.settings.accentInfo}>
        <SwatchPicker
          options={accentSwatches(themeId, dark).map((swatch) => ({
            ...swatch,
            label: S.settings.accentNames[swatch.value] ?? swatch.value,
          }))}
          value={effectiveAccent(themeId, accent)}
          onChange={setAccent}
        />
      </PrefRow>
      <PrefRow label={S.settings.fontSize} info={S.settings.fontSizeInfo}>
        <Segmented options={textSizeOptions} value={textSize} onChange={setTextSize} cols={5} />
      </PrefRow>
      <PrefRow label={S.settings.fonts} info={S.settings.fontsInfo}>
        {/* One line always: the pair shrinks rather than wraps (a wrapped pair read as two
            settings under the stacked label a theme may give this row). */}
        <div className="flex min-w-0 items-center justify-end gap-x-3">
          <FontSelect<FontLatin>
            name={S.settings.fontLatin}
            value={fontLatin}
            choices={fontChoices(FONT_LATIN_OPTIONS)}
            onChange={setFontLatin}
          />
          <FontSelect<FontCjk>
            name={S.settings.fontCjk}
            value={fontCjk}
            choices={fontChoices(FONT_CJK_OPTIONS)}
            onChange={setFontCjk}
          />
        </div>
      </PrefRow>
      <PrefRow label={S.settings.terminalTheme} info={S.settings.terminalThemeInfo}>
        <Segmented options={terminalThemeOptions} value={terminalMode} onChange={setTerminalMode} />
      </PrefRow>
      <ToggleRow
        label={S.settings.launcher}
        info={S.settings.launcherInfo}
        checked={launcherShown}
        onChange={(shown) => writeLauncherHidden(!shown)}
      />
      <ToggleRow
        label={S.settings.toolAliases}
        info={S.settings.toolAliasesInfo}
        checked={toolAliases}
        onChange={setToolAliases}
      />
      {offersTrayIcon && (
        <ToggleRow
          label={S.settings.trayIcon}
          info={S.settings.trayIconInfo}
          checked={trayIcon}
          onChange={changeTrayIcon}
        />
      )}
    </div>
  );
}
