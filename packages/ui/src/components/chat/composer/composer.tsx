/**
 * The composer's pieces: the card a message is written in, the chips staged above its text, the
 * one action button, and the slash list with the pickers a slash command opens. The toolbar's
 * triggers are `ToolbarTrigger` (toolbar-trigger.tsx) and the pickers behind them `MenuSelect`.
 *
 * - `ComposerCard` is one bordered card: the staged images and files (`AttachmentList`), the chip
 *   row, then the text body — a textarea that grows with what is typed, up to about six lines,
 *   then scrolls — then a single toolbar row that never
 *   shares a line with the text. The toolbar's left group (a tight cluster of icon triggers, then a
 *   muted hint) is the part allowed to give way: it scrolls sideways on a narrow card, so the right
 *   group (status, model, the action button) always stays on screen. While a mode runs inside the
 *   composer (dictation), the caller's `strip` stands in for the left group — the tools and the
 *   hint give way to it — and the right group is untouched, so the action button never moves.
 *   The card is a size container, so the toolbar collapses by the card's own width rather than the
 *   viewport's; it takes the theme's input focus ring while anything inside it has focus, and
 *   carries the glass hook of the layer floating over the conversation.
 * - The card's `cover` stands on the card's own face in place of the editor while the editor
 *   cannot be used (the conversation's machine is out of reach): the editor stays mounted and
 *   keeps its place in the layout, laid out but not drawn, so the card neither changes size nor
 *   loses what was typed, staged or selected, and the cover's words take the card's own surface,
 *   border and corners in every theme. The card is as tall as the taller of the two, which is the
 *   editor at any common width. A cover that comes while the editor has focus takes it to its
 *   first control, and gives it back to the text body when it goes. The slot is a polite live
 *   region present from the first paint, so a cover is announced when it comes and its words when
 *   they change. `ComposerCover` lays the words out: a title, the live status row, a muted note.
 * - `ComposerBanner` is a notice that belongs to the composer (no model to send with yet), drawn
 *   as the card's top band through `ComposerCard`'s `banner`: inside the card's border and
 *   attached to its top edge, so it reads as part of the input box rather than as a card of its
 *   own. The tone tints the band; its action closes the row and wraps under the words on a
 *   narrow card.
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
import { useLayoutEffect, useRef } from "react";
import type { FocusEvent, ReactNode, Ref, RefObject, TextareaHTMLAttributes } from "react";
import { Button } from "../../actions/button/button";
import { FOCUSABLE_SELECTOR } from "../../overlays/esc-layers/esc-layers";
import {
  NOTICE_TONE,
  NOTICE_TONE_CLASS,
  type NoticeStripTone,
} from "../../feedback/notice/notice-strip";
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
  banner,
  attachments,
  chips,
  textarea,
  resizeHandle,
  tools,
  hint,
  strip,
  actions,
  cover,
}: {
  /** A notice drawn as the card's top band (`ComposerBanner`), above everything else. */
  banner?: ReactNode;
  /** The images and files staged for the message (`AttachmentList`), first in the card. */
  attachments?: ReactNode;
  /** The chip row above the text body (`ChipRow`); nothing is drawn when absent. */
  chips?: ReactNode;
  /** The text body: a controlled textarea, two lines high to begin with. */
  textarea: ComposerTextareaProps;
  /** A handle for a caller-sized text body. The toolbar stays below it. */
  resizeHandle?: ReactNode;
  /** The icon triggers leading the toolbar, set as one tight cluster. */
  tools?: ReactNode;
  /** A muted line after them (how to reach the slash commands), shown once the card is wide. */
  hint?: string;
  /** What stands in for the tools and the hint while a mode runs (a dictation's readout). */
  strip?: ReactNode;
  /** The right group: status, model and the action button; it never shrinks. */
  actions?: ReactNode;
  /**
   * What the card shows in place of the editor while the editor cannot be used
   * (`ComposerCover`); absent or null while it can. The editor stays mounted under it.
   */
  cover?: ReactNode;
}) {
  const { ref, ...text } = textarea;
  const covered = cover !== undefined && cover !== null && cover !== false;
  const editorRef = useRef<HTMLDivElement>(null);
  const coverRef = useRef<HTMLDivElement>(null);
  const coverFocus = useCoverFocus(covered, editorRef, coverRef);
  return (
    <div
      data-slot="composer"
      {...(covered ? { "data-covered": "" } : {})}
      className="ui-glass @container grid rounded-lg border border-line-emphasis bg-surface px-2.5 pb-2 pt-2 transition-[border-color,box-shadow] duration-200 focus-within:border-fg-muted focus-within:ring-2 focus-within:ring-fg-subtle/30"
    >
      {/* The editor and the cover share one cell, so the card keeps the editor's size under a
          cover; the editor is laid out but not drawn, which also takes it out of the Tab order
          and the accessibility tree. Corners inherited, so the banner's band keeps the card's. */}
      <div
        ref={editorRef}
        className={`col-start-1 row-start-1 min-w-0 rounded-[inherit] ${covered ? "invisible" : ""}`}
      >
        {banner !== undefined && banner !== null && banner !== false && (
          // Out to the card's border on three sides, clipped to its top corners whatever radius the
          // theme gives the card, and ruled off from the text below.
          <div className="-mx-2.5 -mt-2 mb-2 overflow-hidden rounded-t-[inherit] border-b border-line-muted">
            {banner}
          </div>
        )}
        {attachments !== undefined && attachments !== null && (
          <div className="mb-2">{attachments}</div>
        )}
        {chips}
        {/* The body rung rather than the form controls' small one: this is a typing surface for
          prose the user composes and re-reads, and the toolbar under it is the small rung. */}
        <textarea
          ref={ref}
          rows={2}
          {...text}
          className={`${resizeHandle ? "" : "max-h-44"} block min-h-[60px] w-full resize-none bg-transparent px-1 py-0.5 font-sans text-base leading-6 placeholder:text-fg-subtle focus:outline-none disabled:cursor-not-allowed disabled:opacity-60`}
        />
        {resizeHandle}
        <div className="mt-1 flex items-center justify-between gap-2 text-xs">
          <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
            {strip !== undefined && strip !== null ? (
              strip
            ) : (
              <>
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
              </>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        </div>
      </div>
      <div
        ref={coverRef}
        data-slot="cover"
        role="status"
        onFocus={coverFocus.onFocus}
        onBlur={coverFocus.onBlur}
        tabIndex={covered ? -1 : undefined}
        className={`col-start-1 row-start-1 flex min-w-0 items-center justify-center focus:outline-none ${covered ? "" : "pointer-events-none"}`}
      >
        {covered && cover}
      </div>
    </div>
  );
}

/**
 * Focus across a cover's coming and going. Focus in the editor when a cover comes moves to the
 * cover's first control (or the cover itself, when it offers none): the editor is no longer
 * drawn, and a hidden control drops focus to the page. While the cover holds focus, a control
 * removed as the words change hands focus to the cover's first one. Focus in the cover when it
 * goes returns to the text body. Focus anywhere else is never taken.
 */
function useCoverFocus(
  covered: boolean,
  editorRef: RefObject<HTMLDivElement | null>,
  coverRef: RefObject<HTMLDivElement | null>,
) {
  const was = useRef(covered);
  /** What in the cover has focus — or had it when it was removed, which is the cover's to mend. */
  const held = useRef<Element | null>(null);
  useLayoutEffect(() => {
    const cover = coverRef.current;
    const editor = editorRef.current;
    const active = document.activeElement;
    const lost = active === null || active === document.body || active === cover;
    const first = () =>
      cover?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ?? (covered ? cover : null);
    if (covered && !was.current) {
      if (editor !== null && active !== null && editor.contains(active)) first()?.focus();
    } else if (covered) {
      if (held.current !== null && !held.current.isConnected && lost) first()?.focus();
    } else if (was.current && held.current !== null && lost) {
      editor?.querySelector<HTMLElement>("textarea")?.focus();
    }
    if (!covered) held.current = null;
    was.current = covered;
  });
  return {
    onFocus: (event: FocusEvent<HTMLDivElement>) => {
      held.current = event.target;
    },
    onBlur: (event: FocusEvent<HTMLDivElement>) => {
      const left = event.target;
      // Settled after the commit that may be removing it: a control removed while it held focus
      // stays held for the commit to mend; focus the reader moved elsewhere is let go.
      queueMicrotask(() => {
        if (held.current !== left || !left.isConnected) return;
        if (coverRef.current?.contains(document.activeElement) !== true) held.current = null;
      });
    },
  };
}

/**
 * The words a composer's cover holds, centred on the card: a title saying what is happening, the
 * live status under it (the shared retry row, with its presses), and a muted note.
 */
export function ComposerCover({
  title,
  status,
  note,
}: {
  /** What is happening, in one line. */
  title: string;
  /** The live status and its presses: the shared retry row, or a row of text actions. */
  status?: ReactNode;
  /** A muted line under them; absent for none. */
  note?: string | null;
}) {
  return (
    <div className="flex max-w-full flex-col items-center gap-1 px-3 text-center text-sm">
      <p className="max-w-full text-balance break-words font-medium text-fg">{title}</p>
      {status}
      {note !== undefined && note !== null && (
        <p className="max-w-full text-balance break-words text-xs text-fg-muted">{note}</p>
      )}
    </div>
  );
}

/** A notice in the composer's top band: the tone's tint, the words, and an optional action. */
export function ComposerBanner({
  tone = "attention",
  action,
  children,
}: {
  tone?: NoticeStripTone;
  /** A button closing the row, in the accent. */
  action?: { label: string; onClick: () => void };
  children: ReactNode;
}) {
  return (
    <div
      data-slot="banner"
      data-tone={NOTICE_TONE[tone]}
      role="status"
      className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3 py-2 text-sm ${NOTICE_TONE_CLASS[tone]}`}
    >
      <span className="min-w-0">{children}</span>
      {action !== undefined && (
        <Button size="sm" variant="primary" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}

/** The chip row above the composer's text body. */
export function ChipRow(props: Omit<Parameters<typeof TagInput>[0], "className">) {
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

/** Slash command choices. The highlighted command follows keyboard navigation into view. */
export function SlashMenuRows({
  items,
  active,
  onActiveChange,
  onRun,
}: {
  items: readonly SlashMenuItem[];
  /** The highlighted row's index. */
  active: number;
  /** The pointer moved onto a row. */
  onActiveChange: (index: number) => void;
  /** A row was pressed. */
  onRun: (index: number) => void;
}) {
  return items.map((item, i) => (
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
  ));
}

/** Draw the rows above an unclipped composer, within the height available there. */
export function SlashMenu({
  maxHeight,
  ...rows
}: Parameters<typeof SlashMenuRows>[0] & { maxHeight?: number }) {
  return (
    <div
      style={{ maxHeight }}
      className={`ui-glass ${menuPanelClass} absolute bottom-full left-0 z-menu mb-1.5 w-80 max-w-[calc(100vw-2rem)] overscroll-contain`}
    >
      <SlashMenuRows {...rows} />
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
      className="anim-pop absolute bottom-full left-0 z-menu mb-1.5 flex w-80 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-md border border-line bg-overlay py-1 shadow-lg"
    >
      <MenuTitle>{title}</MenuTitle>
      {children}
    </div>
  );
}
