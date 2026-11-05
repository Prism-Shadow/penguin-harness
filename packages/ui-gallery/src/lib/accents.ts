/**
 * The accent choices the rail offers: the theme's own accent (随主题, stored as `neutral`, which
 * sets no `data-accent`) and the presets the ACTIVE theme lists. Each theme declares its own list
 * in the package (`ACCENT_PRESETS` in tokens.ts — Primer the five the Web App has always had,
 * Frost a warm set, Console terminal hues), and this file is the one place the gallery reads it,
 * so the rail, the URL and the resolution agree on what a preset is.
 *
 * A chosen preset outlives the theme that listed it: it stays in the URL and in memory and goes
 * onto the root as it is — a theme's preset rules match only their own theme, so under a theme
 * that does not list it the theme's own accent shows, and the preset comes back when the reader
 * returns to a theme that does. So switching themes to look at something never loses a choice,
 * and a link with `accent=amber` means the same thing whichever theme it opens on.
 */
import {
  ACCENT_PRESET_IDS,
  ACCENT_PRESETS,
  resolveAccent as resolveListed,
  THEME_ACCENT_PRESETS,
} from "@prismshadow/penguin-ui";
import type { ThemeId } from "@prismshadow/penguin-ui";
import type { AccentChoice } from "@prismshadow/penguin-ui/boot";

/** The stored value for "no preset": the theme's own accent, no `data-accent` on the root. */
export const THEME_ACCENT: AccentChoice = "neutral";

/** The preset ids the theme lists, in its own order. */
export function accentPresetsOf(theme: ThemeId): readonly string[] {
  return THEME_ACCENT_PRESETS[theme];
}

/** Every value `accent=` may carry: the theme's own, then every theme's presets, each once. */
export const ACCENT_IDS: readonly AccentChoice[] = [THEME_ACCENT, ...ACCENT_PRESET_IDS];

/** A validated `accent=` value as the package's contract types it. */
export function asAccentChoice(accent: string): AccentChoice {
  return (ACCENT_IDS as readonly string[]).includes(accent)
    ? (accent as AccentChoice)
    : THEME_ACCENT;
}

/** What a choice paints under a theme: the preset when the theme lists it, else the theme's own. */
export function resolveAccent(theme: ThemeId, accent: string): string {
  return resolveListed(theme, accent) ?? THEME_ACCENT;
}

/** The colour a theme's preset sets in light mode, as the package spells it; `""` for none. */
export function accentSwatch(theme: ThemeId, accent: string): string {
  const presets: readonly { id: string; swatch: string }[] = ACCENT_PRESETS[theme];
  return presets.find((preset) => preset.id === accent)?.swatch ?? "";
}
