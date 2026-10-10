/**
 * The composer's pieces: the card a message is written in, the chips staged above its text, the
 * one action button, and the slash list with the pickers a slash command opens. The toolbar's
 * triggers are `ToolbarTrigger` (toolbar-trigger.tsx) and the pickers behind them `MenuSelect`.
 *
 * - `ComposerCard` is one bordered card: the chip row, then the text body — a textarea that grows
 *   with what is typed, up to about six lines, then scrolls — then a single toolbar row that never
 *   shares a line with the text. The toolbar's left group (a tight cluster of icon triggers, then a
 *   muted hint) is the part allowed to give way: it scrolls sideways on a narrow card, so the right
 *   group (status, model, the action button) always stays on screen. The card is a size container,
 *   so the toolbar collapses by the card's own width rather than the viewport's; it takes the
 *   theme's input focus ring while anything inside it has focus, and carries the glass hook of the
 *   layer floating over the conversation.
 * - `ChipRow` is the row of chips above the text body (`TagInput` in the composer's place).
 * - `SendButton` is the action button: the accent square with the send arrow, or the stop square
 *   while a run can be stopped.
 * - `SlashMenu` is the list a `/` opens above the card: commands in the mono face, what each does
 *   muted after it, the keyboard's row highlighted and kept in view.
 * - `SlashPicker` is the titled panel a switch command opens in the same place, holding the
 *   caller's picker.
 *
 * The composer's behaviour — sending, slash matching, paste and drop, drafts — is the caller's;
 * these draw it.
 */
import type { ReactNode, Ref, TextareaHTMLAttributes } from "react";
import { GlyphIcon } from "../../icons/glyph-icon/glyph-icon";
import { ICONS } from "../../icons/icons";
import { menuPanelClass } from "../../overlays/menu-panel/menu-panel";
import { TagInput } from "../../forms/tag-input/tag-input";
import { MenuTitle } from "../menu-select/menu-select";

/** The text body's attributes: everything but its look and its starting height. */
export type ComposerTextareaProps = Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "className" | "rows"
> & { ref?: Ref<HTMLTextAreaElement> };

