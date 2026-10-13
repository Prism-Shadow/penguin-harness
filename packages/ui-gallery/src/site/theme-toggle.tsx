/**
 * Theme cycle button: light -> dark -> system, icon reflects the current mode. The landing page's
 * (packages/landing/src/components/theme-toggle.tsx), reading the gallery's mode (./prefs.ts).
 */
import { useGallery } from "../state";
import { useTheme } from "./prefs";
import type { ThemeMode } from "./prefs";
import { MonitorIcon, MoonIcon, SunIcon } from "./icons";

const NEXT: Record<ThemeMode, ThemeMode> = { light: "dark", dark: "system", system: "light" };

export function ThemeToggle() {
  const S = useGallery().S.sitebar;
  const { mode, setMode } = useTheme();
  const label = mode === "light" ? S.theme.light : mode === "dark" ? S.theme.dark : S.theme.system;
  const IconCmp = mode === "light" ? SunIcon : mode === "dark" ? MoonIcon : MonitorIcon;
  return (
    <button
      type="button"
      onClick={() => setMode(NEXT[mode])}
      title={`${S.theme.label}: ${label}`}
      aria-label={`${S.theme.label}: ${label}`}
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-transparent text-gray-600 transition-colors hover:border-gray-200 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-400 dark:hover:border-gray-800 dark:hover:bg-gray-900 dark:hover:text-gray-100"
    >
      <IconCmp className="h-[18px] w-[18px]" />
    </button>
  );
}
