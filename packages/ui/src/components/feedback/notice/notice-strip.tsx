/**
 * A notice that owns a row: an error line, a warning above a form, a status strip — and, drawn by
 * the Toaster, a toast. The caller keeps its own layout, spacing, radius and border width
 * (`border`, `border-b` or none), so every strip sits where its caller puts it; the strip adds
 * the tone.
 *
 * The tone is a tint with its own ink (`bg-tone-<t>-bg text-tone-<t>-fg`) on the neutral line
 * (`border-line`): the tint alone says which tone it is, and a tinted box that also took its
 * tone's line would say it twice.
 *
 * It carries the `ui-notice` hook, so a theme can render notices its own way — a floating card
 * with a tone dot, a console status line with a tone tag — without a call site knowing.
 * `data-tone` names the tone in the hook's words ({@link NOTICE_TONE}). Children may mark their
 * parts with `data-slot`: `"body"` for the text, `"title"` for a heading, `"actions"` for the
 * buttons, and `"icon"` for a mark the caller draws before its text (a dot, a glyph). A mark
 * belongs in that slot: a theme that draws its own tone mark hides the slot, so a mark left
 * outside it would show twice. An action's own glyph, inside its button, is not the notice's
 * mark. (The web app's `notice-chart-hooks` test holds every call site to this.)
 */
import type { HTMLAttributes, ReactNode } from "react";
import type { ToneName } from "../../../tokens";

/** The `ui-notice` hook's tone words: what `data-tone` says and the theme recipes select on. */
export type NoticeTone = "info" | "success" | "warning" | "danger" | "neutral";

/** The tones a notice takes: every semantic tone but `done`, which the hook has no word for. */
export type NoticeStripTone = Exclude<ToneName, "done">;

/** The tones in the hook's words: an unfinished state warns, a settled one is neutral. */
export const NOTICE_TONE: Readonly<Record<NoticeStripTone, NoticeTone>> = {
  info: "info",
  success: "success",
  attention: "warning",
  danger: "danger",
  neutral: "neutral",
};

/** A tone's tint and the ink that reads on it. */
const TONE_CLASS: Readonly<Record<NoticeStripTone, string>> = {
  info: "bg-tone-info-bg text-tone-info-fg",
  success: "bg-tone-success-bg text-tone-success-fg",
  attention: "bg-tone-attention-bg text-tone-attention-fg",
  danger: "bg-tone-danger-bg text-tone-danger-fg",
  neutral: "bg-tone-neutral-bg text-tone-neutral-fg",
};

export function NoticeStrip({
  tone,
  as: Tag = "div",
  className = "",
  children,
  ...rest
}: {
  tone: NoticeStripTone;
  /**
   * A strip that is one sentence of prose may be a paragraph; a notice the reader presses (a
   * toast, which dismisses itself) is a button, and gets `type="button"`.
   */
  as?: "div" | "p" | "button";
  /** Layout, spacing, radius and border width; the colours are the tone's. */
  className?: string;
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, "className" | "children">) {
  return (
    <Tag
      {...rest}
      {...(Tag === "button" ? { type: "button" as const } : {})}
      data-tone={NOTICE_TONE[tone]}
      className={`ui-notice ${className} border-line ${TONE_CLASS[tone]}`}
    >
      {children}
    </Tag>
  );
}
