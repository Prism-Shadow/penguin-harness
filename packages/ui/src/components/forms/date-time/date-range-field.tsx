/**
 * A date-range field, after Material 3's range picker: the picker trigger, showing the span as
 * its two dates in full (2026年11月1日-2026年11月16日, Nov 1, 2026 – Nov 16, 2026), and in its
 * panel a headline, one month calendar picking both ends, and Cancel and OK. The calendar opens
 * on the month of the span's end, where a recent span is picked from.
 *
 * The headline reads the span as it stands, an end not pressed yet named in its place (开始日期,
 * 结束日期). The first press on a day sets one end; the span then follows the pointer (or the
 * keyboard's focus) on a flat band; the second press sets the other end — in either order, the
 * earlier day always the start — and a third starts over. Nothing is written until OK, which
 * writes the span and closes the panel; Cancel, Escape and a press outside close it and leave the
 * span as it was. A range is not a value until it has both ends, which is why it is confirmed
 * where a single day is written on its press.
 *
 * Both ends are `YYYY-MM-DD`, both "" while empty; `min` and `max` (the same format, each
 * included) fade and hold back the days outside them. With a `name`, a form posts the span as
 * `from..to`.
 */
import { useEffect, useState } from "react";
import { ICONS } from "../../icons/icons";
import { useUiStrings } from "../../../strings";
import { Button } from "../../actions/button/button";
import { compareDates, dateValue, parseDate, todayOf } from "./calendar-date";
import type { CalendarDate } from "./calendar-date";
import { CALENDAR_PANEL } from "./date-field";
import { formatDate, formatDateRange } from "./date-locale";
import { MonthCalendar } from "./month-calendar";
import type { DayRange } from "./month-calendar";
import { PickerFoot, PickerPanel } from "./picker-panel";
import { PickerTrigger, usePickerPanel } from "./picker-trigger";
import type { PickerFieldProps } from "./picker-trigger";

/** A span of days as the field writes it: both ends `YYYY-MM-DD`, or both "". */
export interface DateRangeValue {
  from: string;
  to: string;
}

export interface DateRangeFieldProps extends PickerFieldProps {
  from: string;
  to: string;
  onChange: (range: DateRangeValue) => void;
  /** The first and last days that may be picked (`YYYY-MM-DD`), each included. */
  min?: string;
  max?: string;
}

/** The two days in order, the earlier first. */
function ordered(a: CalendarDate, b: CalendarDate): DayRange {
  return compareDates(a, b) <= 0 ? { from: a, to: b } : { from: b, to: a };
}

/** The span being picked: one end pressed, or both. */
interface Draft {
  from: CalendarDate;
  to: CalendarDate | null;
}

export function DateRangeField({
  from,
  to,
  onChange,
  min,
  max,
  placeholder,
  clearable,
  ...field
}: DateRangeFieldProps) {
  const strings = useUiStrings().dates;
  const locale = strings.locale;
  const picker = usePickerPanel(CALENDAR_PANEL.height + 40, CALENDAR_PANEL.width);
  const start = parseDate(from);
  const end = parseDate(to);
  const held = start !== null && end !== null ? ordered(start, end) : null;
  // Nothing is written until OK: the presses build a draft, and the day the pointer or the
  // keyboard is on is where the band runs to while the draft has one end.
  const [draft, setDraft] = useState<Draft | null>(null);
  const [point, setPoint] = useState<CalendarDate | null>(null);
  const today = todayOf(new Date());

  // A closed panel forgets its draft.
  useEffect(() => {
    if (picker.open) return;
    setDraft(null);
    setPoint(null);
  }, [picker.open]);

  // The first press sets one end, the second the other, in either order; a third starts over.
  const pick = (day: CalendarDate) => {
    if (draft === null || draft.to !== null) {
      setDraft({ from: day, to: null });
      setPoint(day);
      return;
    }
    setDraft(ordered(draft.from, day));
  };

  const picking = draft !== null && draft.to === null;
  const drawn: DayRange | null =
    draft === null
      ? held
      : draft.to !== null
        ? { from: draft.from, to: draft.to }
        : ordered(draft.from, point ?? draft.from);
  // The headline's two ends: the draft's once a day is pressed, the held span's before.
  const headStart = draft === null ? (held?.from ?? null) : draft.from;
  const headEnd = draft === null ? (held?.to ?? null) : draft.to;

  const confirm = () => {
    if (draft !== null && draft.to !== null)
      onChange({ from: dateValue(draft.from), to: dateValue(draft.to) });
    picker.close();
  };

  return (
    <>
      <PickerTrigger
        {...field}
        picker={picker}
        shown={
          held === null
            ? (placeholder ?? strings.pickRange)
            : formatDateRange(held.from, held.to, locale, strings.rangeSeparator)
        }
        empty={held === null}
        glyph={ICONS.calendar}
        clearable={clearable ?? field.required !== true}
        onClear={() => onChange({ from: "", to: "" })}
        value={held === null ? "" : `${dateValue(held.from)}..${dateValue(held.to)}`}
      />
      <PickerPanel
        picker={picker}
        label={field.label ?? field["aria-label"] ?? strings.pickRange}
        widthClass="w-72"
      >
        {/* The headline: the span as it stands, an end not pressed yet named in its place. */}
        <p className="mb-2 flex items-baseline border-b border-line-muted pb-2 font-medium tabular-nums">
          <span className={headStart === null ? "text-fg-subtle" : "text-fg"}>
            {headStart === null ? strings.startDate : formatDate(headStart, locale)}
          </span>
          <span className="whitespace-pre text-fg-subtle">{strings.rangeSeparator}</span>
          <span className={headEnd === null ? "text-fg-subtle" : "text-fg"}>
            {headEnd === null ? strings.endDate : formatDate(headEnd, locale)}
          </span>
        </p>
        <MonthCalendar
          locale={locale}
          strings={strings}
          today={today}
          range={drawn}
          min={parseDate(min ?? "")}
          max={parseDate(max ?? "")}
          initial={held?.to ?? today}
          onPick={pick}
          onPoint={(day) => {
            if (picking) setPoint(day);
          }}
        />
        {/* Read out once the first end is pressed; the band on the grid says it to the eye. */}
        <span className="sr-only" aria-live="polite">
          {picking ? strings.pickEnd : ""}
        </span>
        <PickerFoot>
          <span className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={picker.close}>
              {strings.cancel}
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={draft === null ? held === null : draft.to === null}
              onClick={confirm}
            >
              {strings.confirm}
            </Button>
          </span>
        </PickerFoot>
      </PickerPanel>
    </>
  );
}
