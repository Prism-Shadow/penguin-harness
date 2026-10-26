/**
 * The public sites' light / dark / system preference: applied as the `html.dark` class (the
 * sites' Tailwind `dark:` variant), tracked live against prefers-color-scheme while it is
 * `system`, and stored under the key the landing page, the docs and the gallery share. Each
 * site's index.html applies the stored value before first paint; this takes over once React runs.
 */
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { SiteThemeMode } from "./site-controls";
import { readSitePref, SITE_THEME_KEY, subscribeSitePref, writeSitePref } from "./site-prefs";

export const SITE_THEME_MODES = [
  "light",
  "dark",
  "system",
] as const satisfies readonly SiteThemeMode[];

export interface SiteTheme {
  mode: SiteThemeMode;
  /** The theme in effect: `system` resolved against the OS preference. */
  dark: boolean;
  setMode: (mode: SiteThemeMode) => void;
}

const SiteThemeContext = createContext<SiteTheme | null>(null);

function systemDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function SiteThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<SiteThemeMode>(
    () => readSitePref(SITE_THEME_KEY, SITE_THEME_MODES) ?? "system",
  );
  const [sysDark, setSysDark] = useState(systemDark);
  const dark = mode === "system" ? sysDark : mode === "dark";

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  useEffect(() => {
    if (mode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setSysDark(e.matches);
    setSysDark(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [mode]);

  const setMode = useCallback((next: SiteThemeMode) => {
    writeSitePref(SITE_THEME_KEY, next);
    setModeState(next);
  }, []);

  // A sibling site writing the shared key in another tab.
  useEffect(() => subscribeSitePref(SITE_THEME_KEY, SITE_THEME_MODES, setModeState), []);

  return (
    <SiteThemeContext.Provider value={{ mode, dark, setMode }}>
      {children}
    </SiteThemeContext.Provider>
  );
}

export function useSiteTheme(): SiteTheme {
  const ctx = useContext(SiteThemeContext);
  if (!ctx) throw new Error("useSiteTheme must be used inside SiteThemeProvider");
  return ctx;
}
