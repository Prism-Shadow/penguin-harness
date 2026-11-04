/**
 * Pre-render check for custom Skill icons (DTO `icon` field = raw icon.svg from the Skill
 * directory), used inline (shared by the Skills page and unit tests): the icon is inlined
 * into the page (inheriting currentColor), so any executable content must be rejected —
 * `<script`, event attributes (on*=), `<foreignObject>`, or any `href` attribute (icons
 * don't need links; this covers xlink:href and `<a href=…>`) all cause a fallback to the
 * default book icon; content whose root isn't `<svg>` also falls back.
 * Checks match the raw text case-insensitively (no DOM parsing: prefer false positives
 * over letting something through).
 */

/** Event attribute (onclick / onload / …): attribute name preceded by whitespace/quote, followed by `=`. */
const EVENT_ATTR = /[\s"'/]on[a-z]+\s*=/i;

/**
 * Any `href` attribute (regardless of xlink: prefix, case-insensitive, with or without quotes):
 * icons don't need links, so `href` can only carry risky content like javascript:/external links.
 */
const HREF_ATTR = /href\s*=/i;

/**
 * Returns the inlinable SVG source (trimmed) if validation passes, otherwise null
 * (caller falls back to the default book icon).
 */
export function sanitizeSkillIcon(svg: string | undefined): string | null {
  if (!svg) return null;
  const trimmed = svg.trim();
  if (!/^<svg[\s>]/i.test(trimmed)) return null;
  const lower = trimmed.toLowerCase();
  if (lower.includes("<script")) return null;
  if (lower.includes("foreignobject")) return null;
  if (HREF_ATTR.test(trimmed)) return null;
  if (EVENT_ATTR.test(trimmed)) return null;
  return trimmed;
}
