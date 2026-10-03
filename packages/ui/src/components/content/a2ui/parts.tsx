/**
 * The pieces every A2UI block shares: the four tones and how each is drawn, the placeholder a
 * block shows while its reply is still streaming, the source-plus-notice a block falls back to
 * when it cannot be drawn, the inline text renderer for the strings a model writes, an option's
 * label, and the arrow-key walk of an option group.
 */
import type { ReactNode } from "react";
import type { A2uiOption } from "@prismshadow/penguin-core/a2ui";
import { ICONS } from "../../icons/icons";
import { Badge } from "../../feedback/badge/badge";
import { Notice } from "../../feedback/notice/notice";
import type { NoticeStripTone } from "../../feedback/notice/notice-strip";
import { useUiStrings } from "../../../strings";
import type { A2uiStrings } from "../../../strings";
import { CodeBlock } from "../code-block/code-block";
import "./a2ui.css";

/** A callout's tones, and the three notices a step may carry. */
export type A2uiTone = "note" | "tip" | "caution" | "warning";

/**
 * Each tone in the package's tone names, with its mark. A warning (irreversible loss, security,
 * harm) is the danger tone and a caution (something recoverable breaks) the attention one, so the
 * two never read as the same level. The tone's name is the `A2uiStrings` key of the same spelling.
 */
export const A2UI_TONE: Readonly<Record<A2uiTone, { tone: NoticeStripTone; glyph: string }>> = {
  note: { tone: "info", glyph: ICONS.info },
  tip: { tone: "success", glyph: ICONS.lightbulb },
  caution: { tone: "attention", glyph: ICONS.alertCircle },
  warning: { tone: "danger", glyph: ICONS.triangleAlert },
};

/** A tone's name in the interface's words. */
export function toneName(strings: A2uiStrings, tone: A2uiTone): string {
  return strings[tone];
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
 * half-written fence is never parsed, and the block is drawn once, when the reply settles.
 */
export function A2uiPending({ label }: { label?: string }) {
  const strings = useUiStrings().a2ui;
  return (
    <div
      aria-busy="true"
      className="a2ui-block my-2 rounded-lg border border-dashed border-line px-3 py-2 text-xs text-fg-muted"
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
    <div className="a2ui-block my-2" data-a2ui="invalid">
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
