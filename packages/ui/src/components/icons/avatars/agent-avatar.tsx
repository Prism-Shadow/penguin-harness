/**
 * An Agent's default avatar: the Agent mascot, the smiling ball penguin, painted in the Agent's
 * colours (agent-avatar-variants.tsx, agent-palette.ts). It is what an Agent is drawn as wherever
 * it has no picture of its own — everywhere in development mode, and for a company employee whose
 * organization gave it none.
 *
 * The avatar is drawn in every theme's style at once and carries the `ui-avatar` hook: each
 * drawing is a direct child `<g data-variant="…">`, the foundation shows the `flat` one, and a
 * pack with a drawing of its own swaps it in from its recipes — so the avatar follows a theme
 * switch the moment the root's attribute changes, and a theme without a drawing shows Primer's.
 * The component never asks which theme is active. `variant` pins one drawing whatever the theme
 * (a theme preview, the gallery's board), and then the hook is left off.
 *
 * The colour hashes the Agent's id — never its display name — so it survives renames, and every
 * drawing paints the same colours and the same smiling face, so it survives theme switches too. No
 * initial is drawn: every place an avatar sits shows the Agent's name beside it or on hover, and
 * at the 14–18 px most avatars are drawn at, a letter and a penguin do not both fit.
 */
import { AGENT_AVATAR_VARIANTS, AGENT_AVATAR_VARIANT_NAMES } from "./agent-avatar-variants";
import type { AgentAvatarVariant } from "./agent-avatar-variants";
import { agentColors } from "./agent-palette";

export function AgentAvatar({
  id,
  size = 18,
  className,
  variant,
}: {
  id: string;
  size?: number;
  className?: string;
  /** One drawing whatever the theme; omitted, the active theme's. */
  variant?: AgentAvatarVariant;
}) {
  const colors = agentColors(id);
  const drawn = variant === undefined ? AGENT_AVATAR_VARIANT_NAMES : [variant];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={`${variant === undefined ? "ui-avatar" : ""} ${className ?? ""}`}
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