export function ComposerCard({
  chips,
  textarea,
  tools,
  hint,
  actions,
}: {
  /** The chip row above the text body (`ChipRow`); nothing is drawn when absent. */
  chips?: ReactNode;
  /** The text body: a controlled textarea, two lines high to begin with. */
  textarea: ComposerTextareaProps;
  /** The icon triggers leading the toolbar, set as one tight cluster. */
  tools?: ReactNode;
  /** A muted line after them (how to reach the slash commands), shown once the card is wide. */
  hint?: string;
  /** The right group: status, model and the action button; it never shrinks. */
  actions?: ReactNode;
}) {
  const { ref, ...text } = textarea;
  return (
    <div className="ui-glass @container rounded-lg border border-line-emphasis bg-surface px-2.5 pb-2 pt-2 transition-[border-color,box-shadow] duration-200 focus-within:border-fg-muted focus-within:ring-2 focus-within:ring-fg-subtle/30">
      {chips}
      {/* The body rung rather than the form controls' small one: this is a typing surface for
          prose the user composes and re-reads, and the toolbar under it is the small rung. */}
      <textarea
        ref={ref}
        rows={2}
        {...text}
        className="block max-h-44 min-h-[60px] w-full resize-none bg-transparent px-1 py-0.5 font-sans text-base leading-6 placeholder:text-fg-subtle focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
      />
      <div className="mt-1 flex items-center justify-between gap-2 text-xs">
        <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
          <div className="flex shrink-0 items-center gap-px">{tools}</div>
          {hint !== undefined && hint !== "" && (
            <span
              data-tooltip={hint}
              data-tooltip-content="text"
              className="hidden min-w-0 truncate text-fg-subtle @lg:block"
            >
              {hint}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      </div>
    </div>
  );
}

/** The chip row above the composer's text body. */
export function ChipRow(props: Omit<Parameters<typeof TagInput>[0], "variant" | "className">) {
  return <TagInput {...props} className="mb-1" />;
}

/**
 * The composer's one action button. `send` is the accent square with the up arrow, greyed while
 * there is nothing to send; `stop` is a neutral square holding the stop mark in the danger ink,
 * never disabled — a run can always be stopped.
 */
export function SendButton({
  action,
  label,
  disabled = false,
  onClick,
}: {
  action: "send" | "stop";
  /** The accessible name and tooltip: what pressing it does now (send, steer, queue, stop). */
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  const stop = action === "stop";
  return (
    <button
      type="button"
      data-tooltip={label}
      aria-label={label}
      disabled={stop ? false : disabled}
      onClick={onClick}
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors duration-150 ${
        stop
          ? "bg-fill-neutral text-tone-danger-fg hover:bg-tone-danger-bg"
          : "bg-accent text-accent-fg hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-line disabled:text-fg-subtle"
      }`}
    >
      {stop ? (
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden className="block">
          <rect x="2" y="2" width="10" height="10" rx="2" fill="currentColor" />
        </svg>
      ) : (
        // The send arrow on its filled button keeps a heavier line than the family's, whatever
        // the theme's weight: it is the one glyph the eye looks for in the composer.
        <GlyphIcon d={ICONS.arrowUp} size={17} className="[--ui-icon-stroke:2]" />
      )}
    </button>
  );
}

/** One command in the slash list. */
export interface SlashMenuItem {
  /** The command as typed, `/compact`. */
  command: string;
  /** What it does; a long one truncates, whole in its tooltip. */
  description: string;
}

/**
 * The slash list, opening upward from the composer's top edge. Its height is the caller's
 * measure of the room above (`maxHeight`), and the list scrolls inside it, so a long list never
 * runs off the top; the highlighted row keeps itself in view as the keyboard walks it.
 */
export function SlashMenu({
  items,
  active,
  onActiveChange,
  onRun,
  maxHeight,
}: {
  items: readonly SlashMenuItem[];
  /** The highlighted row's index. */
  active: number;
  /** The pointer moved onto a row. */
  onActiveChange: (index: number) => void;
  /** A row was pressed. */
  onRun: (index: number) => void;
  maxHeight?: number;
}) {
  return (
    <div
      style={{ maxHeight }}
      className={`ui-glass ${menuPanelClass} absolute bottom-full left-0 z-40 mb-1.5 w-80 max-w-[calc(100vw-2rem)] overscroll-contain`}
    >
      {items.map((item, i) => (
        <button
          key={item.command}
          type="button"
          ref={i === active ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
          onMouseEnter={() => onActiveChange(i)}
          onClick={() => onRun(i)}
          className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
            i === active ? "bg-line-muted" : ""
          }`}
        >
          <span className="shrink-0 font-mono text-fg">{item.command}</span>
          <span
            data-tooltip={item.description}
            data-tooltip-content="text"
            className="min-w-0 flex-1 truncate text-xs text-fg-muted"
          >
            {item.description}
          </span>
        </button>
      ))}
    </div>
  );
}

/**
 * The panel a switch command opens where the slash list was: a title bar naming the switch, then
 * the caller's picker. It has no trigger of its own, so dismissing it (a click outside, Escape) is
 * the caller's; `ref` is the panel, for that outside test.
 */
export function SlashPicker({
  title,
  maxHeight,
  ref,
  children,
}: {
  title: ReactNode;
  maxHeight?: number;
  ref?: Ref<HTMLDivElement>;
  children: ReactNode;
}) {
  return (
    <div
      ref={ref}
      style={{ maxHeight }}
      className="anim-pop absolute bottom-full left-0 z-40 mb-1.5 flex w-80 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-md border border-line bg-overlay py-1 shadow-lg"
    >
      <MenuTitle>{title}</MenuTitle>
      {children}
    </div>
  );
}
