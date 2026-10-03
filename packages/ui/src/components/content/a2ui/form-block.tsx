/**
 * A form: a few questions answered together, then filled into the composer as one message, a line
 * per answered field.
 *
 * Every control is the package's own and a real input, so the keyboard is the browser's: a
 * single-answer field is a radio group (one tab stop, arrows move), a multi-answer field a column
 * of checkboxes, a text field an input, a number field a number input with the field's range and
 * step and its unit drawn inside the box. Required fields carry the red mark, and the fill button
 * stays disabled until each has an answer and every number is in range. Enter in a text or number
 * field fills, as a form submits.
 *
 * Read-only, the fields show with every control disabled and no fill button.
 */
import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { formFillText } from "@prismshadow/penguin-core/a2ui";
import type { A2uiForm, A2uiFormField } from "@prismshadow/penguin-core/a2ui";
import { useUiStrings } from "../../../strings";
import type { A2uiStrings } from "../../../strings";
import { Button } from "../../actions/button/button";
import { Checkbox } from "../../forms/checkbox/checkbox";
import { RequiredMark } from "../../forms/field/field";
import { Input } from "../../forms/input/input";
import { RadioGroup } from "../../forms/radio/radio";
import { useA2uiActions } from "./actions";
import { filledAnswers, formReady, numberOutOfRange } from "./form-answers";
import type { A2uiFormAnswer, A2uiFormAnswers } from "./form-answers";
import { InlineText, OptionLabel } from "./parts";

/** A field's title with the required mark: an option group's legend. */
function LegendText({ field }: { field: A2uiFormField }): ReactNode {
  return (
    <>
      <InlineText text={field.label} />
      {field.required === true && <RequiredMark />}
    </>
  );
}

/**
 * A number field's range in symbols every language reads ("1–10", "≥ 0"), under the box, so a
 * reader sees the limits before the fill button refuses a value outside them.
 */
function rangeHint(field: A2uiFormField): string | undefined {
  const { min, max } = field;
  if (min !== undefined && max !== undefined) return `${min}–${max}`;
  if (min !== undefined) return `≥ ${min}`;
  if (max !== undefined) return `≤ ${max}`;
  return undefined;
}

/** The legend look RadioGroup gives its question, for the checkbox column beside it. */
const LEGEND = "mb-1 text-xs font-semibold text-fg-muted";

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
          <div className="flex flex-col gap-2">
            {options.map((option) => (
              <Checkbox
                key={option.label}
                checked={picked.has(option.label)}
                // Kept in the options' order, whatever order they were ticked in.
                onChange={(on) =>
                  onChange(
                    options
                      .map((o) => o.label)
                      .filter((label) => (label === option.label ? on : picked.has(label))),
                  )
                }
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
        </fieldset>
      );
    }
    case "number":
      return (
        <Input
          type="number"
          inputMode="decimal"
          label={field.label}
          required={field.required}
          placeholder={field.placeholder}
          min={field.min}
          max={field.max}
          step={field.step}
          hint={rangeHint(field)}
          invalid={numberOutOfRange(field, answer)}
          affix={field.unit !== undefined ? { trailing: field.unit } : undefined}
          value={typeof answer === "string" ? answer : ""}
          onChange={(event) => onChange(event.target.value)}
          size="sm"
          disabled={disabled}
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
        <div className="mb-2 font-medium text-fg">
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
