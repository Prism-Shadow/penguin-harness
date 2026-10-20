/**
 * A form's fields, one control per kind, every one the package's own — the controls the settings
 * pages use — so the keyboard is the browser's and each theme draws them as it draws its settings:
 *
 * - text: an input, capped at the field's length; textarea: three lines, where Mod+Enter fills;
 * - number: the number input, its unit inside the box, a stepper beside it and the range under it;
 * - slider: the slider with its figure (and unit) read out beside it;
 * - single: a segmented control when a few short options fit one row, else a radio group;
 * - multiple: a row of toggle chips when a few short options fit, else a column of checkboxes;
 * - select: a dropdown whose first row is the empty answer;
 * - switch: the switch at the end of a row whose title is set as every other field's, which changes
 *   the form's answer and nothing else until the fill;
 * - date, time, datetime: the input with the browser's own picker.
 *
 * Each control shows the model's hint under it. While its answer breaks the field's rule the
 * control takes the danger line and the line under it turns into the error: the model's hint, else
 * the rule in symbols ("1–10", "YYYY-MM-DD"), else a plain "not valid". A required field left
 * empty shows no error: its asterisk and the disabled fill button say it.
 */
import { useId } from "react";
import type { KeyboardEvent, ReactElement, ReactNode } from "react";
import { A2UI_LIMITS } from "@prismshadow/penguin-core/a2ui";
import type {
  A2uiFieldKind,
  A2uiFieldProblem,
  A2uiFormAnswer,
  A2uiFormField,
  A2uiOption,
} from "@prismshadow/penguin-core/a2ui";
import type { A2uiStrings } from "../../../strings";
import { Pill } from "../../feedback/pill/pill";
import { Checkbox } from "../../forms/checkbox/checkbox";
import { ChoiceGroup } from "../../forms/choice-group/choice-group";
import {
  FieldError,
  FieldHint,
  FieldLabel,
  FieldLegend,
  RequiredMark,
} from "../../forms/field/field";
import { Input, Textarea } from "../../forms/input/input";
import { NumberInput } from "../../forms/number-input/number-input";
import { RadioGroup } from "../../forms/radio/radio";
import { Segmented } from "../../forms/segmented/segmented";
import { Select } from "../../forms/select/select";
import { Slider } from "../../forms/slider/slider";
import { Switch } from "../../forms/switch/switch";
import { InlineText, OptionLabel, displayWidth, plainText, shortOptions } from "./parts";

/** What every field's control is handed. */
export interface FieldControlProps {
  field: A2uiFormField;
  answer: A2uiFormAnswer | undefined;
  onChange: (answer: A2uiFormAnswer) => void;
  /** Read-only: the reply is no longer the open question. */
  disabled: boolean;
  strings: A2uiStrings;
  /** What is wrong with the answer as it stands (core's `fieldProblem`), or null. */
  problem: A2uiFieldProblem | null;
}

/**
 * The error line under a control, or undefined while there is none to show: nothing is wrong, or
 * the only thing wrong is a required field still empty. The rule is the one the answer broke —
 * "≤ 500" for a text too long, nothing for a pattern it missed — never another of the field's.
 */
function errorText(
  field: A2uiFormField,
  problem: A2uiFieldProblem | null,
  strings: A2uiStrings,
): string | undefined {
  if (problem === null || problem.code === "empty") return undefined;
  if (field.hint !== undefined) return plainText(field.hint);
  return problem.rule ?? strings.invalid;
}

/** The model's hint as a string prop takes it. */
function hintText(field: A2uiFormField): string | undefined {
  return field.hint === undefined ? undefined : plainText(field.hint);
}

/** The answer as a text box shows it: a text, or empty while there is none. */
function textOf(answer: A2uiFormAnswer | undefined): string {
  return typeof answer === "string" ? answer : "";
}

/** The answer as an option group shows it: the picked labels, or none. */
function labelsOf(answer: A2uiFormAnswer | undefined): readonly string[] {
  return Array.isArray(answer) ? answer : [];
}

/** A field's title with the required mark: an option group's legend. */
function LegendText({ field }: { field: A2uiFormField }): ReactNode {
  return (
    <>
      <InlineText text={field.label} />
      {field.required === true && <RequiredMark />}
    </>
  );
}

