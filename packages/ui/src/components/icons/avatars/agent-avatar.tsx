/**
 * An Agent's avatar: its own picture when it has one (`src`), else its default avatar — the
 * Agent mascot, the smiling ball penguin, painted in the Agent's colours (agent-avatar-variants.tsx,
 * agent-palette.ts). The default is what an Agent is drawn as wherever it has no picture of its
 * own, and wherever its picture fails to load.
 *
 * The default is drawn in every theme's style at once and carries the `ui-avatar` hook: each
 * drawing is a direct child `<g data-variant="…">`, the foundation shows the `flat` one, and a
 * pack with a drawing of its own swaps it in from its recipes — so the avatar follows a theme
 * switch the moment the root's attribute changes, and a theme without a drawing shows Primer's.
 * The component never asks which theme is active. `variant` pins one drawing whatever the theme
 * (a theme preview, the gallery's board), and then the hook is left off.
 *
 * A picture is the host of the same hook, so a theme that treats the avatar's box treats both
 * alike. It keeps the Agent's tile — the flat drawing's rounded square, at the rendered size —
 * rather than an account's circle, so an Agent and a person stay told apart at a glance.
 *
 * The colour hashes the Agent's id — never its display name — so it survives renames, and every
 * drawing paints the same colours and the same smiling face, so it survives theme switches too. No
 * initial is drawn: every place an avatar sits shows the Agent's name beside it or on hover, and
 * at the 14–18 px most avatars are drawn at, a letter and a penguin do not both fit.
 */
import { useState } from "react";
import { AGENT_AVATAR_VARIANTS, AGENT_AVATAR_VARIANT_NAMES } from "./agent-avatar-variants";
import type { AgentAvatarVariant } from "./agent-avatar-variants";
import { agentColors } from "./agent-palette";

/** The Agent tile's corner at `size` px: the flat drawing's `rx="5"` on its 24-unit box. */
export const agentTileRadius = (size: number): number => (size * 5) / 24;

export function AgentAvatar({
  id,
  size = 18,
  className,
  variant,
  src,
}: {
  id: string;
  size?: number;
  className?: string;
  /** One drawing whatever the theme; omitted, the active theme's. */
  variant?: AgentAvatarVariant;
  /** The Agent's own picture, as a URL; absent — or once it fails to load — the default is drawn. */
  src?: string | undefined;
}) {
  /** The picture that failed to load: a new `src` is tried afresh. */
  const [failed, setFailed] = useState<string | null>(null);
  const hook = variant === undefined ? "ui-avatar" : "";
  if (src !== undefined && src !== failed) {
    return (
      // Decorative, like the drawing: the name beside the avatar is what names the Agent.
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        draggable={false}
        onError={() => setFailed(src)}
        className={`${hook} object-cover ${className ?? ""}`}
        style={{ width: size, height: size, borderRadius: agentTileRadius(size) }}
      />
    );
  }
  const colors = agentColors(id);
  const drawn = variant === undefined ? AGENT_AVATAR_VARIANT_NAMES : [variant];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={`${hook} ${className ?? ""}`}
      aria-hidden
      role="img"
    >
      {drawn.map((name) => {
        const Drawing = AGENT_AVATAR_VARIANTS[name];
        return (
          <g key={name} data-variant={name}>
            <Drawing colors={colors} size={size} />
          </g>
        );
      })}
    </svg>
  );
}
