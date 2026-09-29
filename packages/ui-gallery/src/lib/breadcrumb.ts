/**
 * The quotable address of whatever a card shows, in the chrome's own language. A module's card:
 *
 *   Frost › Conversation › Approval · dark
 *   白领 › 对话 › 待审批 · 深色
 *
 * theme › module › the variant, then the resolved mode, then only what differs from the defaults:
 * the accent preset (an id, the same in both languages), the root size when it is not 18 px, and
 * the phone frame. The language needs no qualifier — the words carry it, and the chrome and the
 * previews always share one language — so one quote still means one view. A part inside a
 * module's Parts drawer keeps the form quoted before modules existed, with the part between the
 * module and its pick (axis values are ids and stay as they are):
 *
 *   Console › Actions › Button › danger · sm · dark
 *
 * A scene paused before its end names the frame, the variant joining the path:
 *
 *   Frost › Navigation › Sidebar › Rail · dark
 *
 * Settled (at the last frame, which is the variant itself) it names no frame. The caller passes
 * every name already localized; this file only spells the address.
 */
import type { FontScale } from "@prismshadow/penguin-ui/boot";
import { TIER_PX } from "./themes";

export interface BreadcrumbParts {
  /** The theme's display name. */
  theme: string;
  /** The module's title. */
  module: string;
  /** A part's title, when the address is a part demo inside the module. */
  part?: string;
  /** A module's variant title, or a part's axis values (`["all"]` for its matrix); empty for none. */
  variant?: readonly string[];
  /** The frame a paused scene stands on, when it is not the settled last one. */
  frame?: string;
  /** The resolved mode's word: `dark` / `深色`. */
  mode: string;
  /** An accent preset id, when one is applied; omitted for the theme's own accent. */
  accent?: string;
  tier: FontScale;
  /** The phone frame's word, when the composition sits in one. */
  view?: string;
}

export function formatBreadcrumb(parts: BreadcrumbParts): string {
  const names = [parts.theme, parts.module];
  if (parts.part !== undefined) names.push(parts.part);
  const variant = parts.variant ?? [];
  const frame = variant.length > 0 ? parts.frame : undefined;
  if (frame !== undefined) names.push(variant.join(" · "));
  const path = names.join(" › ");
  const qualifiers = [...(frame !== undefined ? [frame] : variant), parts.mode];
  if (parts.accent !== undefined) qualifiers.push(parts.accent);
  if (parts.tier !== "md") qualifiers.push(`${TIER_PX[parts.tier]}px`);
  if (parts.view !== undefined) qualifiers.push(parts.view);
  const tail = qualifiers.join(" · ");
  return variant.length > 0 ? `${path} › ${tail}` : `${path} · ${tail}`;
}
