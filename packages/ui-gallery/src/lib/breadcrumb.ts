/**
 * The quotable address of whatever a frame or a board shows, in the chrome's own language:
 *
 *   Frost › Chat · dark
 *   白领 › 对话 · 深色
 *   Console › Foundations › Colour · dark · amber · 20px · phone
 *
 * theme › page, then the section when the address is one section of the page, then the resolved
 * mode, then only what differs from the defaults: the accent preset (an id, the same in both
 * languages), the root size when it is not the default, and the phone frame. The language needs
 * no qualifier — the words carry it, and the chrome and the frames always share one language —
 * so one quote still means one view. The caller passes every name already localized; this file
 * only spells the address.
 */
import { DEFAULT_TEXT_SIZE } from "@prismshadow/penguin-ui/boot";
import type { TextSize } from "@prismshadow/penguin-ui/boot";
import { TEXT_SIZE_PX_NUMBER } from "./themes";

export interface BreadcrumbParts {
  /** The theme's display name. */
  theme: string;
  /** The page's title: a surface, or a module. */
  page: string;
  /** A section of the page, when the address is one section: a board of Foundations. */
  section?: string;
  /** The resolved mode's word: `dark` / `深色`. */
  mode: string;
  /** An accent preset id, when one is applied; omitted for the theme's own accent. */
  accent?: string;
  size: TextSize;
  /** The phone frame's word, when the app sits in one. */
  view?: string;
}

export function formatBreadcrumb(parts: BreadcrumbParts): string {
  const names = [parts.theme, parts.page];
  if (parts.section !== undefined) names.push(parts.section);
  const qualifiers = [parts.mode];
  if (parts.accent !== undefined) qualifiers.push(parts.accent);
  if (parts.size !== DEFAULT_TEXT_SIZE) qualifiers.push(`${TEXT_SIZE_PX_NUMBER[parts.size]}px`);
  if (parts.view !== undefined) qualifiers.push(parts.view);
  return `${names.join(" › ")} · ${qualifiers.join(" · ")}`;
}
