/**
 * Appearance context: light/dark mode (light / dark / system), theme, text size, font pairing
 * and accent.
 * - Mode: html.dark class + Tailwind dark: variant; system mode tracks prefers-color-scheme
 *   live.
 * - Theme: html[data-theme] names the theme pack that renders the app, always written, with
 *   data-theme-base beside it for a pack built on Frost. A built-in pack is in the bundled
 *   stylesheet; a pack an admin imported on this server is a stylesheet of its own, which
 *   lib/theme-pack-links.ts installs before the attributes name it, so a switch never paints half
 *   a theme. A browser that stores no choice, or one this build cannot show, starts in Frost
 *   (`INITIAL_THEME_ID`). Offered in Settings → Appearance, with the imported packs after the
 *   built-in ones (lib/account-sync/theme-packs.ts keeps the list).
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
 * - Theme colour: the meta tag follows the canvas the mode and theme paint (lib/theme-color.ts).
 * All preferences follow the account: each is cached in localStorage for the first frame and
 * written through lib/account-sync, which carries an edit to the account and, when the account's
 * copy arrives, has this provider read the cache again. Reading them back, with validation and
 * the legacy text-size migration, lives in theme-prefs.ts.
 * The pre-paint script in index.html (the package's BOOT_SCRIPT) applies mode, theme, accent,
 * text size and font pairing before the first frame; the effects here keep them in sync
 * afterwards, through the same applyThemeAttributes the package defines.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { ThemePackDto } from "@prismshadow/penguin-server/api";
import type { ThemeId } from "@prismshadow/penguin-ui";
import { applyThemeAttributes, THEME_STORAGE_KEYS } from "@prismshadow/penguin-ui/boot";
import type { AccentChoice } from "@prismshadow/penguin-ui/boot";
import {
  CURRENCY_KEY,
  TERMINAL_THEME_KEY,
  TOOL_ALIASES_KEY,
  readAccent,
  readThemeId,
  readThemePrefs,
} from "./theme-prefs";
import { shownTheme, type ThemeEntry } from "./theme-entries";
import { subscribeAccountApplied, writeCached } from "../lib/account-sync/cache";
import { useThemePackList } from "../lib/account-sync/theme-packs";
import { syncThemeColor } from "../lib/theme-color";
import { createThemeSwitcher, type ThemeTarget } from "../lib/theme-pack-links";
import type { FontCjk, FontLatin, TextSize } from "./theme-prefs";

export type { FontCjk, FontLatin, TextSize, ThemeEntry, ThemeId, ThemeTarget };
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

interface ThemeContextValue {
  mode: ThemeMode;
  /** Resolved effective theme (system mode already resolved against the system preference). */
  dark: boolean;
  setMode: (mode: ThemeMode) => void;
  /**
   * The chosen theme as it reads: a built-in pack's id, or an imported pack's that this browser
   * has the list entry of (theme-prefs.ts). What the picker marks.
   */
  themeId: string;
  setThemeId: (themeId: string) => void;
  /** The chosen theme's entry: its names, swatches and accent presets. */
  theme: ThemeEntry;
  /**
   * What <html> shows now. It trails `themeId` while an imported pack's stylesheet loads, and
   * stays on the theme shown before when that stylesheet fails. A new value each time the root
   * changes, so a copy of the appearance (a Workbench's frame) knows to copy again.
   */
  appliedTheme: ThemeTarget;
  /** The chosen pack, when its stylesheet failed to load; null otherwise. */
  themePackFailed: string | null;
  /** Asks for the chosen pack's stylesheet again. */
  retryThemePack: () => void;
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
  const stored = localStorage.getItem(TERMINAL_THEME_KEY);
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

/** Nothing imported: the list before this browser has read it. One identity, so effects keep still. */
const NO_PACKS: readonly ThemePackDto[] = [];

