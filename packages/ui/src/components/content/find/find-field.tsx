/**
 * FindField: the control row of a find bar — the query box, the "3/12" counter, previous and next,
 * an optional match-case toggle, and close. The Web App's page-wide find bar stands it at the top
 * of its panel; the Markdown reader opens it in its tool pill. What a hit is, where the hits are
 * and what close does are the caller's: this draws the row and turns its keys into steps.
 *
 * Keys in the box: Enter (and F3) steps forward, with Shift backward; with `arrowKeys`, ↓ and ↑ do
 * the same (the reader, whose box has no use for a caret jump to either end). Enter while an IME
 * is composing commits the composition and steps nowhere. Escape is the caller's, because what it
 * closes, and what it must keep from closing (a dialog around the reader), is the caller's.
 *
 * Pressing a control keeps the caret in the box, so Enter goes on stepping after a click. The
 * counter is a live region, so a screen reader hears the same "3/12" a sighted reader sees. The
 * match-case glyph is drawn text, so it sits in an `aria-hidden` span and the button keeps its
 * name in `aria-label`.
 */
import type { KeyboardEvent as ReactKeyboardEvent, Ref } from "react";
import { ICON_SIZE } from "../../../icon-scale";
import { GlyphIcon } from "../../icons/glyph-icon/glyph-icon";
import { ICONS } from "../../icons/icons";
import { CloseIcon } from "../../icons/marks/marks";

export interface FindFieldLabels {
  /** The box's placeholder, which is also its accessible name. */
  placeholder: string;
  previous: string;
  next: string;
  close: string;
  /** The match-case toggle's name; it is drawn only with `onCaseSensitiveChange`. */
  caseSensitive?: string;
}

/**
 * Tooltips that say more than a control's name: the fixed key that does the same ("Next (Enter)").
 * Previous and next fall back to their names; close has no tooltip without one.
 */
export interface FindFieldHints {
  previous?: string;
  next?: string;
  close?: string;
}

export interface FindFieldProps {
  query: string;
  onQueryChange: (value: string) => void;
  /** "3/12", the no-match word, or "" while the query is empty. */
  counter: string;
  /** There are hits to step through: previous and next are live. */
  canStep: boolean;
  /** One step: 1 forward, -1 back. */
  onStep: (delta: 1 | -1) => void;
  onClose: () => void;
  labels: FindFieldLabels;
  hints?: FindFieldHints;
  caseSensitive?: boolean;
  /** Draws the match-case toggle. */
  onCaseSensitiveChange?: (next: boolean) => void;
  /** ↓ and ↑ in the box step as well. */
  arrowKeys?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  className?: string;
}

/** The row's square controls: flat, the glyph deepening on hover. */
const ICON_BUTTON =
  "flex h-6 w-6 shrink-0 items-center justify-center rounded-sm transition-colors duration-150 disabled:cursor-not-allowed disabled:text-fg-subtle disabled:opacity-60";
/** Their ink at rest; an option that is on takes the accent instead. */
const ICON_INK = "text-fg-muted hover:text-fg";

/** Pressing a control keeps the caret in the query box, so Enter goes on stepping. */
const keepFocus = (e: { preventDefault: () => void }): void => e.preventDefault();

/** The step a key asks for in the box, or null for a key that is not a step. */
export function findStepForKey(
  key: string,
  shift: boolean,
  composing: boolean,
  arrowKeys: boolean,
): 1 | -1 | null {
  if (composing) return null;
  if (key === "Enter" || key === "F3") return shift ? -1 : 1;
  if (arrowKeys && key === "ArrowDown") return 1;
  if (arrowKeys && key === "ArrowUp") return -1;
  return null;
}

export function FindField({
  query,
  onQueryChange,
  counter,
  canStep,
  onStep,
  onClose,
  labels,
  hints = {},
  caseSensitive = false,
  onCaseSensitiveChange,
  arrowKeys = false,
  inputRef,
  className = "",
}: FindFieldProps) {
  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
    const step = findStepForKey(e.key, e.shiftKey, e.nativeEvent.isComposing, arrowKeys);
    if (step === null) return;
    e.preventDefault();
    onStep(step);
  };

  return (
    <div className={`flex min-w-0 items-center gap-1 ${className}`}>
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={labels.placeholder}
        aria-label={labels.placeholder}
        autoComplete="off"
        spellCheck={false}
        className="min-w-0 flex-1 bg-transparent px-1 text-sm text-fg outline-none placeholder:text-fg-subtle"
      />
      <span aria-live="polite" className="shrink-0 px-1 text-xs tabular-nums text-fg-muted">
        {counter}
      </span>
      <button
        type="button"
        onMouseDown={keepFocus}
        onClick={() => onStep(-1)}
        disabled={!canStep}
        aria-label={labels.previous}
        data-tooltip={hints.previous ?? labels.previous}
        className={`${ICON_BUTTON} ${ICON_INK}`}
      >
        <GlyphIcon d={ICONS.chevronUp} size={ICON_SIZE.iconButton} />
      </button>
      <button
        type="button"
        onMouseDown={keepFocus}
        onClick={() => onStep(1)}
        disabled={!canStep}
        aria-label={labels.next}
        data-tooltip={hints.next ?? labels.next}
        className={`${ICON_BUTTON} ${ICON_INK}`}
      >
        <GlyphIcon d={ICONS.chevronDown} size={ICON_SIZE.iconButton} />
      </button>
      {onCaseSensitiveChange !== undefined && (
        <button
          type="button"
          onMouseDown={keepFocus}
          onClick={() => onCaseSensitiveChange(!caseSensitive)}
          aria-pressed={caseSensitive}
          aria-label={labels.caseSensitive}
          data-tooltip={labels.caseSensitive}
          className={`${ICON_BUTTON} text-xs font-semibold ${caseSensitive ? "text-accent" : ICON_INK}`}
        >
          <span aria-hidden>Aa</span>
        </button>
      )}
      {/* A close cross beside what it closes needs no hint of its own; one that names its key
          says something the glyph cannot. */}
      <button
        type="button"
        onClick={onClose}
        aria-label={labels.close}
        data-tooltip={hints.close}
        className={`${ICON_BUTTON} ${ICON_INK}`}
      >
        <CloseIcon size={14} />
      </button>
    </div>
  );
}
