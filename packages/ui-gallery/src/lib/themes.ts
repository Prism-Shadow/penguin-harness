/**
 * The preferences' display forms: the five text sizes as the top bar prints them (the size id
 * with its pixel value — the size is real: `<html style="font-size">` takes it, and every rem in
 * the framed app follows), and the font pairings the app offers, with the proper names of the
 * bundled faces (the same in both languages) and the two words — the theme's own, the platform's
 * — that the dictionaries carry. The ids are the package's own, stored and quoted as they are.
 *
 * Theme display names are chrome copy and live in the dictionaries (`S.rail.themeNames`): 通用 /
 * 白领 / 极客 in Chinese, Primer / Frost / Console in English. Ids (`github` / `modern` / `geek`)
 * stay in URLs and file names.
 */
import {
  FONT_CJK_OPTIONS,
  FONT_LATIN_OPTIONS,
  TEXT_SIZE_PX,
  TEXT_SIZES,
} from "@prismshadow/penguin-ui/boot";
import type { FontCjk, FontLatin, TextSize } from "@prismshadow/penguin-ui/boot";

export { TEXT_SIZES };
export type { FontCjk, FontLatin, TextSize };

/** Root font size per text size, in CSS px, from the package's own table. */
export const TEXT_SIZE_PX_NUMBER: Readonly<Record<TextSize, number>> = Object.fromEntries(
  TEXT_SIZES.map((size) => [size, Number.parseFloat(TEXT_SIZE_PX[size])]),
) as Record<TextSize, number>;

/**
 * The retired three-step scale, still found in links quoted before the five sizes: mapped by
 * its pixels, the way the app migrates a stored value.
 */
export const LEGACY_SIZES: Readonly<Record<string, TextSize>> = { sm: "m", md: "l", lg: "xl" };

/** The Latin (reading and UI sans) choices, in the order the app lists them. */
export const LATIN_FONTS: readonly FontLatin[] = FONT_LATIN_OPTIONS.map((option) => option.id);

/** The CJK choices, likewise. */
export const CJK_FONTS: readonly FontCjk[] = FONT_CJK_OPTIONS.map((option) => option.id);

/**
 * A pairing's display name: the package's proper name for a bundled face; for `theme` and
 * `system`, the caller's own words (the dictionaries carry them in both languages).
 */
export function fontLabel(
  id: FontLatin | FontCjk,
  words: { theme: string; system: string },
): string {
  if (id === "theme") return words.theme;
  if (id === "system") return words.system;
  const option = [...FONT_LATIN_OPTIONS, ...FONT_CJK_OPTIONS].find((o) => o.id === id);
  return option?.label ?? id;
}
