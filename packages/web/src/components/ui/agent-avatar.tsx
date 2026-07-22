/**
 * Agent avatar: the Agent's initial on a solid color tile (same letter-tile
 * style ProviderLogo uses for user-defined model groups).
 *
 * The color hashes the agentId — not the display name — so it survives
 * renames; the initial comes from the display name when the caller has one,
 * falling back to the id. Solid inline HSL is theme-agnostic (readable under
 * the white initial in both light and dark).
 */
import { avatarColor, avatarInitial } from "../../lib/avatar";

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
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      aria-hidden
      role="img"
    >
      <rect x="0" y="0" width="24" height="24" rx="5" fill={avatarColor(id)} />
      <text
        x="12"
        y="12"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="13"
        fontWeight="700"
        fill="white"
      >
        {avatarInitial(name ?? "", id)}
      </text>
    </svg>
  );
}
