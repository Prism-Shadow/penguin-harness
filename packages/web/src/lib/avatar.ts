/**
 * Letter-avatar helpers shared by AgentAvatar and ProviderLogo's user-defined
 * groups: a deterministic tile color family hashed from a stable key (FNV-1a →
 * hue) plus the first user-perceived character of a display name.
 *
 * The color keys off an id rather than a name so it survives renames. The tile
 * is a light 14%-alpha tint (the same soft background the old pixel identicon
 * used) with the initial as colored ink rather than white-on-solid: hsl(h 55%
 * 28%) in light / hsl(h 55% 73%) in dark, lightness picked so the worst-case
 * hue keeps ≥ 4.5:1 (WCAG AA) contrast against the tinted tile on every app
 * surface — verified exhaustively over all 360 hues in test/avatar.test.ts.
 * Components apply the two inks via the --tile-fg / --tile-fg-dark custom
 * properties (theme toggled by html.dark).
 */

/** FNV-1a 32-bit string hash (moved here from agent-avatar.tsx). */
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic hue (0-359) for a stable key (agentId / provider id). */
export function avatarHue(key: string): number {
  return hashStr(key) % 360;
}

/** Tile colors for a stable key: translucent tint background + per-theme initial inks. */
export function avatarTile(key: string): { bg: string; fg: string; fgDark: string } {
  const h = avatarHue(key);
  return {
    bg: `hsl(${h} 55% 50% / 0.14)`,
    fg: `hsl(${h} 55% 28%)`,
    fgDark: `hsl(${h} 55% 73%)`,
  };
}

/** Grapheme segmenter (granularity is locale-independent); code-point fallback on very old engines. */
const graphemes =
  typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : undefined;

function firstGrapheme(s: string): string | undefined {
  if (!s) return undefined;
  if (!graphemes) return Array.from(s)[0];
  for (const g of graphemes.segment(s)) return g.segment;
  return undefined;
}

/**
 * First user-perceived character of `text` — a full grapheme cluster, so CJK,
 * ZWJ emoji (👩‍💻) and flags (🇨🇦) stay whole — uppercased when it has a case;
 * empty/whitespace falls back to `fallback`'s initial, then "?".
 */
export function avatarInitial(text: string, fallback?: string): string {
  const ch = firstGrapheme(text.trim()) ?? firstGrapheme((fallback ?? "").trim());
  return ch ? ch.toUpperCase() : "?";
}
