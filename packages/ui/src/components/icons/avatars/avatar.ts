/**
 * Letter-avatar helpers shared by `AgentAvatar`, `UserAvatar` and `ProviderLogo`'s letter tile: a
 * deterministic tile colour family hashed from a stable key (FNV-1a → hue), and the first
 * user-perceived character of a display name.
 *
 * The colour keys off an id rather than a name so it survives renames. The tile is a light
 * 14%-alpha tint with the initial as coloured ink rather than white on a solid fill: hsl(h 55%
 * 27%) in light and hsl(h 55% 77%) in dark, lightness picked so the worst-case hue keeps ≥ 4.5:1
 * (WCAG AA) against the tinted tile on every surface it sits on, in every theme — checked over
 * all 360 hues against the surfaces the theme files declare, in test/avatar.test.ts. The two inks
 * travel as one `light-dark()` value, which follows the colour scheme the theme sets on the root,
 * so a tile needs no dark-mode class.
 *
 * The tile colours are identity data, not theme colours: the one place outside the token
 * contract a component may spell a colour of its own.
 */

/** FNV-1a 32-bit string hash. */
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic hue (0-359) for a stable key (an agent id, a provider id). */
export function avatarHue(key: string): number {
  return hashStr(key) % 360;
}

/** A letter tile's colours: the translucent tint, and the initial's ink per mode and as one value. */
export interface AvatarTile {
  bg: string;
  /** The ink on a light surface. */
  fg: string;
  /** The ink on a dark surface. */
  fgDark: string;
  /** Both inks as `light-dark(fg, fgDark)`: what a component paints the initial with. */
  ink: string;
}

/** Tile colours for a hue (0-359). */
export function avatarTileOfHue(h: number): AvatarTile {
  const fg = `hsl(${h} 55% 27%)`;
  const fgDark = `hsl(${h} 55% 77%)`;
  return { bg: `hsl(${h} 55% 50% / 0.14)`, fg, fgDark, ink: `light-dark(${fg}, ${fgDark})` };
}

/** Tile colours for a stable key. */
export function avatarTile(key: string): AvatarTile {
  return avatarTileOfHue(avatarHue(key));
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
 * First user-perceived character of `text` — a full grapheme cluster, so CJK, ZWJ emoji and flags
 * stay whole — uppercased when it has a case; empty or whitespace falls back to `fallback`'s
 * initial, then "?".
 */
export function avatarInitial(text: string, fallback?: string): string {
  const ch = firstGrapheme(text.trim()) ?? firstGrapheme((fallback ?? "").trim());
  return ch ? ch.toUpperCase() : "?";
}