/** The line under an option group, which carries neither a hint nor an error of its own. */
function GroupNote({ field, error }: { field: A2uiFormField; error: string | undefined }) {
  if (error !== undefined) return <FieldError>{error}</FieldError>;
  if (field.hint === undefined) return null;
  return (
    <FieldHint>
      <InlineText text={field.hint} />
    </FieldHint>
  );
}

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

/** The labels picked once `label` is turned on or off, in the options' own order. */
function toggled(
  options: readonly A2uiOption[],
  picked: readonly string[],
  label: string,
  on: boolean,
): string[] {
  return options
    .map((option) => option.label)
    .filter((each) => (each === label ? on : picked.includes(each)));
}

function TextField({ field, answer, onChange, disabled, strings, problem }: FieldControlProps) {
  return (
    <Input
      label={plainText(field.label)}
      required={field.required}
      placeholder={field.placeholder}
      maxLength={field.maxLength ?? A2UI_LIMITS.textMaxLength}
      hint={hintText(field)}
      error={errorText(field, problem, strings)}
      value={textOf(answer)}
      onChange={(event) => onChange(event.target.value)}
      size="sm"
      disabled={disabled}
    />
  );
}

/**
 * Mod+Enter in a textarea fills the form, as Enter does in a one-line box; a bare Enter stays a
 * new line, and an Enter that ends an input method's composition stays the input method's.
 */
export function submitOnModEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
  if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
  if (event.nativeEvent.isComposing) return;
  event.preventDefault();
  event.currentTarget.form?.requestSubmit();
}

function TextareaField({ field, answer, onChange, disabled, strings, problem }: FieldControlProps) {
  return (
    <Textarea
      label={plainText(field.label)}
      required={field.required}
      placeholder={field.placeholder}
      maxLength={field.maxLength ?? A2UI_LIMITS.textareaMaxLength}
      hint={hintText(field)}
      error={errorText(field, problem, strings)}
      value={textOf(answer)}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={submitOnModEnter}
      rows={3}
      size="sm"
      disabled={disabled}
    />
  );
}

function NumberField({ field, answer, onChange, disabled, strings, problem }: FieldControlProps) {
  return (
    <NumberInput
      label={<InlineText text={field.label} />}
      value={textOf(answer)}
      onChange={onChange}
      min={field.min}
      max={field.max}
      step={field.step}
      unit={field.unit}
      placeholder={field.placeholder}
      required={field.required}
      disabled={disabled}
      size="sm"
      hint={field.hint === undefined ? undefined : <InlineText text={field.hint} />}
      error={errorText(field, problem, strings)}
      stepLabels={{ up: strings.stepUp, down: strings.stepDown }}
    />
  );
}

function SliderField({ field, answer, onChange, disabled, strings, problem }: FieldControlProps) {
  // The grammar refuses a slider without both bounds; the fallbacks only satisfy the types.
  const min = field.min ?? 0;
  const max = field.max ?? 100;
  const figure = Number.parseFloat(textOf(answer));
  return (
    <Slider
      label={<InlineText text={field.label} />}
      value={Number.isFinite(figure) ? figure : min}
      onChange={(value) => onChange(String(value))}
      min={min}
      max={max}
      step={field.step}
      unit={field.unit}
      required={field.required}
      disabled={disabled}
      hint={field.hint === undefined ? undefined : <InlineText text={field.hint} />}
      error={errorText(field, problem, strings)}
    />
  );
}

function SingleField({ field, answer, onChange, disabled, strings, problem }: FieldControlProps) {
  const options = field.options ?? [];
  const value = textOf(answer);
  const error = errorText(field, problem, strings);
  if (segmented(options)) {
    // The fieldset names the group and, read-only, disables every segment in it; the well dims
    // as the other read-only controls do.
    return (
      <fieldset disabled={disabled} className="min-w-0">
        <FieldLegend required={field.required}>
          <InlineText text={field.label} />
        </FieldLegend>
        <div className={disabled ? "cursor-not-allowed opacity-60" : undefined}>
          <Segmented
            options={options.map((option) => ({
              value: option.label,
              label: plainText(option.label),
              ...(option.recommended === true
                ? {
                    badge: {
                      node: <Pill tone="info">{strings.recommended}</Pill>,
                      name: strings.recommended,
                    },
                  }
                : {}),
            }))}
            value={value}
            onChange={onChange}
            cols={options.length as 2 | 3 | 4}
          />
        </div>
        <GroupNote field={field} error={error} />
      </fieldset>
    );
  }
  return (
    <div className="min-w-0">
      <RadioGroup
        label={<LegendText field={field} />}
        options={options.map((option) => ({
          value: option.label,
          label: <OptionLabel option={option} strings={strings} />,
          hint:
            option.description !== undefined ? <InlineText text={option.description} /> : undefined,
        }))}
        value={value}
        onChange={onChange}
        size="sm"
        disabled={disabled}
      />
      <GroupNote field={field} error={error} />
    </div>
  );
}

