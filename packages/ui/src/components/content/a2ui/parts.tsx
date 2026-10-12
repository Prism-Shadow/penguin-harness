/**
 * The pieces every A2UI block shares: the four tones and how each is drawn, the note a callout and
 * a step's notices are drawn as, the placeholder a block shows while its reply is still streaming,
 * the source-plus-notice a block falls back to when it cannot be drawn, the inline text renderer
 * for the strings a model writes, an option's label, the arrow-key walk of an option group, and
 * the looks the blocks share so they read as one family: the title, the chip, the card.
 */
import type { ReactNode } from "react";
import type { A2uiOption } from "@prismshadow/penguin-core/a2ui";
import { ICONS } from "../../icons/icons";
import { Badge } from "../../feedback/badge/badge";
import { Notice } from "../../feedback/notice/notice";
import { GlyphIcon } from "../../icons/glyph-icon/glyph-icon";
import { useUiStrings } from "../../../strings";
import type { A2uiStrings } from "../../../strings";
import { CodeBlock } from "../code-block/code-block";
import "./a2ui.css";

/** A callout's tones, and the three notices a step may carry. */
export type A2uiTone = "note" | "tip" | "caution" | "warning";

/**
 * Each tone's mark, tint and the ink its mark takes, in the package's tone colours. A warning
 * (irreversible loss, security, harm) is the danger tone and a caution (something recoverable
 * breaks) the attention one, so the two never read as the same level. The tone's name is the
 * `A2uiStrings` key of the same spelling.
 */
export const A2UI_TONE: Readonly<Record<A2uiTone, { glyph: string; tint: string; ink: string }>> = {
  note: { glyph: ICONS.info, tint: "bg-tone-info-bg", ink: "text-tone-info-fg" },
  tip: { glyph: ICONS.lightbulb, tint: "bg-tone-success-bg", ink: "text-tone-success-fg" },
  caution: {
    glyph: ICONS.alertCircle,
    tint: "bg-tone-attention-bg",
    ink: "text-tone-attention-fg",
  },
  warning: { glyph: ICONS.triangleAlert, tint: "bg-tone-danger-bg", ink: "text-tone-danger-fg" },
};

/** A tone's name in the interface's words. */
export function toneName(strings: A2uiStrings, tone: A2uiTone): string {
  return strings[tone];
}

/**
 * A note in a tone — a callout, or the warning, caution or note a step carries — as one row: the
 * tone's mark, then the text, a title of the model's own leading it in the same line. The mark
 * alone says the tone; its name is the mark's tooltip and is read out before the text, never set
 * as a heading line above it.
 *
 * Content, not an app notice: it does not wear the `ui-notice` hook, which a theme may draw as a
 * floating card with a dot in place of the mark. The radius is the small rung and the padding
 * never less than it, so the text clears the corners in every theme.
 */
export function A2uiNote({
  tone,
  title,
  text,
  strings,
}: {
  tone: A2uiTone;
  title?: string;
  text: string;
  strings: A2uiStrings;
}) {
  const look = A2UI_TONE[tone];
  const name = toneName(strings, tone);
  return (
    <div
      role="note"
      data-tone={tone}
      className={`flex items-start gap-2 rounded-sm px-3 py-2 text-fg ${look.tint}`}
    >
      {/* One line tall, so the mark centres on the text's first line. */}
      <span
        aria-hidden
        data-tooltip={name}
        className={`flex h-[1lh] shrink-0 items-center ${look.ink}`}
      >
        <GlyphIcon d={look.glyph} />
      </span>
      <span className="min-w-0">
        <span className="sr-only">{`${name}: `}</span>
        {title !== undefined && (
          <span className="font-semibold">
            <InlineText text={title} />{" "}
          </span>
        )}
        <InlineText text={text} />
      </span>
    </div>
  );
}

/**
 * A model's string as inline text: `backtick` spans become inline code, everything else stays
 * text. The fields are plain strings, not Markdown, but a model writes a command or a path in
 * backticks out of habit, and showing the backticks would read as a typo.
 */
