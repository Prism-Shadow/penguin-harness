/** Theme cycle button: light -> dark -> system, icon reflects the current mode. */
import { useTheme } from "../state/theme";
import type { ThemeMode } from "../state/theme";
import { S } from "../lib/strings";
import { MonitorIcon, MoonIcon, SunIcon } from "./icons";

const NEXT: Record<ThemeMode, ThemeMode> = { light: "dark", dark: "system", system: "light" };

export function ThemeToggle() {
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
