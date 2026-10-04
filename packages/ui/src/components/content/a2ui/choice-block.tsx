/**
 * A choice: one question and its options, which the reader answers by picking.
 *
 * A single-select choice acts on the pick: pressing an option puts its text in the composer at
 * once, so its options are buttons, not radios — a radio's arrow keys would fill the composer on
 * every step through the list. They keep a radio group's keyboard all the same: the group is one
 * tab stop, the arrow keys (and Home / End) move between options, Enter or Space picks. A
 * multi-select choice collects its picks in real checkboxes and fills them with one button.
 *
 * The options decide the layout. A few short ones — four at most, no description, labels of
 * twenty characters or fewer — sit in one wrapping row of chips, so "Yes / Later / No" reads as
 * one line. Anything longer is a column of cards, each led by a radio's disc that fills on the
 * pick, so a single-select reads as one. A multi-select is a column of the same cards around its
 * checkboxes.
 *
 * `allowOther` adds an "Other…" control that fills nothing and moves focus to the composer, where
 * the reader writes an answer of their own. The option the model recommends carries a mark.
 *
 * Read-only (the default — an older reply, a Trace), the options stay on screen with every
 * control disabled and no fill button: the question is still part of the record.
 */
import { useId, useState } from "react";
import type { KeyboardEvent } from "react";
import { choiceFillText } from "@prismshadow/penguin-core/a2ui";
import type { A2uiChoice, A2uiOption } from "@prismshadow/penguin-core/a2ui";
import { ICON_SIZE } from "../../../icon-scale";
import { useUiStrings } from "../../../strings";
import type { A2uiStrings } from "../../../strings";
import { Button } from "../../actions/button/button";
import { Checkbox } from "../../forms/checkbox/checkbox";
import { GlyphIcon } from "../../icons/glyph-icon/glyph-icon";
import { ICONS } from "../../icons/icons";
import { useA2uiActions } from "./actions";
import type { A2uiActions } from "./actions";
import {
  A2UI_CARD,
  A2UI_CHIP,
  A2UI_TITLE,
  InlineText,
  OptionLabel,
  pressLook,
  rovingTarget,
  shortOptions,
} from "./parts";

/** The text a pick of these options fills: the grammar's own wording, in the reply's language. */
function fillFor(spec: A2uiChoice, options: readonly A2uiOption[], lang: A2uiActions["lang"]) {
  return choiceFillText(
    spec,
    options.map((option) => option.label),
    lang,
  );
}

/** A single-select whose options fit one row of chips: four at most, short, none described. */
function compactChoice(spec: A2uiChoice): boolean {
  return shortOptions(spec.options, 4, 20);
}

/**
 * The radio's disc at the head of a card, one line tall so it centres on the label's first line:
 * a ring at rest, the accent with a dot in it once picked — the drawing `Radio` uses, so the card
 * reads as one option of a single-select. Decorative: the button's pressed state says it.
 */
function OptionDisc({ on }: { on: boolean }) {
  return (
    <span aria-hidden className="flex h-[1lh] items-center">
      <span
        className={`relative size-3.5 shrink-0 rounded-full border transition-colors duration-150 ${
          on ? "border-accent bg-accent" : "border-line-emphasis bg-surface"
        }`}
      >
        {on && <span className="absolute inset-0 m-auto size-1.5 rounded-full bg-accent-fg" />}
      </span>
    </span>
  );
}

/** A card's description under its label, a rung down in the muted ink. */
function OptionText({ option, strings }: { option: A2uiOption; strings: A2uiStrings }) {
  return (
    <span className="flex min-w-0 flex-col gap-1">
      <OptionLabel option={option} strings={strings} />
      {option.description !== undefined && (
        <span className="text-sm text-fg-muted">
          <InlineText text={option.description} />
        </span>
      )}
    </span>
  );
}

