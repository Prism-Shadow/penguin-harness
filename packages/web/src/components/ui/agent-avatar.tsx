/**
 * Agent avatar: the Agent's initial as colored ink on a light tinted tile
 * (the same letter-tile style ProviderLogo uses for user-defined model groups,
 * and the same soft 14%-alpha background the old pixel identicon used).
 *
 * The color hashes the agentId — not the display name — so it survives
 * renames; the initial comes from the display name when the caller has one,
 * falling back to the id. The ink switches shade with the theme via the
 * --tile-fg / --tile-fg-dark custom properties, keeping ≥ 4.5:1 contrast on
 * the tile for every hue in both themes (see lib/avatar.ts).
 */
import type { CSSProperties } from "react";

import { avatarInitial, avatarTile } from "../../lib/avatar";

export function AgentAvatar({
  id,
  name,
  size = 18,
  className,
}: {
  id: string;
  /** Display name supplying the initial; omitted, the id's initial is used. */
  name?: string;
  size?: number;
  className?: string;
}) {
  const tile = avatarTile(id);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      style={{ "--tile-fg": tile.fg, "--tile-fg-dark": tile.fgDark } as CSSProperties}
      aria-hidden
      role="img"
    >
      <rect x="0" y="0" width="24" height="24" rx="5" fill={tile.bg} />
      <text
        x="12"
        y="12"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="13"
        fontWeight="700"
        className="[fill:var(--tile-fg)] dark:[fill:var(--tile-fg-dark)]"
      >
        {avatarInitial(name ?? "", id)}
      </text>
    </svg>
  );
}
