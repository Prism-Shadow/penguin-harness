/**
 * Each theme's default faces, for the fonts page's table: the package states them
 * (`THEME_FONTS`, kept in step with the theme sheets by the package's own test) as display names,
 * the same names the pairing options carry; a role the theme leaves to the platform is
 * `SYSTEM_FONT`, which the page prints in its own words.
 */
import { THEME_IDS } from "@prismshadow/penguin-ui";
import type { ThemeId } from "@prismshadow/penguin-ui";
import { SYSTEM_FONT, THEME_FONTS } from "@prismshadow/penguin-ui/boot";

export interface ThemeFontRow {
  theme: ThemeId;
  /** The reading and interface sans. */
  latin: string;
  cjk: string;
  mono: string;
}

/** One row per theme, in the package's order. */
export function themeFontRows(): ThemeFontRow[] {
  return THEME_IDS.map((theme) => {
    const fonts = THEME_FONTS[theme];
    return { theme, latin: fonts.latin, cjk: fonts.cjk, mono: fonts.mono };
  });
}

/** Whether a role's default is the platform's face rather than a bundled one. */
export function isSystemFont(name: string): boolean {
  return name === SYSTEM_FONT;
}