const targetOf = (theme: ThemeEntry): ThemeTarget => ({
  id: theme.id,
  base: theme.base,
  href: theme.href,
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(initialMode);
  const [sysDark, setSysDark] = useState(systemDark);
  // One read for the lot, which also migrates the legacy text-size key.
  const [initial] = useState(() => readThemePrefs(localStorage));
  const [themeId, setThemeIdState] = useState<string>(initial.themeId);
  const [textSize, setTextSizeState] = useState<TextSize>(initial.textSize);
  const [fontLatin, setFontLatinState] = useState<FontLatin>(initial.fontLatin);
  const [fontCjk, setFontCjkState] = useState<FontCjk>(initial.fontCjk);
  const [accent, setAccentState] = useState<Accent>(initial.accent);
  const [currency, setCurrencyState] = useState<Currency>(initialCurrency);
  const [terminalMode, setTerminalModeState] = useState<TerminalThemeMode>(initialTerminalMode);
  const [toolAliases, setToolAliasesState] = useState<boolean>(initialToolAliases);

  // The account's preferences replaced the cached ones at sign-in:
  // read every one again. The attribute effects below then repaint from the new state.
  useEffect(
    () =>
      subscribeAccountApplied(() => {
        const next = readThemePrefs(localStorage);
        setModeState(initialMode());
        setThemeIdState(next.themeId);
        setTextSizeState(next.textSize);
        setFontLatinState(next.fontLatin);
        setFontCjkState(next.fontCjk);
        setAccentState(next.accent);
        setCurrencyState(initialCurrency());
        setTerminalModeState(initialTerminalMode());
        setToolAliasesState(initialToolAliases());
      }),
    [],
  );

  // The server's imported packs, as this browser last read them. A list that changed may name
  // the stored pack (it arrived) or no longer name it (it was removed, which shows Frost): the
  // stored theme and accent are read again. Neither is ever rewritten for it.
  const packs = useThemePackList().value ?? NO_PACKS;
  useEffect(() => {
    setThemeIdState(readThemeId(localStorage));
    setAccentState(readAccent(localStorage));
  }, [packs]);
  const theme = useMemo(() => shownTheme(themeId, packs), [themeId, packs]);

  const [appliedTheme, setAppliedTheme] = useState<ThemeTarget>(() => targetOf(theme));
  const [themePackFailed, setThemePackFailed] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [switcher] = useState(() =>
    createThemeSwitcher(document, {
      applied: (target) => {
        setAppliedTheme(target);
        setThemePackFailed(null);
      },
      failed: (id) => setThemePackFailed(id),
    }),
  );

  const dark = mode === "system" ? sysDark : mode === "dark";
  const terminalDark = terminalMode === "app" ? dark : terminalMode === "dark";

  useEffect(() => {
    applyThemeAttributes(document.documentElement, { dark });
  }, [dark]);

  // Every theme is named on the root; an imported pack only once its stylesheet is in.
  const { id: shownId, base: shownBase, href: shownHref } = theme;
  useEffect(() => {
    switcher.show({ id: shownId, base: shownBase, href: shownHref });
  }, [switcher, shownId, shownBase, shownHref, attempt]);

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

  // After the attribute effects above, so the canvas read is the one now painted.
  useEffect(() => {
    syncThemeColor(document);
  }, [dark, appliedTheme]);

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
    writeCached(MODE_KEY, next);
    setModeState(next);
  }, []);

  const setThemeId = useCallback((next: string) => {
    writeCached(THEME_ID_KEY, next);
    setThemeIdState(next);
  }, []);

  const retryThemePack = useCallback(() => setAttempt((n) => n + 1), []);

  const setTextSize = useCallback((next: TextSize) => {
    writeCached(TEXT_SIZE_KEY, next);
    setTextSizeState(next);
  }, []);

  const setFontLatin = useCallback((next: FontLatin) => {
    writeCached(FONT_LATIN_KEY, next);
    setFontLatinState(next);
  }, []);

  const setFontCjk = useCallback((next: FontCjk) => {
    writeCached(FONT_CJK_KEY, next);
    setFontCjkState(next);
  }, []);

  const setAccent = useCallback((next: Accent) => {
    writeCached(ACCENT_KEY, next);
    setAccentState(next);
  }, []);

  const setCurrency = useCallback((next: Currency) => {
    writeCached(CURRENCY_KEY, next);
    setCurrencyState(next);
  }, []);

  const setTerminalMode = useCallback((next: TerminalThemeMode) => {
    writeCached(TERMINAL_THEME_KEY, next);
    setTerminalModeState(next);
  }, []);

  const setToolAliases = useCallback((next: boolean) => {
    writeCached(TOOL_ALIASES_KEY, next ? "1" : "0");
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
        theme,
        appliedTheme,
        themePackFailed: themePackFailed === theme.id ? themePackFailed : null,
        retryThemePack,
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
 * The accent swatches a theme offers: "neutral" first (the theme's own accent, the absence of a
 * choice), then the theme's own presets in its own order, painted in their light values.
 */
export function accentSwatches(
  theme: ThemeEntry,
  dark = false,
): ReadonlyArray<{ value: Accent; color: string }> {
  // "Theme's own" paints the accent that choice resolves to — every built-in theme's is black
  // (white in dark) — rather than a stand-in grey.
  const own = theme.accent.own;
  return [
    { value: "neutral", color: dark ? own.dark : own.light },
    ...theme.accent.presets.map((preset) => ({ value: preset.id, color: preset.swatch })),
  ];
}
