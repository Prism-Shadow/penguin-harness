/**
 * Theme context: light / dark / system (tracks prefers-color-scheme live), toggled
 * via the html.dark class + Tailwind dark: variant, persisted to localStorage.
 * Same behavior as the landing page, under the docs site's own storage key
 * (index.html pre-applies the stored value before first paint).
 */
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { THEME_KEY, readPref, subscribePref, writePref } from "./site-prefs";

export type ThemeMode = "light" | "dark" | "system";

const THEME_MODES = ["light", "dark", "system"] as const;

interface ThemeContextValue {
  mode: ThemeMode;
  /** Resolved effective theme (system mode resolved against the OS preference). */
  dark: boolean;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function initialMode(): ThemeMode {
  return readPref<ThemeMode>(THEME_KEY, THEME_MODES) ?? "system";
}

function systemDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(initialMode);
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

  const setMode = useCallback((next: ThemeMode) => {
    writePref(THEME_KEY, next);
    setModeState(next);
  }, []);

  // The sibling site (landing <-> docs) writing the shared key in another tab.
  useEffect(() => subscribePref<ThemeMode>(THEME_KEY, THEME_MODES, setModeState), []);

  return <ThemeContext.Provider value={{ mode, dark, setMode }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}
