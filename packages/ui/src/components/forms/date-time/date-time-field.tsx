/**
 * A date-and-time field, after iOS's: the picker trigger, and in its panel a month calendar with a
 * row under it holding Today and the time as a pill. A press on a day writes that day with the
 * time the field holds — or, while it holds none, the reader's clock now on the minute step — and
 * keeps the panel open for the time. The pill swaps the calendar for the time wheels in the same
 * room, the hour wheel taking the focus, and swaps it back; every turn writes at once.
 *
 * The value is the native `datetime-local` input's `YYYY-MM-DDTHH:mm`, local and without a zone,
 * "" while empty. `min` and `max` (the same format, each included) fade the days outside their
 * dates and hold a written moment inside them.
 */
import { useEffect, useMemo, useState } from "react";
import { ICONS } from "../../icons/icons";
import { useUiStrings } from "../../../strings";
import { Button } from "../../actions/button/button";
import { dateTimeValue, parseDate, parseDateTime, todayOf, withinBounds } from "./calendar-date";
import type { CalendarDate, ClockTime } from "./calendar-date";
import { CALENDAR_PANEL } from "./date-field";
import { formatDateTime, formatTime, hourCycleOf } from "./date-locale";
import { MonthCalendar } from "./month-calendar";
import { PickerFoot, PickerPanel, usePickerPanel } from "./picker-panel";
import { PickerTrigger } from "./picker-trigger";
import type { PickerFieldProps } from "./picker-trigger";
import { clampValue, openingTime } from "./time-field";
import type { ClockProps } from "./time-field";
import { TimeWheels } from "./time-wheels";

export interface DateTimeFieldProps extends PickerFieldProps, ClockProps {
  /** `YYYY-MM-DDTHH:mm`, or "" while nothing is picked. */
  value: string;
  onChange: (value: string) => void;
  /** The earliest and latest moments that may be written (`YYYY-MM-DDTHH:mm`), each included. */
  min?: string;
  max?: string;
}

/** The date part of a `YYYY-MM-DDTHH:mm` bound, for the calendar's days. */
const boundDay = (bound: string | undefined) => parseDate((bound ?? "").slice(0, 10));

export function DateTimeField({
  value,
  onChange,
  min,
  max,
  minuteStep = 1,
  hourCycle,
  placeholder,
  clearable,
  ...field
}: DateTimeFieldProps) {
  const strings = useUiStrings().dates;
  const locale = strings.locale;
  const picker = usePickerPanel(CALENDAR_PANEL.height, CALENDAR_PANEL.width);
  const [wheels, setWheels] = useState(false);
  const held = parseDateTime(value);
  const cycle = hourCycle ?? hourCycleOf(locale);
  const today = todayOf(new Date());
  const low = boundDay(min);
  const high = boundDay(max);
  // Read once per opening, so the wheels hold still while a minute passes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const opening = useMemo(() => openingTime(minuteStep), [picker.open, minuteStep]);
  const time = held?.time ?? opening;

  // Every opening starts on the calendar.
  useEffect(() => {
    if (!picker.open) setWheels(false);
  }, [picker.open]);

  const write = (date: CalendarDate, at: ClockTime) =>
    onChange(clampValue(dateTimeValue(date, at), min, max));

  return (
    <>
      <PickerTrigger
        {...field}
        picker={picker}
        shown={
          held === null
            ? (placeholder ?? strings.pickDateTime)
            : formatDateTime(held.date, held.time, locale, cycle)
        }
        empty={held === null}
        glyph={ICONS.calendar}
        clearable={clearable ?? field.required !== true}
        onClear={() => onChange("")}
        value={value}
      />
      <PickerPanel
        picker={picker}
        label={field.label ?? field["aria-label"] ?? strings.pickDateTime}
        widthClass="w-72"
      >
        <MonthCalendar
          locale={locale}
          strings={strings}
          today={today}
          selected={held?.date ?? null}
          min={low}
          max={high}
          initial={held?.date ?? today}
          onPick={(date) => write(date, time)}
          cover={
            wheels ? (
              <TimeWheels
                time={time}
                onChange={(at) => write(held?.date ?? today, at)}
                cycle={cycle}
                minuteStep={minuteStep}
                locale={locale}
                strings={strings}
                autoFocus
              />
            ) : undefined
          }
        />
        <PickerFoot>
          <Button
            variant="ghost"
            size="sm"
            disabled={!withinBounds(today, low, high)}
            onClick={() => write(today, time)}
          >
            {strings.today}
          </Button>
          <span className="flex items-center gap-2">
            <span className="text-xs text-fg-muted">{strings.time}</span>
            <button
              type="button"
              aria-pressed={wheels}
              aria-label={strings.fieldName(strings.time, formatTime(time, locale, cycle))}
              onClick={() => setWheels((open) => !open)}
              className={`whitespace-nowrap rounded-control bg-surface-muted px-2.5 py-1 tabular-nums transition-colors duration-150 hover:bg-control-hover ${
                wheels ? "text-accent" : held === null ? "text-fg-subtle" : "text-fg"
              }`}
            >
              {formatTime(time, locale, cycle)}
            </button>
          </span>
        </PickerFoot>
      </PickerPanel>
    </>
  );
}
