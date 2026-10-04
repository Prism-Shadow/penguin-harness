/**
 * A form: a few questions answered together, then filled into the composer as one message, a line
 * per answered field.
 *
 * Every control is the package's own — the ones the settings pages use — so the keyboard is the
 * browser's. A single-answer field with a few short options is a segmented control, and one with
 * longer options, or options that carry a description, a radio group. A multi-answer field with a
 * few short options is a row of toggle chips, otherwise a column of checkboxes. A text field is an
 * input, and a number field a number input with the field's range under it and its unit inside the
 * box, plus a minus and a plus that step it (number-field.tsx). Required fields carry the red
 * mark, and the fill button stays disabled until each has an answer and every number is in range.
 * Enter in a text or number field fills, as a form submits.
 *
 * Read-only, the fields show with every control disabled and no fill button.
 */
import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { formFillText } from "@prismshadow/penguin-core/a2ui";
import type { A2uiForm, A2uiFormField, A2uiOption } from "@prismshadow/penguin-core/a2ui";
import { useUiStrings } from "../../../strings";
import type { A2uiStrings } from "../../../strings";
import { Button } from "../../actions/button/button";
import { Badge } from "../../feedback/badge/badge";
import { Checkbox } from "../../forms/checkbox/checkbox";
import { RequiredMark } from "../../forms/field/field";
import { Input } from "../../forms/input/input";
import { RadioGroup } from "../../forms/radio/radio";
import { Segmented } from "../../forms/segmented/segmented";
import { useA2uiActions } from "./actions";
import { filledAnswers, formReady } from "./form-answers";
import type { A2uiFormAnswer, A2uiFormAnswers } from "./form-answers";
import { NumberField } from "./number-field";
import {
  A2UI_CHIP,
  A2UI_TITLE,
  InlineText,
  OptionLabel,
  displayWidth,
  plainText,
  pressLook,
  shortOptions,
} from "./parts";

/** A field's title with the required mark: an option group's legend. */
function LegendText({ field }: { field: A2uiFormField }): ReactNode {
  return (
    <>
      <InlineText text={field.label} />
      {field.required === true && <RequiredMark />}
    </>
  );
}

/** The legend look RadioGroup gives its question, for the other option groups beside it. */
const LEGEND = "mb-1 text-xs font-semibold text-fg-muted";

/**
 * A single-answer field as a segmented control: four options at most, short and undescribed, and
 * narrow enough together for one row — a segment never wraps its label, so the options' combined
 * width (a CJK character counting two) is held to what a phone-width reply fits.
 */
function segmented(options: readonly A2uiOption[]): boolean {
  const width = options.reduce((sum, option) => sum + displayWidth(option.label), 0);
  return shortOptions(options, 4, 16) && width <= 32;
}

/** A multi-answer field as toggle chips: five options at most, short and undescribed. */
function chips(options: readonly A2uiOption[]): boolean {
  return shortOptions(options, 5, 16);
}

/** The labels `picked` holds once `label` is turned on or off, in the options' own order. */
function toggled(
  options: readonly A2uiOption[],
  picked: ReadonlySet<string>,
  label: string,
  on: boolean,
): string[] {
  return options
    .map((option) => option.label)
    .filter((each) => (each === label ? on : picked.has(each)));
}