export function InlineText({ text }: { text: string }): ReactNode {
  if (!text.includes("`")) return text;
  return text
    .split(/`([^`\n]+)`/)
    .map((part, i) => (i % 2 === 1 ? <code key={i}>{part}</code> : part === "" ? null : part));
}

/**
 * A block's title — a choice's question, a form's or a steps list's title: one style for every
 * block, a rung under the reading text, so the block's own controls lead rather than its heading.
 */
export const A2UI_TITLE = "mb-2 text-sm font-medium text-fg";

/** The keyboard ring a block's pressable parts draw, the theme's own. */
const FOCUS_RING =
  "focus-visible:[outline:var(--ui-focus-ring)] " +
  "focus-visible:[outline-offset:var(--ui-focus-ring-offset)]";

/**
 * A pressable option's state: pressed takes the accent's line and a wash of it, the selected look
 * every block shares; at rest the hover darkens the line and fills the box. Chosen where the state
 * is known rather than through an `aria-pressed:` variant, because an `enabled:hover:` rule
 * outranks an `aria-pressed:` one on specificity and a pressed option under the pointer would
 * lose its accent line.
 */
export function pressLook(pressed: boolean): string {
  return pressed
    ? "border-accent bg-accent-muted"
    : "border-line bg-surface enabled:hover:border-line-emphasis enabled:hover:bg-surface-muted";
}

/**
 * Shared by the chip and the card: the line, the colour-only motion, focus, and the closed state,
 * which dims the way a disabled checkbox dims, so an older reply's question reads as answered.
 */
const PRESSABLE =
  "border transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60 " +
  FOCUS_RING;

/**
 * A chip: one short option in a wrapping row, the control's shape. Two rungs, as the controls
 * have: `base` for a choice in the reply's text, `sm` for a form, whose other controls are on the
 * small rung. The padding never falls under the radius, so a label clears a pill's curve.
 */
export const A2UI_CHIP: Readonly<Record<"base" | "sm", string>> = {
  base: `rounded-control px-3 py-1.5 text-sm ${PRESSABLE}`,
  sm: `rounded-control px-3 py-1 text-xs ${PRESSABLE}`,
};

/**
 * A card: one option with room for a sentence — a leading mark in the first column (the radio's
 * disc, or a checkbox), the label and its description in the second. The box's radius is the md
 * rung and its side padding at least that, so the text clears the corners in every theme.
 */
export const A2UI_CARD =
  "grid w-full grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2 rounded-md px-3 py-2 " +
  `text-left text-base ${PRESSABLE}`;

/**
 * Whether a set of options is short enough to sit in one row: at most `count` of them, none with
 * a description, and every label at most `label` characters (code points, as the grammar counts).
 */
export function shortOptions(
  options: readonly A2uiOption[],
  count: number,
  label: number,
): boolean {
  return (
    options.length <= count &&
    options.every((option) => option.description === undefined && [...option.label].length <= label)
  );
}

/**
 * How many columns a text takes on screen, approximately: a CJK or fullwidth character two, any
 * other one. For a row that cannot wrap, where ten Chinese characters take twice the room ten
 * Latin letters do.
 */
export function displayWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    const wide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe4f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x20000 && code <= 0x3fffd);
    width += wide ? 2 : 1;
  }
  return width;
}

/**
 * A model's string as plain text, its backtick spans unwrapped: for a control that takes a string
 * label, where {@link InlineText} cannot draw the code.
 */
export function plainText(text: string): string {
  return text.replace(/`([^`\n]+)`/g, "$1");
}

/** An option's label with the mark of the one the model recommends after it. */
export function OptionLabel({ option, strings }: { option: A2uiOption; strings: A2uiStrings }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <InlineText text={option.label} />
      {option.recommended === true && (
        <Badge tone="info" size="sm">
          {strings.recommended}
        </Badge>
      )}
    </span>
  );
}

/**
 * What a block shows while its reply is still arriving: a quiet line in place of the block, so a
 * half-written fence is never parsed, and the block is drawn once, when the reply settles. It
 * takes the blocks' margin and box radius, so the settle swaps one box for another in place.
 */
export function A2uiPending({ label }: { label?: string }) {
  const strings = useUiStrings().a2ui;
  return (
    <div
      aria-busy="true"
      className="a2ui-block my-3 rounded-md border border-dashed border-line px-3 py-2 text-xs text-fg-muted"
    >
      {label ?? strings.composing}
    </div>
  );
}

/**
 * A block that cannot be drawn — it failed to parse, broke a rule of the catalog, or its renderer
 * threw: one line naming why, and the source the model wrote under it, so the reader still gets
 * every word of it. Never an empty box, never a crash.
 */
export function A2uiInvalid({
  language,
  source,
  reason,
}: {
  /** The fence's language, shown on the code block: `a2ui` or `mermaid`. */
  language: string;
  source: string;
  /** The first error, in one line. */
  reason: string;
}) {
  const strings = useUiStrings().a2ui;
  return (
    <div className="a2ui-block my-3" data-a2ui="invalid">
      <Notice tone="attention" variant="inline" glyph={ICONS.alertCircle}>
        {strings.cannotShow(reason)}
      </Notice>
      <CodeBlock language={language} code={source} />
    </div>
  );
}

/**
 * Where an arrow key moves the tab stop of a group of `count` controls, from `current`; null for
 * a key the group leaves alone. Both axes move, and the ends wrap, as in a radio group.
 */
export function rovingTarget(current: number, key: string, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowDown":
    case "ArrowRight":
      return (current + 1) % count;
    case "ArrowUp":
    case "ArrowLeft":
      return (current - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/** A reason in one line: the first line of a message, cut to a length a notice can hold. */
export function oneLine(message: string): string {
  const line = message.trim().split("\n", 1)[0] ?? "";
  return line.length > 200 ? `${line.slice(0, 199)}…` : line;
}
