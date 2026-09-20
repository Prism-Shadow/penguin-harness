/**
 * The quotable address of whatever a card shows. A module's card:
 *
 *   Frost › Conversation › Approval · dark · zh
 *
 * theme › module › the variant, then the resolved mode, then the language and root size only when
 * they differ from en and 18 px. A part inside a module's Parts drawer keeps the form quoted before
 * modules existed, with the part between the module and its pick:
 *
 *   Console › Actions › Button › danger · sm · dark
 *
 * The parts are English in both chrome languages: the breadcrumb names ids and code, and one quote
 * must mean one view.
 */
import type { ThemeId } from "@prismshadow/penguin-ui";
import type { FontScale } from "@prismshadow/penguin-ui/boot";
import { THEME_NAMES, TIER_PX } from "./themes";
import type { Lang } from "./url-state";

export interface BreadcrumbParts {
  theme: ThemeId;
  /** The module's English title. */
  module: string;
  /** A part's title, when the address is a part demo inside the module. */
  part?: string;
  /** A module's variant title, or a part's axis values (`["all"]` for its matrix); empty for none. */
  variant?: readonly string[];
  mode: "light" | "dark";
  lang: Lang;
  tier: FontScale;
}

export function formatBreadcrumb(parts: BreadcrumbParts): string {
  const names = [THEME_NAMES[parts.theme], parts.module];
  if (parts.part !== undefined) names.push(parts.part);
  const path = names.join(" › ");
  const qualifiers = [...(parts.variant ?? []), parts.mode];
  if (parts.lang !== "en") qualifiers.push(parts.lang);
  if (parts.tier !== "md") qualifiers.push(`${TIER_PX[parts.tier]}px`);
  const tail = qualifiers.join(" · ");
  return parts.variant && parts.variant.length > 0 ? `${path} › ${tail}` : `${path} · ${tail}`;
}
