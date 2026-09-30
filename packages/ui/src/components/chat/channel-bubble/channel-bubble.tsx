/**
 * A company channel's stream, drawn the way every chat client draws one: `ChannelRun` is one
 * sender's run of consecutive messages, and `ChannelBubble` is one message in it.
 *
 * Somebody else's run stands on the left: the avatar once, top-aligned so that it sits beside the
 * sender's name — with whatever the caller hangs after the name, such as a relay chip — and the
 * run's bubbles under both, in the column the name starts. Who is speaking is one mark, so the two
 * halves of it stay on one line: an avatar tied to the run's last bubble would drift a screenful
 * below its own name as soon as a message runs long. The reader's own run stands on the right in
 * its own tint, with no avatar and no name; a screen reader hears `ownLabel` instead, since a side
 * and a colour are not something every reader can read.
 *
 * Each bubble carries its own time at its end, inside it, bottom-aligned: on a one-line message it
 * lands beside the words, on a longer one it settles into the bottom-right corner, and it never
 * overlaps the body. A time that only appeared on hover would be one a touch reader never sees, and
 * one time per run would leave every later message in a long run unstamped. The body is Markdown in
 * the compact reading box; what the caller renders into it is its own (a channel keeps its
 * `@mentions` as chips), and `footer` sits under it — the chips for what the message refers to.
 *
 * The two surfaces. Somebody else's bubble is the neutral tone's tint. The reader's own is a wash
 * of the link ink over the canvas — the theme's identity blue in the default theme — rather than
 * a status tone, because which side of a conversation wrote a message is an identity, not a
 * judgement, and rather than the accent, which is grey in the default theme, where a wash of it
 * is the neutral bubble again. A message that names the reader is marked by its mention chip
 * alone: a tinted bubble would read as a state of the whole message.
 *
 * channel-bubble.css deepens the inline-code chip and the table rules inside a bubble, which the
 * Markdown typography prints in the neutral tint the bubble itself is drawn in.
 */
import type { ReactNode } from "react";
import { ICON_GAP } from "../../../icon-scale";
import { AgentAvatar } from "../../icons/avatars/agent-avatar";
import { avatarInitial } from "../../icons/avatars/avatar";
import "../../content/prose/prose.css";
import "./channel-bubble.css";

/** Who speaks a run. */
export interface ChannelSender {
  /** An employee (the agent's tinted tile) or a person (the initial on the foreground ink). */
  kind: "agent" | "user";
  /** The stable id: an agent's tile colour hashes it; the initial falls back to it on no name. */
  id: string;
  /** The display name: the run's header, and the avatar's initial. */
  name: string;
}

/** The avatar that leads somebody else's run, in pixels: a tile, one rung above a line glyph. */
const RUN_AVATAR_PX = 28;

/** The run's leading tile. Decorative: the name beside it is what names the sender. */
function SenderAvatar({ sender }: { sender: ChannelSender }) {
  if (sender.kind === "agent") {
    return (
      <AgentAvatar
        id={sender.id}
        name={sender.name}
        size={RUN_AVATAR_PX}
        className="shrink-0 rounded-md"
      />
    );
  }
  return (
    <span
      aria-hidden
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-fg text-xs font-bold text-canvas"
    >
      {avatarInitial(sender.name, sender.id)}
    </span>
  );
}

export interface ChannelRunProps {
  /** Who is speaking. */
  sender: ChannelSender;
  /** The reader's own run: on the right, in its own tint, with neither an avatar nor a name. */
  own?: boolean;
  /**
   * What a screen reader hears in place of the name on the reader's own run ("You"); the sender's
   * name when omitted.
   */
  ownLabel?: string;
  /** After the name on somebody else's run: a relay chip, with its tooltip. */
  meta?: ReactNode;
  /** The run's bubbles, in order. */
  children: ReactNode;
}

/** One sender's run of consecutive messages. */
export function ChannelRun({ sender, own = false, ownLabel, meta, children }: ChannelRunProps) {
  return (
    <div className={`flex items-start ${ICON_GAP.card} py-1.5`}>
      {!own && <SenderAvatar sender={sender} />}
      <div className={`flex min-w-0 flex-1 flex-col gap-1 ${own ? "items-end" : "items-start"}`}>
        {own ? (
          <span className="sr-only">{ownLabel ?? sender.name}</span>
        ) : (
          <div className={`flex max-w-full flex-wrap items-baseline ${ICON_GAP.row} px-1 text-xs`}>
            <span className="truncate font-semibold text-fg-muted">{sender.name}</span>
            {meta}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

/** The two bubble surfaces; see the module comment for why the reader's own is the link's wash. */
const SURFACE = {
  other: "bg-fill-neutral text-fg",
  own: "bg-[color-mix(in_srgb,var(--ui-fg-link)_12%,var(--ui-canvas))] text-fg",
} as const;

/**
 * A bubble's corners: 2xl all round, except on the last bubble of a run, where the corner nearest
 * the run's tail is squared — bottom-left on somebody else's side of the stream, bottom-right on
 * the reader's own. Every corner is named rather than layering a per-corner utility over the
 * all-corner one, so the result does not depend on which of the two the stylesheet emits last.
 */
function corners(own: boolean, last: boolean): string {
  if (!last) return "rounded-2xl";
  return own
    ? "rounded-bl-2xl rounded-br-sm rounded-tl-2xl rounded-tr-2xl"
    : "rounded-bl-sm rounded-br-2xl rounded-tl-2xl rounded-tr-2xl";
}

export interface ChannelBubbleProps {
  /** The reader's own message: its side's tint and its tail corner. */
  own?: boolean;
  /** The last bubble of its run: the corner nearest the run's tail is squared. */
  last?: boolean;
  /** The clock time printed at the bubble's end ("14:05"). */
  time: string;
  /** What a screen reader hears for the time, in place of the printed clock ("Sent at …"). */
  timeLabel: string;
  /** The full date and time, the printed clock's tooltip. */
  timeTooltip?: string;
  /** Under the body, inside the bubble: the chips for what the message refers to. */
  footer?: ReactNode;
  /** The element id, so a reference elsewhere in the stream can scroll to this message. */
  id?: string;
  /** The message body, rendered into the compact Markdown reading box. */
  children: ReactNode;
}

/** One message of a run. */
export function ChannelBubble({
  own = false,
  last = false,
  time,
  timeLabel,
  timeTooltip,
  footer,
  id,
  children,
}: ChannelBubbleProps) {
  return (
    <div
      id={id}
      data-side={own ? "own" : "other"}
      className={`channel-bubble max-w-[75%] px-3 py-1.5 text-sm leading-relaxed ${corners(own, last)} ${own ? SURFACE.own : SURFACE.other}`}
    >
      <div className={`flex items-end ${ICON_GAP.menu}`}>
        <div className="min-w-0 flex-1">
          <div className="md-body md-compact">{children}</div>
          {footer}
        </div>
        <span
          data-tooltip={timeTooltip}
          className="shrink-0 text-xs tabular-nums text-tone-neutral-fg"
        >
          <span className="sr-only">{timeLabel}</span>
          <span aria-hidden>{time}</span>
        </span>
      </div>
    </div>
  );
}
