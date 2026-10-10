/**
 * The appearance preferences as stored values: reading them back from `localStorage` with the
 * same validation the pre-paint boot script applies, and the attribute set they put on <html>.
 *
 * Pure on purpose — no React, no `window` — so the one place that decides what a stored value
 * means is testable against an in-memory store, and the provider (theme.tsx) only holds state.
 * Every key and every value list comes from the shared UI package, which also owns the boot
 * script: the first frame and the running app then cannot disagree about a stored value.
 */
import {
  ACCENT_PRESET_IDS,
  INITIAL_THEME_ID,
  THEME_IDS,
  resolveAccent,
} from "@prismshadow/penguin-ui";
import type { ThemeId } from "@prismshadow/penguin-ui";
import {
  FONT_CJK_OPTIONS,
  FONT_LATIN_OPTIONS,
  THEME_STORAGE_KEYS,
  readTextSize,
} from "@prismshadow/penguin-ui/boot";
import type {
  AccentChoice,
  FontCjk,
  FontLatin,
  TextSize,
  ThemeAttributes,
} from "@prismshadow/penguin-ui/boot";

export type { FontCjk, FontLatin, TextSize };

/** The storage a reader needs: `readTextSize` also writes, to retire the legacy key. */
export type PrefStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** "Use the theme's own face" — stored like any other choice, applied as no attribute at all. */
export const FONT_FOLLOWS_THEME = "theme";

/** The stored theme, or the one a browser starts in when it stores none (or an unknown one). */
export function readThemeId(storage: PrefStorage): ThemeId {
  const stored = storage.getItem(THEME_STORAGE_KEYS.themeId);
  return THEME_IDS.find((id) => id === stored) ?? INITIAL_THEME_ID;
}

/**
 * Any preset any theme lists is kept as stored: the theme files scope their presets to their own
 * root, so one the active theme does not list paints nothing (the theme's own accent shows) and
 * comes back when that theme is active again.
 */
export function readAccent(storage: PrefStorage): AccentChoice {
  const stored = storage.getItem(THEME_STORAGE_KEYS.accent);
  if (stored === "neutral") return stored;
  return ACCENT_PRESET_IDS.find((id) => id === stored) ?? "neutral";
}

/**
 * The accent a picker should mark under a theme: the stored preset when the theme lists it,
 * otherwise "neutral" — which is what the CSS paints in that case too.
 */
export function effectiveAccent(themeId: ThemeId, accent: AccentChoice): AccentChoice {
  return accent === "neutral" ? accent : (resolveAccent(themeId, accent) ?? "neutral");
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
