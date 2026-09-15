/**
 * The signed-in account's avatar, wherever it is drawn: the sidebar's bottom user row, the
 * collapsed rail's trigger, the account menu's header, and the Profile page's preview.
 *
 * Two states, one component. With an avatar stored it is that image, cropped to the circle;
 * without one it is the letter tile the app has always drawn — a solid dark disc with the
 * initial in white, which is deliberately NOT the tinted hashed tile `AgentAvatar` uses: an
 * account is the one identity the viewer already knows, so it does not need a colour to be
 * told apart from its neighbours, and there is only ever one of it on screen. The initial
 * follows the nickname once there is one, falling back to the id, so the tile changes with
 * the name rather than contradicting it.
 *
 * `size` is in pixels and the letter's size is derived from it, rather than both coming from
 * the type scale: the disc is a fixed box, so a letter that grew with the user's font-size
 * setting would outgrow it at the largest tier. The two rungs in use are named below.
 */
import type { CSSProperties, ReactNode } from "react";

import { avatarInitial } from "../../lib/avatar";

/**
 * The sizes a user avatar is drawn at, named by the slot rather than by the number (the
 * `icon-scale.ts` convention). `tile` is what the nav row, the rail and the menu header share
 * — the three must stay identical, because collapsing the sidebar swaps one for another and a
 * changed size would pop. `preview` is the Profile page, where the avatar is the subject.
 */
export const USER_AVATAR_SIZE = { tile: 28, preview: 64 } as const;

/** The letter's share of the disc: large enough to read at 28px, still inside the circle at 64. */
const INITIAL_RATIO = 0.45;

export function UserAvatar({
  userId,
  displayName,
  avatar,
  size = USER_AVATAR_SIZE.tile,
  className,
  children,
}: {
  /** The account's id — the fallback initial, and what the accessible name names. */
  userId: string;
  /** Nickname, when set: it supplies the initial and the accessible name. */
  displayName?: string;
  /** Stored avatar as a data URL; absent, the letter tile is drawn. */
  avatar?: string;
  /** Edge length in pixels — pass a `USER_AVATAR_SIZE` rung. */
  size?: number;
  className?: string;
  /** Overlay slot, positioned against this disc: the nav and rail triggers hang UpdateDot here. */
  children?: ReactNode;
}) {
  const who = displayName ?? userId;
  const box: CSSProperties = { width: size, height: size };
  if (avatar !== undefined) {
    return (
      <span className={`relative block shrink-0 ${className ?? ""}`} style={box}>
        {/* object-cover, though a stored avatar is already square: one written by an API client
            rather than by the Profile page's crop must still fill the circle, not stretch into
            it. alt="" for the reason the letter tile is aria-hidden — see below. */}
        <img src={avatar} alt="" className="h-full w-full rounded-full object-cover" style={box} />
        {children}
      </span>
    );
  }
  return (
    <span
      // Decorative, like the image above: the mark is never the account's name. Every anchor
      // this sits in already names the account, in its own accessible name or in the text
      // beside it, so announcing a bare initial as well would only repeat the first letter.
      aria-hidden
      className={`relative flex shrink-0 items-center justify-center rounded-full bg-gray-900 font-bold text-white dark:bg-gray-200 dark:text-gray-900 ${className ?? ""}`}
      style={{ ...box, fontSize: Math.round(size * INITIAL_RATIO) }}
    >
      {avatarInitial(who, userId)}
      {children}
    </span>
  );
}
