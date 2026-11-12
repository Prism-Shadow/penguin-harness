/**
 * The field a date or time picker sits in: the shared control look (the box, its line, its focus
 * ring and its two size rungs, the same height as an Input or a Select beside it) as a button that
 * shows the value in the reader's language — 2026年11月12日, Nov 12, 2026, 14:30, 2:30 PM — or the
 * placeholder while there is none, with the field scaffolding's label, hint and error around it.
 * While its panel is open the value takes the accent's ink, as iOS lights the pill it opened.
 *
 * At its end sits one mark: the calendar or the clock, or, once an optional field holds a value,
 * the clear cross in its place, a button of its own beside the trigger rather than inside it. The
 * room for that mark is always kept, so the value never shifts when the cross comes or goes.
 *
 * The trigger is named by its title and what it shows ("Start at: Nov 12, 2026"), says it opens a
 * dialog, and carries `aria-invalid` and `aria-required` as the other fields do; the native
 * `required` is not set, since the app validates on submit. With a `name` it also writes its value
 * into a hidden input, so a form posts what a native input would have.
 */
import { useId } from "react";
import type { ReactNode } from "react";
import { ICON_SIZE } from "../../../icon-scale";
import { useUiStrings } from "../../../strings";
import { GlyphIcon } from "../../icons/glyph-icon/glyph-icon";
import { CloseIcon } from "../../icons/marks/marks";
import { Field, controlBase } from "../field/field";
import { errorClass, sizeTextClass } from "../input/input";
import type { ControlSize } from "../input/input";
import type { PickerPanelState } from "./picker-panel";

/** What every picker field takes besides its value. */
export interface PickerFieldProps {
  label?: string;
  /** Formatting guidance under the field (see Input's `hint`). */
  hint?: string;
  /** Semantic explanation behind a "?" beside the label (see Input's `info`). */
  info?: ReactNode;
  infoLabel?: string;
  /** The error under the field; the box takes the danger line. */
  error?: string;
  /** The danger line without an error text, for a caller that places the text itself. */
  invalid?: boolean;
  required?: boolean;
  disabled?: boolean;
  /** Shown while nothing is picked; the picker's "Pick a date" when omitted. */
  placeholder?: string;
  /** Posted with a form under this name, as a native input's value would be. */
  name?: string;
  size?: ControlSize;
  id?: string;
  /** The field's name when it has no visible `label`. */
  "aria-label"?: string;
  /** Offer the clear cross once a value is set; on by default for a field that is not required. */
  clearable?: boolean;
}

/** The value's padding: the room on the right holds the mark whether or not it shows. */
const PAD: Record<ControlSize, string> = { sm: "py-1 pl-2 pr-7", base: "py-2 pl-3 pr-9" };
/** Where the mark sits, and how large it is, per rung. */
const MARK_AT: Record<ControlSize, string> = { sm: "right-2", base: "right-3" };
const CLEAR_AT: Record<ControlSize, string> = { sm: "right-1", base: "right-2" };
const MARK_SIZE: Record<ControlSize, number> = {
  sm: ICON_SIZE.inlineGlyph,
  base: ICON_SIZE.rowLead,
};

export interface PickerTriggerProps extends Omit<PickerFieldProps, "placeholder" | "clearable"> {
  picker: PickerPanelState;
  /** What the field shows: the formatted value, or the placeholder. */
  shown: string;
  /** Nothing is picked: `shown` is the placeholder, in its ink. */
  empty: boolean;
  /** The mark at the field's end (`ICONS.calendar`, `ICONS.clock`). */
  glyph: string;
  /** The clear cross shows: an optional field holding a value. */
  clearable: boolean;
  onClear: () => void;
  /** The raw value, for the hidden input a `name` asks for. */
  value: string;
}

export function PickerTrigger({
  picker,
  shown,
  empty,
  glyph,
  clearable,
  onClear,
  value,
  label,
  hint,
  info,
  infoLabel,
  error,
  invalid,
  required,
  disabled,
  name,
  size = "sm",
  id,
  "aria-label": ariaLabel,
}: PickerTriggerProps) {
  const strings = useUiStrings().dates;
  const errorId = useId();
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const bad = Boolean(error) || Boolean(invalid);
  const subject = label ?? ariaLabel;
  const showClear = clearable && !empty && disabled !== true;
  const ink = empty ? "text-fg-subtle" : picker.open ? "text-accent" : "";
  return (
    <Field
      label={label}
      hint={hint}
      error={error}
      errorId={errorId}
      required={required}
      info={info}
      {...(infoLabel !== undefined ? { infoLabel } : {})}
      controlId={controlId}
    >
      <span className="relative block">
        <button
          ref={picker.triggerRef}
          id={controlId}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={picker.open}
          aria-controls={picker.open ? picker.panelId : undefined}
          aria-label={subject === undefined ? shown : strings.fieldName(subject, shown)}
          aria-invalid={bad ? true : undefined}
          aria-required={required || undefined}
          aria-describedby={error ? errorId : undefined}
          disabled={disabled}
          onClick={picker.toggle}
          className={`ui-edge flex w-full items-center text-left ${controlBase} ${sizeTextClass[size]} ${PAD[size]} disabled:cursor-not-allowed disabled:opacity-60 ${bad ? errorClass : ""}`}
        >
          <span className={`min-w-0 flex-1 truncate tabular-nums ${ink}`}>{shown}</span>
          {!showClear && (
            <GlyphIcon
              d={glyph}
              size={MARK_SIZE[size]}
              className={`pointer-events-none absolute top-1/2 -translate-y-1/2 ${MARK_AT[size]} text-fg-subtle`}
            />
          )}
        </button>
        {showClear && (
          <button
            type="button"
            aria-label={strings.clear}
            onClick={onClear}
            className={`absolute top-1/2 -translate-y-1/2 ${CLEAR_AT[size]} flex items-center justify-center rounded-sm p-1 text-fg-subtle transition-colors duration-150 hover:text-fg`}
          >
            <CloseIcon size={MARK_SIZE[size]} />
          </button>
        )}
        {name !== undefined && <input type="hidden" name={name} value={value} />}
      </span>
    </Field>
  );
}
