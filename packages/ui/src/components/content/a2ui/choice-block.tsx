/**
 * A choice: one question and its options, which the reader answers by picking.
 *
 * A single-select choice acts on the pick: pressing an option puts its text in the composer at
 * once, so its options are buttons, not radios — a radio's arrow keys would fill the composer on
 * every step through the list. They keep a radio group's keyboard all the same: the group is one
 * tab stop, the arrow keys (and Home / End) move between options, Enter or Space picks. A
 * multi-select choice collects its picks in real checkboxes and fills them with one button.
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
import { useUiStrings } from "../../../strings";
import type { A2uiStrings } from "../../../strings";
import { Button } from "../../actions/button/button";
import { Checkbox } from "../../forms/checkbox/checkbox";
import { useA2uiActions } from "./actions";
import type { A2uiActions } from "./actions";
import { InlineText, OptionLabel, rovingTarget } from "./parts";

/** The text a pick of these options fills: the grammar's own wording, in the reply's language. */
function fillFor(spec: A2uiChoice, options: readonly A2uiOption[], lang: A2uiActions["lang"]) {
  return choiceFillText(
    spec,
    options.map((option) => option.label),
    lang,
  );
}

/**
 * An option row: a button at the reading text's size, its description under the label, the
 * picked one ringed in the accent. A closed question dims its rows the way a disabled checkbox
 * dims, so a reply's old question reads as answered rather than waiting.
 */
const OPTION_ROW =
  "flex w-full flex-col items-start gap-1 rounded-control border border-line bg-surface " +
  "px-3 py-2 text-left text-base transition-colors duration-150 " +
  "enabled:hover:bg-surface-muted aria-pressed:border-accent " +
  "disabled:cursor-not-allowed disabled:opacity-60 " +
  "focus-visible:[outline:var(--ui-focus-ring)] " +
  "focus-visible:[outline-offset:var(--ui-focus-ring-offset)]";

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
      className="mt-2 flex flex-col gap-2"
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
          className={`${OPTION_ROW} text-fg`}
        >
          <OptionLabel option={option} strings={strings} />
          {option.description !== undefined && (
            <span className="text-sm text-fg-muted">
              <InlineText text={option.description} />
            </span>
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
          className={`${OPTION_ROW} text-fg-muted`}
        >
          {strings.other}
        </button>
      )}
    </div>
  );
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
    <fieldset aria-labelledby={questionId} disabled={disabled} className="mt-2 min-w-0">
      <div className="flex flex-col gap-2">
        {spec.options.map((option, i) => (
          <Checkbox
            key={option.label}
            checked={picked.has(i)}
            onChange={(on) => toggle(i, on)}
            label={<OptionLabel option={option} strings={strings} />}
            hint={
              option.description !== undefined ? (
                <InlineText text={option.description} />
              ) : undefined
            }
            size="base"
            disabled={disabled}
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
      <div id={questionId} className="font-medium text-fg">
        <InlineText text={spec.question} />
      </div>
      <Options spec={spec} questionId={questionId} actions={actions} strings={strings} />
    </div>
  );
}
