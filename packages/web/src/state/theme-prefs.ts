/**
 * The appearance preferences as stored values: reading them back from `localStorage` with the
 * same validation the pre-paint boot script applies, and the attribute set they put on <html>.
 *
 * Pure on purpose — no React, no `window` — so the one place that decides what a stored value
 * means is testable against an in-memory store, and the provider (theme.tsx) only holds state.
 * Every key and every value list comes from the shared UI package, which also owns the boot
 * script: the first frame and the running app then cannot disagree about a stored value.
 */
import { ACCENT_PRESET_IDS, INITIAL_THEME_ID, isThemeId } from "@prismshadow/penguin-ui";

import {
  FONT_CJK_OPTIONS,
  FONT_LATIN_OPTIONS,
  THEME_STORAGE_KEYS,
  readCachedThemePack,
  readTextSize,
  type AccentChoice,
  type FontCjk,
  type FontLatin,
  type TextSize,
  type ThemeAttributes,
} from "@prismshadow/penguin-ui/boot";
import type { ThemeEntry } from "./theme-entries";

export type { FontCjk, FontLatin, TextSize };

/** The storage a reader needs: `readTextSize` also writes, to retire the legacy key. */
export type PrefStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** The display currency's cached key (the account's copy is the truth, lib/account-sync). */
export const CURRENCY_KEY = "penguin.currency";
/** The terminal appearance's cached key. */
export const TERMINAL_THEME_KEY = "penguin.terminal.theme";
/** The tool short-names switch's cached key. */
export const TOOL_ALIASES_KEY = "penguin.toolAliases";

/** "Use the theme's own face" — stored like any other choice, applied as no attribute at all. */
export const FONT_FOLLOWS_THEME = "theme";

/**
 * The stored theme, or the one a browser starts in when it stores none (or an unknown one): a
 * built-in pack's id, or an imported pack's when this browser's copy of the server's list holds it
 * in a form this build can load (`readCachedThemePack`, which the pre-paint script mirrors). Any
 * other id — a pack since removed, one an account brought from another server, one written for a
 * newer build — reads as the initial theme and stays stored as it is: the reader never writes, so
 * the choice comes back when the pack does.
 */
export function readThemeId(storage: PrefStorage): string {
  const stored = storage.getItem(THEME_STORAGE_KEYS.themeId);
  if (isThemeId(stored)) return stored;
  return readCachedThemePack(storage, stored)?.id ?? INITIAL_THEME_ID;
}

/**
 * Any preset a built-in theme lists is kept as stored: the theme files scope their presets to their
 * own root, so one the active theme does not list paints nothing (the theme's own accent shows) and
 * comes back when that theme is active again. A preset of an imported pack is kept while the stored
 * theme is that pack and this browser has it cached, as the pre-paint script accepts it.
 */
export function readAccent(storage: PrefStorage): AccentChoice {
  const stored = storage.getItem(THEME_STORAGE_KEYS.accent);
  if (stored === "neutral") return stored;
  if (ACCENT_PRESET_IDS.includes(stored ?? "")) return stored!;
  const pack = readCachedThemePack(storage, storage.getItem(THEME_STORAGE_KEYS.themeId));
  return pack !== null && pack.presets.includes(stored ?? "") ? stored! : "neutral";
}

/**
 * The accent a picker should mark under a theme: the stored preset when the theme lists it,
 * otherwise "neutral" — which is what the CSS paints in that case too.
 */
export function effectiveAccent(theme: ThemeEntry, accent: AccentChoice): AccentChoice {
  return theme.accent.presets.some((preset) => preset.id === accent) ? accent : "neutral";
}

export function readFontLatin(storage: PrefStorage): FontLatin {
  const stored = storage.getItem(THEME_STORAGE_KEYS.fontLatin);
  return (
    FONT_LATIN_OPTIONS.find((option) => option.id === stored)?.id ??
    (FONT_FOLLOWS_THEME as FontLatin)
  );
}

export function readFontCjk(storage: PrefStorage): FontCjk {
  const stored = storage.getItem(THEME_STORAGE_KEYS.fontCjk);
  return (
    FONT_CJK_OPTIONS.find((option) => option.id === stored)?.id ?? (FONT_FOLLOWS_THEME as FontCjk)
  );
}

/**
 * The stored preferences, which are exactly what they put on <html> — `applyThemeAttributes`
 * takes this object as it is. The mode is the one attribute not here: it is resolved against
 * the media query first.
 */
export type ThemePrefs = Omit<ThemeAttributes, "dark">;

export function readThemePrefs(storage: PrefStorage): ThemePrefs {
  return {
    themeId: readThemeId(storage),
    accent: readAccent(storage),
    // Migrates the three-step `penguin.fontScale` of earlier releases on the way: the package's
    // reader maps it by pixels (sm → m, md → l, lg → xl), writes the new key and drops the old
    // one, so this happens once per browser and every later read is a plain lookup.
    textSize: readTextSize(storage),
    fontLatin: readFontLatin(storage),
    fontCjk: readFontCjk(storage),
  };
}
