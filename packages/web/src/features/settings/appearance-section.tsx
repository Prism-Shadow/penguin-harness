/**
 * Appearance page: the look-and-feel preferences that used to sit as rows in the sidebar
 * user menu. Everything applies on the spot (the theme store persists per browser), so
 * there is no Save button. The terminal keeps its own theme row because plenty of people
 * pin a dark terminal inside a light app; it follows the app unless pinned (see
 * TerminalThemeMode).
 */
import { S } from "../../lib/strings";
import { Segmented } from "../../components/ui/segmented";
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
  } = useTheme();

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
    </div>
  );
}
