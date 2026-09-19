/**
 * Appearance context: light/dark mode (light / dark / system) + theme + font size + theme
 * color (accent).
 * - Mode: html.dark class + Tailwind dark: variant; system mode tracks prefers-color-scheme
 *   live. Dark mode defaults to pure black (the default theme's gray bridge).
 * - Theme: html[data-theme] selects one of the shared UI package's themes (absent = the
 *   default). No UI offers it yet; it is stored and applied so a theme can be tried by setting
 *   `penguin.themeId`.
 * - Font size: scales the root font-size (rem-based text-* utilities scale along with it).
 * - Theme color: html[data-accent] overrides the theme's accent tokens; defaults to neutral
 *   (the theme's own accent, which follows light/dark).
 * - Tool short names: whether a tool-call card names the built-in tools by a short alias
 *   instead of the name the model calls them by. Display-only, default on.
 * - Terminal theme: its own light/dark/follow-the-app setting, following the app unless
 *   explicitly pinned — see TerminalThemeMode. It drives no class or variable here; the
 *   terminal reads `terminalDark` and paints itself, because Tailwind's dark: variant is
 *   anchored on html.dark and cannot express a light subtree inside a dark app.
 * All preferences persist to localStorage.
 * The pre-paint script in index.html (the package's BOOT_SCRIPT) applies mode, theme, accent
 * and font size before the first frame; the effects here keep them in sync afterwards, through
 * the same applyThemeAttributes the package defines.
 */
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { DEFAULT_THEME_ID, THEME_IDS } from "@prismshadow/penguin-ui";
import type { ThemeId } from "@prismshadow/penguin-ui";
import { applyThemeAttributes, THEME_STORAGE_KEYS } from "@prismshadow/penguin-ui/boot";
import type { AccentChoice, FontScale as UiFontScale } from "@prismshadow/penguin-ui/boot";

export type { ThemeId };
export type ThemeMode = "light" | "dark" | "system";
export type FontScale = UiFontScale;
export type Accent = AccentChoice;
/**
 * The terminal's appearance. By default it follows the app ("app"): switching the app
 * between light and dark carries the terminal along. Pinning "light" or "dark" decouples
 * the two — for people whose prompts, colour schemes and TUIs are tuned for one screen
 * regardless of the app around it. An absent stored value reads as "app", so only an
 * explicit pin ever overrides the coupling.
 */
export type TerminalThemeMode = "light" | "dark" | "app";
/** Display currency (prices are always stored as USD/million Tokens; conversion happens only for display and input). */
export type Currency = "USD" | "CNY";
/** 1 USD ≈ 7 CNY (fixed conversion rate). */
export const USD_TO_CNY = 7;

const MODE_KEY = THEME_STORAGE_KEYS.mode;
const THEME_ID_KEY = THEME_STORAGE_KEYS.themeId;
const FONT_KEY = THEME_STORAGE_KEYS.fontScale;
const ACCENT_KEY = THEME_STORAGE_KEYS.accent;
const CURRENCY_KEY = "penguin.currency";
const TERMINAL_KEY = "penguin.terminal.theme";
const TOOL_ALIASES_KEY = "penguin.toolAliases";

interface ThemeContextValue {
  mode: ThemeMode;
  /** Resolved effective theme (system mode already resolved against the system preference). */
  dark: boolean;
  setMode: (mode: ThemeMode) => void;
  /** Which theme renders the app. Stored and applied, not yet offered in Settings. */
  themeId: ThemeId;
  setThemeId: (themeId: ThemeId) => void;
  fontScale: FontScale;
  setFontScale: (scale: FontScale) => void;
  accent: Accent;
  setAccent: (accent: Accent) => void;
  /** Display currency for prices (shared by Cost Center and Model Library; always stored as USD). */
  currency: Currency;
  setCurrency: (currency: Currency) => void;
  terminalMode: TerminalThemeMode;
  setTerminalMode: (mode: TerminalThemeMode) => void;
  /** Whether tool-call cards name the built-in tools by their short alias. */
  toolAliases: boolean;
  setToolAliases: (on: boolean) => void;
  /** Resolved terminal appearance ("app" already resolved against the app's own). */
  terminalDark: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function initialMode(): ThemeMode {
  const stored = localStorage.getItem(MODE_KEY);
  if (stored === "light" || stored === "dark" || stored === "system") return stored;
  return "system";
}

function initialThemeId(): ThemeId {
  const stored = localStorage.getItem(THEME_ID_KEY);
  return THEME_IDS.find((id) => id === stored) ?? DEFAULT_THEME_ID;
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

function initialTerminalMode(): TerminalThemeMode {
  const stored = localStorage.getItem(TERMINAL_KEY);
  if (stored === "light" || stored === "dark" || stored === "app") return stored;
  return "app";
}

/** Default on, so anything but the explicit off value reads as on (an absent value included). */
function initialToolAliases(): boolean {
  return localStorage.getItem(TOOL_ALIASES_KEY) !== "0";
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
  const [themeId, setThemeIdState] = useState<ThemeId>(initialThemeId);
  const [fontScale, setFontScaleState] = useState<FontScale>(initialFontScale);
  const [accent, setAccentState] = useState<Accent>(initialAccent);
  const [currency, setCurrencyState] = useState<Currency>(initialCurrency);
  const [terminalMode, setTerminalModeState] = useState<TerminalThemeMode>(initialTerminalMode);
  const [toolAliases, setToolAliasesState] = useState<boolean>(initialToolAliases);

  const dark = mode === "system" ? sysDark : mode === "dark";
  const terminalDark = terminalMode === "app" ? dark : terminalMode === "dark";

  useEffect(() => {
    applyThemeAttributes(document.documentElement, { dark });
  }, [dark]);

  useEffect(() => {
    // The default theme sets no data-theme: its selectors match a bare <html>.
    applyThemeAttributes(document.documentElement, { themeId });
  }, [themeId]);

  useEffect(() => {
    applyThemeAttributes(document.documentElement, { fontScale });
  }, [fontScale]);

  useEffect(() => {
    // neutral leaves the theme's own accent (follows light/dark) and sets no data-accent.
    applyThemeAttributes(document.documentElement, { accent });
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

  const setThemeId = useCallback((next: ThemeId) => {
    localStorage.setItem(THEME_ID_KEY, next);
    setThemeIdState(next);
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

  const setTerminalMode = useCallback((next: TerminalThemeMode) => {
    localStorage.setItem(TERMINAL_KEY, next);
    setTerminalModeState(next);
  }, []);

  const setToolAliases = useCallback((next: boolean) => {
    localStorage.setItem(TOOL_ALIASES_KEY, next ? "1" : "0");
    setToolAliasesState(next);
  }, []);

  return (
    <ThemeContext.Provider
      value={{
        mode,
        dark,
        setMode,
        themeId,
        setThemeId,
        fontScale,
        setFontScale,
        accent,
        setAccent,
        currency,
        setCurrency,
        terminalMode,
        setTerminalMode,
        terminalDark,
        toolAliases,
        setToolAliases,
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
