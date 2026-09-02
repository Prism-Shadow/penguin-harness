/**
 * Skill and plugin icons. An icon belongs to a plugin: the library card and the detail Modal
 * show the plugin's own `icon.svg`, and an installed skill or hook package shows the icon of
 * the plugin it came from (written into its directory at install time). Nothing has an icon of
 * its own kind — there is no book for skills and no hook glyph for hook packages — so where a
 * subject has no icon (a user-authored or zip-imported skill, an install older than the icon
 * copy), the tile shows the name's initial instead, the way an Agent avatar does.
 *
 * `SkillIcon` is the bare mark (inline beside a name: the composer's chips and pick list) and
 * renders nothing without a usable icon; `SkillTile` is the tinted square the rows and cards
 * lead with, and always draws something. A DTO icon (raw icon.svg) is rendered inline once it
 * passes sanitizeSkillIcon (stroke uses currentColor, following text color).
 */
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

/** The bare icon, inline: the sanitized svg at `size`, or nothing when there is no usable icon. */
export function SkillIcon({
  icon,
  size = 20,
  className = "",
}: {
  icon?: string;
  size?: number;
  className?: string;
}) {
  const safe = sanitizeSkillIcon(icon);
  if (!safe) return null;
  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className={`block shrink-0 [&>svg]:block [&>svg]:h-full [&>svg]:w-full ${className}`}
      dangerouslySetInnerHTML={{ __html: safe }}
    />
  );
}

/** The first letter of a name, uppercased — what a tile shows when its subject has no icon. */
export function skillInitial(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}

/**
 * The tinted square a row or card leads with: the icon at `glyph` px inside a `size` px box in
 * the name's palette color, or the name's initial when there is no usable icon. Decorative —
 * the name beside it is the carrier.
 */
export function SkillTile({
  icon,
  name,
  size = 36,
  glyph = 20,
  className = "",
}: {
  icon?: string;
  /** Names the tile's color, and supplies the initial drawn without an icon. */
  name: string;
  /** Box edge in px. */
  size?: number;
  /** Icon edge in px (unused when the initial is drawn). */
  glyph?: number;
  className?: string;
}) {
  const safe = sanitizeSkillIcon(icon);
  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className={`flex shrink-0 items-center justify-center rounded-lg ${skillTileColor(name)} ${className}`}
    >
      {safe ? (
        <SkillIcon icon={icon} size={glyph} />
      ) : (
        <span className="font-semibold leading-none" style={{ fontSize: Math.round(size * 0.44) }}>
          {skillInitial(name)}
        </span>
      )}
    </span>
  );
}
