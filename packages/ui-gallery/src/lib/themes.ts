/**
 * The root font tiers as the rail, the breadcrumb and the Fonts page print them. The tier ids
 * (`sm` / `md` / `lg`) are the package's `FontScale`, stored and quoted as they are; what a reader
 * sees is the pixel size, because the tier is real — `<html style="font-size">` takes it, and every
 * rem in a composition follows.
 *
 * Theme display names are chrome copy and live in the dictionaries (`S.rail.themeNames`): 通用 /
 * 白领 / 极客 in Chinese, Primer / Frost / Console in English. Ids (`github` / `modern` / `geek`)
 * stay in URLs and file names.
 */
import type { FontScale } from "@prismshadow/penguin-ui/boot";

/** Root font size per tier, in CSS px. Must agree with the package's `FONT_SCALE_PX`. */
export const TIER_PX: Readonly<Record<FontScale, number>> = { sm: 16, md: 18, lg: 20 };
