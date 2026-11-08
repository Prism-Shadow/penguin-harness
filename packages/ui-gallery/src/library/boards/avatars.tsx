/**
 * 头像: the user avatar at its two rungs, with and without a nickname; the agent avatar — the
 * active theme's drawing once in each of the twelve palette colours, then every theme's drawing
 * pinned side by side, each at 16, 24 and 48 px; an agent's own picture at the same sizes, beside
 * one whose picture fails to load and draws the default; and the avatar stack — agents and an
 * account overlapping, then the count of the rest. The page's mode switch shows the other mode.
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

/** The sizes the board draws: the sidebar's row, a list's, and a dialog's face. */
const SIZES = [16, 24, 48] as const;

/** An agent's own picture, as an upload would make it: a square scene, as an SVG data URL. */
const PICTURE = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">' +
    '<rect width="128" height="128" fill="hsl(200 70% 72%)"/>' +
    '<circle cx="92" cy="38" r="16" fill="hsl(45 95% 62%)"/>' +
    '<path d="M0 128V86q32-30 64-8t64-10v60Z" fill="hsl(140 40% 42%)"/></svg>',
)}`;

/** A picture URL that never loads: the avatar falls back to the default drawing. */
const BROKEN_PICTURE = "/no-such-picture.png";

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
  const [userId, displayName] = t.userNames;
  const stack = [
    { id: userId ?? "admin", name: displayName ?? userId ?? "admin", kind: "user" as const },
    ...t.agents.map((agent, i) => ({
      id: agent.id,
      name: agent.name,
      // The first agent has a picture of its own, among the drawn ones.
      ...(i === 0 ? { src: PICTURE } : {}),
    })),
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
                <h2>{S.rail.themeNames[DRAWN_BY[variant]]}</h2>
              </div>
              {SIZES.map((size) => (
                <PaletteRow key={size} size={size} variant={variant} />
              ))}
            </section>
          ))}
        </div>
      </BoardGroup>
      <BoardGroup title={t.picture} aside={t.pictureAside}>
        <div className="lib-row">
          {SIZES.map((size) => (
            <span key={size} className="lib-cell" data-avatar-board="picture">
              <AgentAvatar id="docs-expert" size={size} src={PICTURE} />
              <span className="lib-caption">{t.sizeCaption(size)}</span>
            </span>
          ))}
          <span className="lib-cell" data-avatar-board="broken">
            <AgentAvatar id="docs-expert" size={SIZES[2]} src={BROKEN_PICTURE} />
            <span className="lib-caption">{t.pictureBroken}</span>
          </span>
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
