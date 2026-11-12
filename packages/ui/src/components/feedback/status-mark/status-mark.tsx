/**
 * A thing's status as a glyph and a word: what a plugin, a model or a run stands at, inline on a
 * facts line. The glyph carries the tone — what the status means: settled well, unfinished,
 * failed — and the word beside it stays in the line's muted ink, never in the tone's colour, so a
 * row of statuses reads as words with a coloured mark rather than as coloured text. A status that
 * asks nothing of the reader (elsewhere, not there yet) takes no tone: its glyph recedes in the
 * subtle ink.
 *
 * The hint is the hover sentence: what the status means for this thing (why it failed, how many
 * are behind). It says what the word does not, so it is a marked hint and opens over the word.
 * The word is always on screen, so colour is never the only carrier.
 *
 * Props only: the glyph, the tone and every word are the caller's. Rest props land on the mark's
 * own element (a `data-testid`, an id).
 */
import type { HTMLAttributes } from "react";
import { ICON_GAP, ICON_SIZE } from "../../../icon-scale";
import type { ToneName } from "../../../tokens";
import { GlyphIcon } from "../../icons/glyph-icon/glyph-icon";

/** The glyph's ink per tone: the tone's foreground token. */
const INK: Readonly<Record<ToneName, string>> = {
  success: "text-tone-success-fg",
  attention: "text-tone-attention-fg",
  danger: "text-tone-danger-fg",
  done: "text-tone-done-fg",
  neutral: "text-tone-neutral-fg",
  info: "text-tone-info-fg",
};

export interface StatusMarkProps extends HTMLAttributes<HTMLSpanElement> {
  /** A registry path from `ICONS`. */
  glyph: string;
  /** What the status means; omitted, the mark recedes (settled, nothing to do). */
  tone?: ToneName;
  /** The status word, in muted ink — never in the tone's colour. */
  label: string;
  /** The sentence on hover: what the status means for this thing. */
  hint?: string;
}

export function StatusMark({ glyph, tone, label, hint, className = "", ...rest }: StatusMarkProps) {
  return (
    <span
      className={`inline-flex shrink-0 items-center ${ICON_GAP.tight} ${className}`}
      {...(hint !== undefined
        ? { "data-tooltip": hint, "data-tooltip-content": "text", "data-tooltip-extra": true }
        : {})}
      {...rest}
    >
      <GlyphIcon
        d={glyph}
        size={ICON_SIZE.inlineGlyph}
        className={tone === undefined ? "text-fg-subtle" : INK[tone]}
      />
      <span>{label}</span>
    </span>
  );
}
