/**
 * The transcript's messages that are not the agent's reply (that one is `AssistantText`): what
 * the person sent, and the one-line notices the run leaves between turns.
 *
 * - `MessageRow` is a message the person sent: a column on the right, with its footer under it.
 *   A prompt that starts a Task takes a turn's room; a steer delivered inside a running Task is
 *   tighter, since it starts nothing.
 * - `MessageBubble` is the chrome, in four variants: `user`, the prompt's text in a tinted
 *   bubble; `image`, an image sent with it, in the same bubble with a thin inset; `steering`,
 *   a lighter bordered chip for a steer, marked by the person glyph and a short label, with the
 *   images and files it carried inside it; and `notice`, a quiet mono line — an abort, a failed
 *   request, a reconnect with its controls — in the muted ink or, for a reconnect, the attention
 *   ink.
 * - `MessageMeta` is the footer: the time and a copy button. From `sm` up it is invisible but
 *   takes its room (`opacity-0`, not `hidden`), and surfaces while the pointer is over the row or
 *   focus is inside it — hover alone would leave a keyboard user a copy button that is focusable
 *   but never shown, and `hidden` would shove everything below down each time it appeared. Below
 *   `sm` it is always shown: touch has no hover.
 * - `MessageImage` is an image in a bubble or a chip: it opens large on a click.
 *
 * Wrapping: a message is `wrap-anywhere` — long unbroken strings (attachment paths, long URLs)
 * wrap inside the bubble on a narrow screen instead of overflowing, and unlike `break-words` it
 * also shrinks the min-content width, so a pathological token cannot stretch the bubble itself.
 * Ordinary words still break only when a token cannot fit on a line.
 */
import type { ReactNode } from "react";
import { CopyButton } from "../../actions/copy-button/copy-button";
import { GlyphIcon } from "../../icons/glyph-icon/glyph-icon";
import { ICONS } from "../../icons/icons";
import { ZoomableImage } from "../../overlays/lightbox/lightbox";

/** How far a bubble may reach across the transcript. */
const WIDTH = "max-w-[88%] md:max-w-[75%]";

/** A message the person sent: right-aligned, with its footer under it. */
export function MessageRow({
  spacing = "turn",
  children,
}: {
  /** `turn` for a prompt; `steer` for a steer inside a running Task. */
  spacing?: "turn" | "steer";
  children?: ReactNode;
}) {
  return (
    <div
      className={`anim-msg group ${spacing === "turn" ? "my-4" : "my-2"} flex flex-col items-end`}
    >
      {children}
    </div>
  );
}

export type MessageBubbleVariant = "user" | "image" | "steering" | "notice";

export interface MessageBubbleProps {
  variant: MessageBubbleVariant;
  /** The message: its text (`user`, `steering`, `notice`) or its image (`image`). */
  children?: ReactNode;
  /** `steering`: the word that marks the chip as a steer, set before its text. */
  label?: string;
  /** `steering`: the images it carried, laid out in a wrapping row under the text. */
  media?: ReactNode;
  /** `steering`: the files it carried (a files notice), under the images. */
  attachments?: ReactNode;
  /** `notice`: `neutral` for an abort or a failed request, `attention` for a reconnect. */
  tone?: "neutral" | "attention";
  /** `notice`: controls at the end of the line (retry now, give up). */
  actions?: ReactNode;
}

export function MessageBubble({
  variant,
  children,
  label,
  media,
  attachments,
  tone = "neutral",
  actions,
}: MessageBubbleProps) {
  switch (variant) {
    case "user":
      return (
        <div className={`${WIDTH} rounded-lg bg-fill-neutral px-4 py-2.5`}>
          <p className="wrap-anywhere font-sans whitespace-pre-wrap text-base leading-relaxed text-fg">
            {children}
          </p>
        </div>
      );
    case "image":
      return <div className={`${WIDTH} rounded-lg bg-fill-neutral p-1.5`}>{children}</div>;
    case "steering":
      return (
        <div
          className={`flex ${WIDTH} flex-col gap-1.5 rounded-md border border-line-emphasis bg-fill-neutral px-3 py-1.5`}
        >
          <div className="flex items-start gap-1.5">
            <GlyphIcon d={ICONS.user} className="mt-1 shrink-0 text-fg-subtle" />
            <p className="wrap-anywhere font-sans whitespace-pre-wrap text-sm leading-relaxed text-fg">
              {label !== undefined && (
                <span className="mr-1.5 text-xs font-semibold text-fg-muted">{label}</span>
              )}
              {children}
            </p>
          </div>
          {media !== undefined && <div className="flex flex-wrap justify-end gap-1.5">{media}</div>}
          {attachments !== undefined && <div className="flex justify-end">{attachments}</div>}
        </div>
      );
    case "notice":
      return (
        <p
          className={`anim-msg my-1 font-mono text-xs ${
            tone === "attention" ? "text-tone-attention-fg" : "text-fg-muted"
          } ${actions !== undefined ? "flex flex-wrap items-center gap-x-2 gap-y-1" : ""}`}
        >
          {children}
          {actions !== undefined && (
            <span className="flex shrink-0 items-center gap-1.5">{actions}</span>
          )}
        </p>
      );
  }
}

/** An image the person sent, in its bubble (`bubble`) or among a steer's (`chip`, smaller). */
export function MessageImage({
  src,
  alt,
  size = "bubble",
}: {
  src: string;
  alt: string;
  size?: "bubble" | "chip";
}) {
  return (
    <ZoomableImage
      src={src}
      alt={alt}
      className={
        size === "bubble"
          ? "max-h-48 max-w-full rounded-control"
          : "max-h-28 max-w-full rounded-control"
      }
    />
  );
}

/** A message's footer: its time, and a copy button when there is text to copy. */
export function MessageMeta({
  time,
  copy,
  align = "end",
}: {
  /** When the message was sent, formatted by the caller. */
  time?: string;
  /** What the copy button copies, and its name. An image has nothing to copy, so no button. */
  copy?: { text: string; label: string };
  /** Which edge the footer keeps to: the message's side. */
  align?: "start" | "end";
}) {
  return (
    <div
      className={`flex h-5 items-center gap-2 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100 sm:opacity-0 ${
        align === "end" ? "justify-end" : "justify-start"
      }`}
    >
      {time !== undefined && <span className="text-xs text-fg-subtle">{time}</span>}
      {copy !== undefined && <CopyButton text={copy.text} label={copy.label} />}
    </div>
  );
}
