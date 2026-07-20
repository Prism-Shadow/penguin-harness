/**
 * Skill icon component (shared by Skill library cards and the input area's Skill dropdown):
 * DTO icon (raw icon.svg from the Skill directory) is rendered inline once it passes
 * sanitizeSkillIcon (stroke uses currentColor, following text color); falls back to the
 * default book icon if missing or if validation fails (e.g. user-created Skills).
 */
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { BOOK_ICON } from "../chat/skill-use";
import { sanitizeSkillIcon } from "./skill-icon";

/**
 * Per-skill icon colors (soft tinted tile + colored line-art stroke, light/dark pairs).
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
  if (!safe) return <GlyphIcon d={BOOK_ICON} size={size} className={className} />;
  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className={`block shrink-0 [&>svg]:block [&>svg]:h-full [&>svg]:w-full ${className}`}
      dangerouslySetInnerHTML={{ __html: safe }}
    />
  );
}
