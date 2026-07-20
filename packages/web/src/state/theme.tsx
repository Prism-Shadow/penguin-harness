/**
 * Appearance context: light/dark theme (mode = light / dark / system) + font
 * size + theme color (accent).
 * - Theme: html.dark class + Tailwind dark: variant; system mode tracks prefers-color-scheme
 *   live. Dark mode defaults to pure black (styles.css overrides the neutral gray scale).
 * - Font size: scales the root font-size (rem-based text-* utilities scale along with it).
 * - Theme color: html[data-accent] overrides --accent-bg/--accent-fg; defaults to neutral
 *   (gray/white, follows light/dark).
 * All preferences persist to localStorage.
 */
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

export type ThemeMode = "light" | "dark" | "system";
export type FontScale = "sm" | "md" | "lg";
export type Accent = "neutral" | "blue" | "green" | "violet" | "rose" | "amber";
/** Display currency (prices are always stored as USD/million Tokens; conversion happens only for display and input). */
export type Currency = "USD" | "CNY";
/** 1 USD ≈ 7 CNY (fixed conversion rate). */
export const USD_TO_CNY = 7;

const MODE_KEY = "penguin.theme";
const FONT_KEY = "penguin.fontScale";
const ACCENT_KEY = "penguin.accent";
const CURRENCY_KEY = "penguin.currency";

/** Font size tier → root font-size (px): overall slightly larger than the system default for readability. */
const FONT_PX: Record<FontScale, string> = { sm: "16px", md: "18px", lg: "20px" };

interface ThemeContextValue {
  mode: ThemeMode;
  /** Resolved effective theme (system mode already resolved against the system preference). */
  dark: boolean;
  setMode: (mode: ThemeMode) => void;
  fontScale: FontScale;
  setFontScale: (scale: FontScale) => void;
  accent: Accent;
  setAccent: (accent: Accent) => void;
  /** Display currency for prices (shared by Cost Center and Model Library; always stored as USD). */
  currency: Currency;
  setCurrency: (currency: Currency) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function initialMode(): ThemeMode {
  const stored = localStorage.getItem(MODE_KEY);
  if (stored === "light" || stored === "dark" || stored === "system") return stored;
  return "system";
}

function initialFontScale(): FontScale {
  const stored = localStorage.getItem(FONT_KEY);
  if (stored === "sm" || stored === "md" || stored === "lg") return stored;
  return "md";
}

function initialAccent(): Accent {
  const stored = localStorage.getItem(ACCENT_KEY);
  if (
    stored === "neutral" ||
    stored === "blue" ||
    stored === "green" ||
    stored === "violet" ||
    stored === "rose" ||
    stored === "amber"
  ) {
    return stored;
  }
  return "neutral";
}

function initialCurrency(): Currency {
  return localStorage.getItem(CURRENCY_KEY) === "CNY" ? "CNY" : "USD";
}

function systemDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(initialMode);
  const [sysDark, setSysDark] = useState(systemDark);
  const [fontScale, setFontScaleState] = useState<FontScale>(initialFontScale);
  const [accent, setAccentState] = useState<Accent>(initialAccent);
  const [currency, setCurrencyState] = useState<Currency>(initialCurrency);

  const dark = mode === "system" ? sysDark : mode === "dark";

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  useEffect(() => {
    document.documentElement.style.fontSize = FONT_PX[fontScale];
  }, [fontScale]);

  useEffect(() => {
    // neutral relies on the CSS default (follows light/dark) and sets no data-accent.
    if (accent === "neutral") delete document.documentElement.dataset.accent;
    else document.documentElement.dataset.accent = accent;
  }, [accent]);

  // system mode: track system preference changes.
  useEffect(() => {
    if (mode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setSysDark(e.matches);
    setSysDark(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [mode]);

  const setMode = useCallback((next: ThemeMode) => {
    localStorage.setItem(MODE_KEY, next);
    setModeState(next);
  }, []);

  const setFontScale = useCallback((next: FontScale) => {
    localStorage.setItem(FONT_KEY, next);
    setFontScaleState(next);
  }, []);

  const setAccent = useCallback((next: Accent) => {
    localStorage.setItem(ACCENT_KEY, next);
    setAccentState(next);
  }, []);

  const setCurrency = useCallback((next: Currency) => {
    localStorage.setItem(CURRENCY_KEY, next);
    setCurrencyState(next);
  }, []);

  return (
    <ThemeContext.Provider
      value={{
        mode,
        dark,
        setMode,
        fontScale,
        setFontScale,
        accent,
        setAccent,
        currency,
        setCurrency,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}

/** Display swatches for theme color presets (neutral uses a neutral gray). */
export const ACCENT_SWATCHES: ReadonlyArray<{ value: Accent; color: string }> = [
  { value: "neutral", color: "#6b7280" },
  { value: "blue", color: "#2563eb" },
  { value: "green", color: "#15803d" },
  { value: "violet", color: "#7c3aed" },
  { value: "rose", color: "#be123c" },
  { value: "amber", color: "#b45309" },
];
