/**
 * 头像: the user avatar at its two rungs, with and without a nickname; the agent avatar — the
 * active theme's drawing once in each of the twelve palette colours, then every theme's drawing
 * pinned side by side, each at 16, 24 and 48 px; and the avatar stack — agents and an account
 * overlapping, then the count of the rest. The page's mode switch shows the other mode.
 */
import {
  AGENT_AVATAR_VARIANT_NAMES,
  AGENT_PALETTE,
  AgentAvatar,
  AvatarStack,
  ICON_SIZE,
  USER_AVATAR_SIZE,
  UserAvatar,
  agentSlot,
} from "@prismshadow/penguin-ui";
import type { AgentAvatarVariant, ThemeId } from "@prismshadow/penguin-ui";
import { BoardGroup } from "../../foundations/shared";
import { useGallery } from "../../state";
import { useText } from "../../text";

/** The sizes the board draws: the sidebar's row, a list's, and a dialog's face. */
const SIZES = [16, 24, 48] as const;

/** The theme whose CSS shows each drawing, for its label. */
const DRAWN_BY: Readonly<Record<AgentAvatarVariant, ThemeId>> = {
  flat: "github",
  soft: "modern",
  pixel: "geek",
};

/** One sample id per palette slot, in slot order: the first `agent-<n>` that falls in each. */
const PALETTE_IDS: readonly string[] = (() => {
  const ids: string[] = [];
  let found = 0;
  for (let n = 0; found < AGENT_PALETTE.length; n++) {
    const id = `agent-${n}`;
    const slot = agentSlot(id);
    if (ids[slot] === undefined) {
      ids[slot] = id;
      found += 1;
    }
  }
  return ids;
})();

/** The palette at one size: the active theme's drawing, or the one `variant` pins. */
function PaletteRow({ size, variant }: { size: number; variant?: AgentAvatarVariant }) {
  const { S } = useGallery();
  return (
    <div className="lib-palette">
      <div className="lib-palette-row">
        {PALETTE_IDS.map((id) => (
          <AgentAvatar key={id} id={id} size={size} {...(variant ? { variant } : {})} />
        ))}
      </div>
      <span className="lib-caption">{S.library.avatars.sizeCaption(size)}</span>
    </div>
  );
}

export function AvatarsBoard() {
  const { S } = useGallery();
  const t = S.library.avatars;
  const text = useText();
  const [userId, displayName] = t.userNames;
  const stack = [
    { id: userId ?? "admin", name: displayName ?? userId ?? "admin", kind: "user" as const },
    ...t.agents.map((agent) => ({ id: agent.id, name: agent.name })),
  ];
  return (
    <div className="gf-board">
      <BoardGroup title={t.user}>
        <div className="lib-row">
          <span className="lib-cell">
            <UserAvatar userId={userId ?? "admin"} />
            <span className="lib-caption">{userId}</span>
          </span>
          <span className="lib-cell">
            <UserAvatar userId={userId ?? "admin"} displayName={displayName} />
            <span className="lib-caption">{displayName}</span>
          </span>
          <span className="lib-cell">
            <UserAvatar
              userId={userId ?? "admin"}
              displayName={displayName}
              size={USER_AVATAR_SIZE.preview}
            />
            <span className="lib-caption">{USER_AVATAR_SIZE.preview}px</span>
          </span>
        </div>
      </BoardGroup>
      <BoardGroup title={t.agent} aside={t.agentAside}>
        <div className="lib-stack lib-stack-wide" data-avatar-board="active">
          {SIZES.map((size) => (
            <PaletteRow key={size} size={size} />
          ))}
        </div>
      </BoardGroup>
      <BoardGroup title={t.variants} aside={t.variantsAside}>
        <div className="lib-stack lib-stack-wide">
          {AGENT_AVATAR_VARIANT_NAMES.map((variant) => (
            <section key={variant} className="lib-part" data-avatar-board={variant}>
              <div className="lib-part-head">
                <h2>{text.theme(DRAWN_BY[variant])}</h2>
              </div>
              {SIZES.map((size) => (
                <PaletteRow key={size} size={size} variant={variant} />
              ))}
            </section>
          ))}
        </div>
      </BoardGroup>
      <BoardGroup title={t.stack}>
        <div className="lib-row">
          <span className="lib-cell">
            <AvatarStack items={stack.slice(0, 3)} size={ICON_SIZE.groupHeaderAvatar} />
            <span className="lib-caption">{t.stackShown(3, 3)}</span>
          </span>
          <span className="lib-cell">
            <AvatarStack items={stack} size={ICON_SIZE.groupHeaderAvatar} />
            <span className="lib-caption">{t.stackShown(3, stack.length)}</span>
          </span>
          <span className="lib-cell">
            <AvatarStack items={stack} max={2} size={ICON_SIZE.rowLead} />
            <span className="lib-caption">{t.stackShown(2, stack.length)}</span>
          </span>
        </div>
      </BoardGroup>
    </div>
  );
}
