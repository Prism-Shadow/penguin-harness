/**
 * A notice that owns a row: an error line, a warning above a form, a status strip. The strip's
 * colours are `toneStrip`'s, chosen by meaning (see lib/tone.ts); the caller keeps its own
 * layout, spacing and border classes, so every strip sits where it sat before.
 *
 * It carries the `ui-notice` hook, so a theme can render notices its own way — a floating card
 * with a tone dot, a log line with a tone tag — without every call site knowing. `data-tone`
 * names the tone in the hook's vocabulary; callers may mark their text `data-slot="body"` and
 * their buttons `data-slot="actions"`.
 */
import type { HTMLAttributes, ReactNode } from "react";
import { toneStrip } from "../../lib/tone";
import type { Tone } from "../../lib/tone";

export type NoticeTone = "info" | "success" | "warning" | "danger" | "neutral";

/** The app's tones in the notice hook's words: an unfinished state warns, a settled one is neutral. */
export const NOTICE_TONE: Readonly<Record<Tone, NoticeTone>> = {
  busy: "success",
  success: "success",
  attention: "warning",
  danger: "danger",
  link: "info",
  muted: "neutral",
};

export function NoticeStrip({
  tone,
  as: Tag = "div",
  className = "",
  children,
  ...rest
}: {
  tone: Tone;
  /** A strip that is one sentence of prose may be a paragraph. */
  as?: "div" | "p";
  className?: string;
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, "className" | "children">) {
  return (
    <Tag
      {...rest}
      data-tone={NOTICE_TONE[tone]}
      className={`ui-notice ${className} ${toneStrip[tone]}`}
    >
      {children}
    </Tag>
  );
}
