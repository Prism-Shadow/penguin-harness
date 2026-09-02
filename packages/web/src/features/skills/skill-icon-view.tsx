/**
 * Skill, hook package and plugin icons. An icon belongs to a plugin: the library card and the
 * detail Modal show the plugin's own `icon.svg`, and an installed skill or hook package shows
 * the icon of the plugin it came from (written into its directory at install time). Where a
 * subject has no icon — a user-authored or zip-imported skill, an install older than the icon
 * copy, a custom plugin without an icon.svg — the mark falls back to one uniform glyph for its
 * kind: the book for a skill, the hook for a hook package, the puzzle piece for a plugin. The
 * caller names the kind through `fallback`; never a letter or a per-name mark.
 *
 * `SkillIcon` is the bare mark (inline beside a name: the composer's chips and pick list);
 * `SkillTile` is the tinted square the rows and cards lead with. A DTO icon (raw icon.svg) is
 * rendered inline once it passes sanitizeSkillIcon (stroke uses currentColor, following text
 * color).
 */
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { BOOK_ICON } from "../chat/skill-use";
import { sanitizeSkillIcon } from "./skill-icon";

/**
 * Per-name tile colors (soft tinted tile + colored line-art stroke, light/dark pairs).
 * Icons are stroke=currentColor line art, so the text color paints them; a curated palette
 * replaces the old theme-accent tile, which rendered every skill in one monochrome block.
 * Deterministic: name-hash into the palette (user-created skills get a stable color too),
 * with a few semantic overrides for built-ins where a hue plainly fits.
 */
const SKILL_TILE_COLORS = [
  "bg-sky-50 text-sky-600 dark:bg-sky-950/60 dark:text-sky-400",
  "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400",
  "bg-violet-50 text-violet-600 dark:bg-violet-950/60 dark:text-violet-400",
  "bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400",
  "bg-rose-50 text-rose-600 dark:bg-rose-950/60 dark:text-rose-400",
  "bg-cyan-50 text-cyan-600 dark:bg-cyan-950/60 dark:text-cyan-400",
  "bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400",
  "bg-teal-50 text-teal-600 dark:bg-teal-950/60 dark:text-teal-400",
] as const;

/** Semantic hue overrides (palette indices) — e.g. the firecrawl flame is amber, not whatever the hash lands on. */
const SKILL_COLOR_OVERRIDES: Record<string, number> = {
  firecrawl: 3,
  "use-firecrawl": 3,
  "data-analysis": 1,
  "web-design": 2,
  "penguin-sdk": 0,
};

export function skillTileColor(name: string): string {
  const override = SKILL_COLOR_OVERRIDES[name];
  if (override !== undefined) return SKILL_TILE_COLORS[override]!;
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return SKILL_TILE_COLORS[h % SKILL_TILE_COLORS.length]!;
}

/** The bare mark, inline: the sanitized svg at `size`, else the kind's glyph (`fallback`; the book unless the subject is not a skill). */
export function SkillIcon({
  icon,
  fallback = BOOK_ICON,
  size = 20,
  className = "",
}: {
  icon?: string;
  /** 24×24 line path drawn when there is no usable `icon`: the uniform mark of the subject's kind. */
  fallback?: string;
  size?: number;
  className?: string;
}) {
  const safe = sanitizeSkillIcon(icon);
  if (!safe) return <GlyphIcon d={fallback} size={size} className={className} />;
  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className={`block shrink-0 [&>svg]:block [&>svg]:h-full [&>svg]:w-full ${className}`}
      dangerouslySetInnerHTML={{ __html: safe }}
    />
  );
}

/**
 * The tinted square a row or card leads with: the icon at `glyph` px inside a `size` px box in
 * the name's palette color, or the kind's glyph (`fallback`) when there is no usable icon.
 * Decorative — the name beside it is the carrier.
 */
export function SkillTile({
  icon,
  name,
  fallback = BOOK_ICON,
  size = 36,
  glyph = 20,
}: {
  icon?: string;
  /** Names the tile's color. */
  name: string;
  /** 24×24 line path drawn without an icon: the book for a skill, the hook for a hook package, the puzzle piece for a plugin. */
  fallback?: string;
  /** Box edge in px. */
  size?: number;
  /** Icon edge in px. */
  glyph?: number;
}) {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className={`flex shrink-0 items-center justify-center rounded-lg ${skillTileColor(name)}`}
    >
      <SkillIcon icon={icon} fallback={fallback} size={glyph} />
    </span>
  );
}