function MultipleField({ field, answer, onChange, disabled, strings, problem }: FieldControlProps) {
  const options = field.options ?? [];
  const picked = labelsOf(answer);
  return (
    <fieldset disabled={disabled} className="min-w-0">
      <FieldLegend required={field.required}>
        <InlineText text={field.label} />
      </FieldLegend>
      {chips(options) ? (
        <ChoiceGroup
          shape="chip"
          size="sm"
          multiple
          options={options.map((option) => ({
            value: option.label,
            label: <OptionLabel option={option} strings={strings} />,
          }))}
          value={picked}
          onChange={onChange}
          disabled={disabled}
        />
      ) : (
        <div className="flex flex-col gap-2">
          {options.map((option) => (
            <Checkbox
              key={option.label}
              checked={picked.includes(option.label)}
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
      <GroupNote field={field} error={errorText(field, problem, strings)} />
    </fieldset>
  );
}

function SelectField({ field, answer, onChange, disabled, strings, problem }: FieldControlProps) {
  return (
    <Select
      label={plainText(field.label)}
      required={field.required}
      hint={hintText(field)}
      error={errorText(field, problem, strings)}
      value={textOf(answer)}
      onChange={(event) => onChange(event.target.value)}
      size="sm"
      disabled={disabled}
    >
      {/* The empty answer, in the placeholder's ink, at the head of the list. */}
      <option value="">
        <span className="text-fg-subtle">{field.placeholder ?? strings.choose}</span>
      </option>
      {(field.options ?? []).map((option) => (
        <option key={option.label} value={option.label}>
          <OptionLabel option={option} strings={strings} />
        </option>
      ))}
    </Select>
  );
}

/**
 * A switch at the end of its row. The title is the field label every other field wears, a real
 * `<label for>` on the switch, so the row reads as one field of the form rather than a settings
 * row — and a click on the title flips it, as on a checkbox's.
 */
function SwitchField({ field, answer, onChange, disabled }: FieldControlProps) {
  const id = useId();
  const hintId = useId();
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <FieldLabel htmlFor={id} required={field.required} block={false}>
          <InlineText text={field.label} />
        </FieldLabel>
        {field.hint !== undefined && (
          <FieldHint>
            <span id={hintId}>
              <InlineText text={field.hint} />
            </span>
          </FieldHint>
        )}
      </div>
      <Switch
        id={id}
        checked={answer === true}
        onChange={onChange}
        disabled={disabled}
        aria-describedby={field.hint !== undefined ? hintId : undefined}
      />
    </div>
  );
}

/** The native input each calendar kind is; `datetime-local` emits the `T` the grammar reads. */
const DATE_INPUT: Readonly<Record<"date" | "time" | "datetime", string>> = {
  date: "date",
  time: "time",
  datetime: "datetime-local",
};

function DateField({ field, answer, onChange, disabled, strings, problem }: FieldControlProps) {
  const kind = field.kind as keyof typeof DATE_INPUT;
  return (
    <Input
      type={DATE_INPUT[kind]}
      label={plainText(field.label)}
      required={field.required}
      hint={hintText(field)}
      error={errorText(field, problem, strings)}
      value={textOf(answer)}
      onChange={(event) => onChange(event.target.value)}
      size="sm"
      disabled={disabled}
    />
  );
}

const CONTROLS: Readonly<Record<A2uiFieldKind, (props: FieldControlProps) => ReactElement>> = {
  text: TextField,
  textarea: TextareaField,
  number: NumberField,
  slider: SliderField,
  single: SingleField,
  multiple: MultipleField,
  select: SelectField,
  switch: SwitchField,
  date: DateField,
  time: DateField,
  datetime: DateField,
};

/** The control a field's kind is drawn as. */
export function FormFieldControl(props: FieldControlProps): ReactElement {
  const Control = CONTROLS[props.field.kind];
  return <Control {...props} />;
}
