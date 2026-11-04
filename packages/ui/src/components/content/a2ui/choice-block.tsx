/**
 * A choice: one question and its options, which the reader answers by picking. The options are
 * the package's option group (`ChoiceGroup`), so they read like the option groups elsewhere in
 * the app and follow the theme.
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
 * `allowOther` adds an "Other…" control that fills the composer with nothing, clearing what an
 * earlier pick put there, so the reader writes an answer of their own: the group's last entry in
 * the muted ink, led by a pen on a card, or a ghost button beside a multi-select's fill. The
 * option the model recommends carries a mark and holds a single-select's tab stop. A
 * multi-select's ticks are kept as a draft while it is the open question (draft.ts), so a reload
 * brings them back; a single pick has filled already and keeps nothing.
 *
 * Read-only (the default — an older reply, a Trace), the options stay on screen with every
 * control disabled and no fill button: the question is still part of the record. Once the reply
 * has been answered, the options the message that answered it names are picked (`answeredWith`,
 * core's `parseChoicePick`), so a reload still shows the pick; an answer the reader wrote
 * themselves, or any other message, picks nothing.
 */
import { useId, useMemo, useState } from "react";
import { choiceFillText, parseChoicePick } from "@prismshadow/penguin-core/a2ui";
import type { A2uiChoice, A2uiOption } from "@prismshadow/penguin-core/a2ui";
import { ICON_SIZE } from "../../../icon-scale";
import { useUiStrings } from "../../../strings";
import type { A2uiStrings } from "../../../strings";
import { Button } from "../../actions/button/button";
import { ChoiceGroup } from "../../forms/choice-group/choice-group";
import type { ChoiceGroupOption } from "../../forms/choice-group/choice-group";
import { GlyphIcon } from "../../icons/glyph-icon/glyph-icon";
import { ICONS } from "../../icons/icons";
import { useA2uiActions } from "./actions";
import type { A2uiActions } from "./actions";
import { useA2uiDraft } from "./draft";
import { A2UI_TITLE, InlineText, OptionLabel, shortOptions } from "./parts";

/** The text a pick of these options fills: the grammar's own wording, in the reply's language. */
function fillFor(spec: A2uiChoice, options: readonly A2uiOption[], lang: A2uiActions["lang"]) {
  return choiceFillText(
    spec,
    options.map((option) => option.label),
    lang,
  );
}

/** A multi-select's draft: the ticked labels, or null when none is. */
function persistPicks(picked: readonly string[]): string[] | null {
  return picked.length > 0 ? [...picked] : null;
}

/** A saved draft's labels that the choice still offers, in its order; anything else ticks nothing. */
function restorePicks(spec: A2uiChoice, saved: unknown): readonly string[] {
  if (!Array.isArray(saved)) return [];
  return spec.options.map((option) => option.label).filter((label) => saved.includes(label));
}

/**
 * The labels the message that answered the reply picked, or null to show the picks as they
 * stand: the block is the open question, no message answered it, or the message is not a pick.
 */
function useAnsweredPicks(spec: A2uiChoice, actions: A2uiActions): readonly string[] | null {
  const { interactive, answeredWith } = actions;
  return useMemo(
    () => (interactive || answeredWith === undefined ? null : parseChoicePick(spec, answeredWith)),
    [spec, interactive, answeredWith],
  );
}

/** A single-select whose options fit one row of chips: four at most, short, none described. */
function compactChoice(spec: A2uiChoice): boolean {
  return shortOptions(spec.options, 4, 20);
}

/** An option as the group draws it: its label with the recommended mark, its description under it. */
function groupOption(option: A2uiOption, value: string, strings: A2uiStrings): ChoiceGroupOption {
  return {
    value,
    label: <OptionLabel option={option} strings={strings} />,
    ...(option.description !== undefined
      ? { description: <InlineText text={option.description} /> }
      : {}),
  };
}

/**
 * The value of a single-select's "Other…" entry. The options go by their place in the list, so no
 * label the model writes can be mistaken for it.
 */
const OTHER = "other";

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
  const [picked, setPicked] = useState<string | null>(null);
  const answered = useAnsweredPicks(spec, actions);
  // The options go by their place in the list (see OTHER); a single choice's answer is one.
  const shown =
    answered === null
      ? picked
      : String(spec.options.findIndex((option) => option.label === answered[0]));
  const recommended = spec.options.findIndex((option) => option.recommended === true);
  const options = spec.options.map((option, i) => groupOption(option, String(i), strings));
  if (spec.allowOther === true) {
    options.push({
      value: OTHER,
      label: strings.other,
      // A pen in the disc's place: this one is written, not picked.
      lead: <GlyphIcon d={ICONS.penLine} size={ICON_SIZE.rowLead} />,
      muted: true,
    });
  }
  return (
    <ChoiceGroup
      shape={compactChoice(spec) ? "chip" : "card"}
      size="base"
      options={options}
      value={shown}
      onChange={(value) => {
        const option = spec.options[Number(value)];
        if (value === OTHER || option === undefined) {
          // The reader's own words replace the pick, in the composer and on the disc.
          setPicked(null);
          actions.fill("");
          return;
        }
        setPicked(value);
        actions.fill(fillFor(spec, [option], actions.lang));
      }}
      // The group's one tab stop rests on the recommended option, where a reader would start.
      {...(recommended >= 0 ? { initialStop: String(recommended) } : {})}
      disabled={!actions.interactive}
      aria-labelledby={questionId}
    />
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
  const [picked, setPicked] = useA2uiDraft<readonly string[]>(
    (saved) => restorePicks(spec, saved),
    persistPicks,
  );
  const answered = useAnsweredPicks(spec, actions);
  return (
    <div className="min-w-0">
      <ChoiceGroup
        shape="card"
        multiple
        options={spec.options.map((option) => groupOption(option, option.label, strings))}
        value={answered ?? picked}
        onChange={(labels) => setPicked(() => labels)}
        disabled={!actions.interactive}
        aria-labelledby={questionId}
      />
      {actions.interactive && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            disabled={picked.length === 0}
            onClick={() => {
              const chosen = spec.options.filter((option) => picked.includes(option.label));
              actions.fill(fillFor(spec, chosen, actions.lang));
            }}
          >
            {strings.fill}
          </Button>
          {spec.allowOther === true && (
            <Button variant="ghost" size="sm" onClick={() => actions.fill("")}>
              {strings.other}
            </Button>
          )}
        </div>
      )}
    </div>
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
