/**
 * An agent's avatar: its initial as coloured ink on a light tinted tile (the letter-tile style
 * `ProviderLogo` also draws for user-defined model groups).
 *
 * The colour hashes the agent's id — not its display name — so it survives renames; the initial
 * comes from the display name when the caller has one, falling back to the id. The ink follows
 * the colour scheme through one `light-dark()` value, keeping ≥ 4.5:1 on the tile for every hue
 * in both modes (see `avatar.ts`).
 */
import { avatarInitial, avatarTile } from "./avatar";

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
        style={{ fill: tile.ink }}
      >
        {avatarInitial(name ?? "", id)}
      </text>
    </svg>
  );
}