function FormField({
  field,
  answer,
  onChange,
  disabled,
  strings,
}: {
  field: A2uiFormField;
  answer: A2uiFormAnswer | undefined;
  onChange: (answer: A2uiFormAnswer) => void;
  disabled: boolean;
  strings: A2uiStrings;
}) {
  const options = field.options ?? [];
  switch (field.kind) {
    case "single":
      if (segmented(options)) {
        // The fieldset names the group and, read-only, disables every segment in it; the well
        // dims as the other read-only controls do.
        return (
          <fieldset disabled={disabled} className="min-w-0">
            <legend className={LEGEND}>
              <LegendText field={field} />
            </legend>
            <div className={disabled ? "cursor-not-allowed opacity-60" : undefined}>
              <Segmented
                options={options.map((option) => ({
                  value: option.label,
                  label: plainText(option.label),
                  ...(option.recommended === true
                    ? {
                        badge: {
                          node: (
                            <Badge tone="info" size="sm">
                              {strings.recommended}
                            </Badge>
                          ),
                          name: strings.recommended,
                        },
                      }
                    : {}),
                }))}
                value={typeof answer === "string" ? answer : ""}
                onChange={onChange}
                cols={options.length as 2 | 3 | 4}
              />
            </div>
          </fieldset>
        );
      }
      return (
        <RadioGroup
          label={<LegendText field={field} />}
          options={options.map((option) => ({
            value: option.label,
            label: <OptionLabel option={option} strings={strings} />,
            hint:
              option.description !== undefined ? (
                <InlineText text={option.description} />
              ) : undefined,
          }))}
          value={typeof answer === "string" ? answer : ""}
          onChange={onChange}
          size="sm"
          disabled={disabled}
        />
      );
    case "multiple": {
      const picked = new Set<string>(typeof answer === "string" ? [] : (answer ?? []));
      return (
        <fieldset disabled={disabled} className="min-w-0">
          <legend className={LEGEND}>
            <LegendText field={field} />
          </legend>
          {chips(options) ? (
            <div className="flex flex-wrap gap-2">
              {options.map((option) => (
                <button
                  key={option.label}
                  type="button"
                  aria-pressed={picked.has(option.label)}
                  disabled={disabled}
                  // Kept in the options' order, whatever order they were pressed in.
                  onClick={() =>
                    onChange(toggled(options, picked, option.label, !picked.has(option.label)))
                  }
                  className={`${A2UI_CHIP.sm} ${pressLook(picked.has(option.label))} text-fg`}
                >
                  <OptionLabel option={option} strings={strings} />
                </button>
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {options.map((option) => (
                <Checkbox
                  key={option.label}
                  checked={picked.has(option.label)}
                  onChange={(on) => onChange(toggled(options, picked, option.label, on))}
                  label={<OptionLabel option={option} strings={strings} />}
                  hint={
                    option.description !== undefined ? (
                      <InlineText text={option.description} />
                    ) : undefined
                  }
                  size="sm"
                  disabled={disabled}
                />
              ))}
            </div>
          )}
        </fieldset>
      );
    }
    case "number":
      return (
        <NumberField
          field={field}
          value={typeof answer === "string" ? answer : ""}
          onChange={onChange}
          disabled={disabled}
          strings={strings}
        />
      );
    default:
      return (
        <Input
          label={field.label}
          required={field.required}
          placeholder={field.placeholder}
          value={typeof answer === "string" ? answer : ""}
          onChange={(event) => onChange(event.target.value)}
          size="sm"
          disabled={disabled}
        />
      );
  }
}

export function FormBlock({ spec }: { spec: A2uiForm }) {
  const actions = useA2uiActions();
  const strings = useUiStrings().a2ui;
  const [answers, setAnswers] = useState<A2uiFormAnswers>({});
  const disabled = !actions.interactive;
  const ready = actions.interactive && formReady(spec, answers);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!ready) return;
    actions.fill(formFillText(spec, filledAnswers(spec, answers), actions.lang));
  };

  return (
    <form className="a2ui-block my-3" data-a2ui="form" onSubmit={submit}>
      {spec.title !== undefined && (
        <div className={A2UI_TITLE}>
          <InlineText text={spec.title} />
        </div>
      )}
      <div className="flex flex-col gap-3">
        {spec.fields.map((field) => (
          <FormField
            key={field.id}
            field={field}
            answer={answers[field.id]}
            onChange={(answer) => setAnswers((current) => ({ ...current, [field.id]: answer }))}
            disabled={disabled}
            strings={strings}
          />
        ))}
      </div>
      {actions.interactive && (
        <div className="mt-3">
          <Button type="submit" variant="primary" size="sm" disabled={!ready}>
            {spec.submitLabel ?? strings.fill}
          </Button>
        </div>
      )}
    </form>
  );
}
