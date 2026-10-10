/**
 * An account's avatar, wherever it is drawn: a navigation row, a collapsed rail's trigger, an
 * account menu's header, a profile page's preview.
 *
 * Two states, one component. With an avatar stored it is that image, cropped to the circle;
 * without one it is a letter disc — the foreground colour with the initial in the canvas colour,
 * which is deliberately NOT the tinted hashed tile `AgentAvatar` uses: an account is the one
 * identity the viewer already knows, so it does not need a colour to be told apart from its
 * neighbours, and there is only ever one of it on screen. The initial follows the nickname once
 * there is one, falling back to the id, so the disc changes with the name rather than
 * contradicting it.
 *
 * `size` is in pixels and the letter's size is derived from it, rather than both coming from the
 * type scale: the disc is a fixed box, so a letter that grew with the user's font-size setting
 * would outgrow it at the largest tier.
 */
import type { CSSProperties, ReactNode } from "react";
import { avatarInitial } from "./avatar";

/**
 * The sizes a user avatar is drawn at, named by the slot rather than by the number (the
 * `ICON_SIZE` convention). `tile` is what a navigation row, a rail and a menu header share — the
 * three must stay identical, because collapsing a sidebar swaps one for another and a changed
 * size would pop. `preview` is a profile page, where the avatar is the subject of its settings
 * row — one step above the row's controls, not a hero (40px; it was 64px until 2026-10-02).
 */
export const USER_AVATAR_SIZE = { tile: 28, preview: 40 } as const;

/** The letter's share of the disc: large enough to read at 28px, still inside the circle at 40. */
const INITIAL_RATIO = 0.45;

export function UserAvatar({
  userId,
  displayName,
  avatar,
  size = USER_AVATAR_SIZE.tile,
  className,
  children,
}: {
  /** The account's id — the fallback initial. */
  userId: string;
  /** Nickname, when set: it supplies the initial. */
  displayName?: string;
  /** Stored avatar as a URL (a data URL from a profile upload); absent, the letter disc is drawn. */
  avatar?: string;
  /** Edge length in pixels — pass a `USER_AVATAR_SIZE` rung. */
  size?: number;
  className?: string;
  /** Overlay slot, positioned against this disc: a trigger hangs its update dot here. */
  children?: ReactNode;
}) {
  const who = displayName ?? userId;
  const box: CSSProperties = { width: size, height: size };
  if (avatar !== undefined) {
    return (
      <span className={`relative block shrink-0 ${className ?? ""}`} style={box}>
        {/* object-cover, though a stored avatar is usually square already: one written by an API
            client rather than by a cropping upload must still fill the circle, not stretch into
            it. alt="" for the reason the letter disc is aria-hidden — see below. */}
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
      className={`relative flex shrink-0 items-center justify-center rounded-full bg-fg font-bold text-canvas ${className ?? ""}`}
      style={{ ...box, fontSize: Math.round(size * INITIAL_RATIO) }}
    >
      {avatarInitial(who, userId)}
      {children}
    </span>
  );
}
