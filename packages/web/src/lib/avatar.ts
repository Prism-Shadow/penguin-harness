/**
 * Letter-avatar helpers shared by AgentAvatar and ProviderLogo's user-defined
 * groups: a deterministic solid tile color hashed from a stable key (FNV-1a →
 * hue) plus the first user-perceived character of a display name. The color
 * keys off an id rather than a name so it survives renames; hsl(h 52% 46%) is
 * the same saturation/lightness family the old pixel identicon used, readable
 * under white text in both themes (theme-agnostic inline HSL).
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

/** Solid tile background color for a stable key (white text stays readable on it). */
export function avatarColor(key: string): string {
  return `hsl(${avatarHue(key)} 52% 46%)`;
}

/**
 * First user-perceived character of `text` (code-point based, so CJK/emoji stay
 * whole), uppercased when it has a case; empty/whitespace falls back to
 * `fallback`'s initial, then "?".
 */
export function avatarInitial(text: string, fallback?: string): string {
  const ch = Array.from(text.trim())[0] ?? Array.from((fallback ?? "").trim())[0];
  return ch ? ch.toUpperCase() : "?";
}