function SingleChoice({
  spec,
  questionId,
  actions,
  strings,
}: {
  spec: A2uiChoice;
  questionId: string;
  actions: A2uiActions;
  strings: A2uiStrings;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  // The group's one tab stop: the recommended option first, as the place a reader would start.
  const [stop, setStop] = useState(() =>
    Math.max(
      0,
      spec.options.findIndex((option) => option.recommended === true),
    ),
  );
  const disabled = !actions.interactive;
  const compact = compactChoice(spec);
  const shape = compact ? A2UI_CHIP.base : A2UI_CARD;
  const count = spec.options.length + (spec.allowOther === true ? 1 : 0);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = rovingTarget(stop, event.key, count);
    if (next === null) return;
    event.preventDefault();
    setStop(next);
    event.currentTarget.querySelectorAll<HTMLButtonElement>("[data-option]")[next]?.focus();
  };

  return (
    <div
      role="group"
      aria-labelledby={questionId}
      className={compact ? "flex flex-wrap gap-2" : "flex flex-col gap-2"}
      onKeyDown={disabled ? undefined : onKeyDown}
    >
      {spec.options.map((option, i) => (
        <button
          key={option.label}
          type="button"
          data-option=""
          tabIndex={i === stop ? 0 : -1}
          disabled={disabled}
          aria-pressed={picked === i}
          onFocus={() => setStop(i)}
          onClick={() => {
            setPicked(i);
            actions.fill(fillFor(spec, [option], actions.lang));
          }}
          className={`${shape} ${pressLook(picked === i)} text-fg`}
        >
          {compact ? (
            <OptionLabel option={option} strings={strings} />
          ) : (
            <>
              <OptionDisc on={picked === i} />
              <OptionText option={option} strings={strings} />
            </>
          )}
        </button>
      ))}
      {spec.allowOther === true && (
        <button
          type="button"
          data-option=""
          tabIndex={stop === spec.options.length ? 0 : -1}
          disabled={disabled}
          onFocus={() => setStop(spec.options.length)}
          onClick={() => actions.focus?.()}
          className={`${shape} ${pressLook(false)} text-fg-muted`}
        >
          {compact ? (
            strings.other
          ) : (
            <>
              {/* A pen in the disc's place: this one is written, not picked. As wide as the
                  disc, so "Other…" lines up with the labels above it. */}
              <span aria-hidden className="flex h-[1lh] w-3.5 items-center justify-center">
                <GlyphIcon d={ICONS.penLine} size={ICON_SIZE.rowLead} />
              </span>
              <span>{strings.other}</span>
            </>
          )}
        </button>
      )}
    </div>
  );
}

/**
 * A multi-select option's card: the checkbox's own `<label>` drawn in the card's shape, so the
 * whole card toggles and the native box keeps the keyboard; ticked, it takes the selected look
 * of {@link pressLook}. A label has no enabled state for an `enabled:` variant to read, so the
 * hover is left out while the question is closed.
 */
function rowClass(checked: boolean, disabled: boolean): string {
  const look = checked
    ? "border-accent bg-accent-muted"
    : disabled
      ? "border-line bg-surface"
      : "border-line bg-surface hover:border-line-emphasis hover:bg-surface-muted";
  return `w-full rounded-md border px-3 py-2 transition-colors duration-150 ${look}`;
}

function MultiChoice({
  spec,
  questionId,
  actions,
  strings,
}: {
  spec: A2uiChoice;
  questionId: string;
  actions: A2uiActions;
  strings: A2uiStrings;
}) {
  const [picked, setPicked] = useState<ReadonlySet<number>>(() => new Set());
  const disabled = !actions.interactive;
  const toggle = (i: number, on: boolean) =>
    setPicked((current) => {
      const next = new Set(current);
      if (on) next.add(i);
      else next.delete(i);
      return next;
    });

  return (
    <fieldset aria-labelledby={questionId} disabled={disabled} className="min-w-0">
      <div className="flex flex-col gap-2">
        {spec.options.map((option, i) => (
          <Checkbox
            key={option.label}
            checked={picked.has(i)}
            onChange={(on) => toggle(i, on)}
            label={<OptionLabel option={option} strings={strings} />}
            hint={
              option.description !== undefined ? (
                <span className="mt-1 block text-sm">
                  <InlineText text={option.description} />
                </span>
              ) : undefined
            }
            size="base"
            disabled={disabled}
            className={rowClass(picked.has(i), disabled)}
          />
        ))}
      </div>
      {actions.interactive && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            disabled={picked.size === 0}
            onClick={() => {
              const chosen = spec.options.filter((_, i) => picked.has(i));
              actions.fill(fillFor(spec, chosen, actions.lang));
            }}
          >
            {strings.fill}
          </Button>
          {spec.allowOther === true && (
            <Button variant="ghost" size="sm" onClick={() => actions.focus?.()}>
              {strings.other}
            </Button>
          )}
        </div>
      )}
    </fieldset>
  );
}

export function ChoiceBlock({ spec }: { spec: A2uiChoice }) {
  const actions = useA2uiActions();
  const strings = useUiStrings().a2ui;
  const questionId = useId();
  const Options = spec.multiple === true ? MultiChoice : SingleChoice;
  return (
    <div className="a2ui-block my-3" data-a2ui="choice">
      <div id={questionId} className={A2UI_TITLE}>
        <InlineText text={spec.question} />
      </div>
      <Options spec={spec} questionId={questionId} actions={actions} strings={strings} />
    </div>
  );
}
