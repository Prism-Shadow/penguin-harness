/**
 * Appearance context: light/dark mode (light / dark / system), theme, text size, font pairing
 * and accent.
 * - Mode: html.dark class + Tailwind dark: variant; system mode tracks prefers-color-scheme
 *   live.
 * - Theme: html[data-theme] selects one of the shared UI package's themes (absent = the
 *   default, Primer). Offered in Settings → Appearance.
 * - Text size: five steps that set the root font-size, so every rem-based type and density
 *   token scales with it.
 * - Font pairing: html[data-font-latin] / [data-font-cjk] override the reading and interface
 *   sans (Latin) and the CJK face; absent = the theme's own. The theme's mono face is untouched.
 * - Accent: html[data-accent] overrides the theme's accent tokens; "neutral" (no attribute) is
 *   the theme's own accent. Each theme lists its own presets, and a stored preset the active
 *   theme does not list paints nothing until a theme that lists it is active again.
 * - Tool short names: whether a tool-call card names the built-in tools by a short alias
 *   instead of the name the model calls them by. Display-only, default on.
 * - Terminal theme: its own light/dark/follow-the-app setting, following the app unless
 *   explicitly pinned — see TerminalThemeMode. It drives no class or variable here; the
 *   terminal reads `terminalDark` and paints itself, because Tailwind's dark: variant is
 *   anchored on html.dark and cannot express a light subtree inside a dark app.
 * All preferences persist to localStorage. Reading them back, with validation and the legacy
 * text-size migration, lives in theme-prefs.ts.
 * The pre-paint script in index.html (the package's BOOT_SCRIPT) applies mode, theme, accent,
 * text size and font pairing before the first frame; the effects here keep them in sync
 * afterwards, through the same applyThemeAttributes the package defines.
 */
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ACCENT_PRESETS } from "@prismshadow/penguin-ui";
import type { ThemeId } from "@prismshadow/penguin-ui";
import { applyThemeAttributes, THEME_STORAGE_KEYS } from "@prismshadow/penguin-ui/boot";
import type { AccentChoice } from "@prismshadow/penguin-ui/boot";
import { readThemePrefs } from "./theme-prefs";
import type { FontCjk, FontLatin, TextSize } from "./theme-prefs";

export type { FontCjk, FontLatin, TextSize, ThemeId };
export type ThemeMode = "light" | "dark" | "system";
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
const TEXT_SIZE_KEY = THEME_STORAGE_KEYS.textSize;
const FONT_LATIN_KEY = THEME_STORAGE_KEYS.fontLatin;
const FONT_CJK_KEY = THEME_STORAGE_KEYS.fontCjk;
const ACCENT_KEY = THEME_STORAGE_KEYS.accent;
const CURRENCY_KEY = "penguin.currency";
const TERMINAL_KEY = "penguin.terminal.theme";
const TOOL_ALIASES_KEY = "penguin.toolAliases";

interface ThemeContextValue {
  mode: ThemeMode;
  /** Resolved effective theme (system mode already resolved against the system preference). */
  dark: boolean;
  setMode: (mode: ThemeMode) => void;
  /** Which theme renders the app. */
  themeId: ThemeId;
  setThemeId: (themeId: ThemeId) => void;
  textSize: TextSize;
  setTextSize: (size: TextSize) => void;
  /** The Latin sans the theme's own is replaced with ("theme" = keep the theme's). */
  fontLatin: FontLatin;
  setFontLatin: (font: FontLatin) => void;
  /** The CJK face the theme's own is replaced with ("theme" = keep the theme's). */
  fontCjk: FontCjk;
  setFontCjk: (font: FontCjk) => void;
  /** The stored choice, which may name a preset the active theme does not list (see effectiveAccent). */
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
  // One read for the lot, which also migrates the legacy text-size key.
  const [initial] = useState(() => readThemePrefs(localStorage));
  const [themeId, setThemeIdState] = useState<ThemeId>(initial.themeId);
  const [textSize, setTextSizeState] = useState<TextSize>(initial.textSize);
  const [fontLatin, setFontLatinState] = useState<FontLatin>(initial.fontLatin);
  const [fontCjk, setFontCjkState] = useState<FontCjk>(initial.fontCjk);
  const [accent, setAccentState] = useState<Accent>(initial.accent);
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
    applyThemeAttributes(document.documentElement, { textSize });
  }, [textSize]);

  useEffect(() => {
    // "theme" removes the attribute: the theme's own face applies.
    applyThemeAttributes(document.documentElement, { fontLatin, fontCjk });
  }, [fontLatin, fontCjk]);

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

  const setTextSize = useCallback((next: TextSize) => {
    localStorage.setItem(TEXT_SIZE_KEY, next);
    setTextSizeState(next);
  }, []);

  const setFontLatin = useCallback((next: FontLatin) => {
    localStorage.setItem(FONT_LATIN_KEY, next);
    setFontLatinState(next);
  }, []);

  const setFontCjk = useCallback((next: FontCjk) => {
    localStorage.setItem(FONT_CJK_KEY, next);
    setFontCjkState(next);
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
        textSize,
        setTextSize,
        fontLatin,
        setFontLatin,
        fontCjk,
        setFontCjk,
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

/**
 * The accent swatches a theme offers: "neutral" first (the theme's own accent, painted as a
 * plain gray because it is the absence of a choice, not a hue), then the theme's own presets in
 * its own order, painted in their light values.
 */
export function accentSwatches(themeId: ThemeId): ReadonlyArray<{ value: Accent; color: string }> {
  return [
    { value: "neutral", color: "#6b7280" },
    ...ACCENT_PRESETS[themeId].map((preset) => ({ value: preset.id, color: preset.swatch })),
  ];
}
