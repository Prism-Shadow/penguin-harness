/**
 * A few avatars overlapping in a row, then a "+n" for the rest: who is in a channel, which agents
 * a benchmark has tested. The avatars are decorative — the names belong to the caller's tooltip
 * or label, since a row of initials names nobody — while the count stays readable text.
 *
 * Each avatar is ringed in the canvas colour so overlapping tiles stay apart; the ring follows
 * the avatar's own outline (a disc for an account, the tile's fixed corner for an agent), which
 * is geometry of the tile rather than a theme radius.
 */
import { AgentAvatar } from "./agent-avatar";
import { UserAvatar } from "./user-avatar";

export interface AvatarStackItem {
  /** The stable id: an agent's tile colour hashes it; an account's disc falls back to its initial. */
  id: string;
  /** Display name supplying the initial. */
  name: string;
  /** Whose avatar: an agent's tinted tile (the default) or an account's disc. */
  kind?: "agent" | "user";
  /** An account's stored image; an agent has none. */
  src?: string;
}

/** An agent tile's corner: `rx="5"` on its 24-unit box, at the rendered size. */
const tileRadius = (size: number) => (size * 5) / 24;

export function AvatarStack({
  items,
  max = 3,
  size,
  className = "",
}: {
  items: readonly AvatarStackItem[];
  /** How many avatars are drawn before the count takes over. */
  max?: number;
  /** Edge length of one avatar in pixels (an `ICON_SIZE` rung). */
  size: number;
  className?: string;
}) {
  const shown = items.slice(0, max);
  const rest = items.length - shown.length;
  return (
    <span className={`flex shrink-0 items-center gap-1 ${className}`}>
      <span className="flex -space-x-1" aria-hidden>
        {shown.map((item) => (
          <span
            key={`${item.kind ?? "agent"}:${item.id}`}
            className="flex shrink-0 ring-2 ring-canvas"
            style={{ borderRadius: item.kind === "user" ? "50%" : tileRadius(size) }}
          >
            {item.kind === "user" ? (
              <UserAvatar userId={item.id} displayName={item.name} avatar={item.src} size={size} />
            ) : (
              <AgentAvatar id={item.id} name={item.name} size={size} />
            )}
          </span>
        ))}
      </span>
      {rest > 0 && <span className="text-xs tabular-nums text-fg-subtle">{`+${rest}`}</span>}
    </span>
  );
}
