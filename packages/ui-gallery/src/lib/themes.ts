/**
 * Theme display names. Ids are stable and lowercase; the names are proper nouns and read the same
 * in both locales.
 */
import type { ThemeId } from "@prismshadow/penguin-ui";

export const THEME_NAMES: Readonly<Record<ThemeId, string>> = {
  github: "Primer",
  modern: "Frost",
  geek: "Console",
};

/** Root font size per tier, as the breadcrumb and the Typography page print it. */
export const TIER_PX = { sm: 16, md: 18, lg: 20 } as const;
