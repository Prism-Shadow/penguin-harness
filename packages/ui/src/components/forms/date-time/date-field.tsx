/**
 * A date field: the picker trigger, and a month calendar in its panel. A press on a day writes
 * the day and closes the panel; Today, under the grid, picks today. The value is the native date
 * input's `YYYY-MM-DD`, "" while empty, and `min` and `max` (the same format, each included) fade
 * and hold back the days outside them.
 */
import { ICONS } from "../../icons/icons";
import { useUiStrings } from "../../../strings";
import { Button } from "../../actions/button/button";
import { dateValue, parseDate, todayOf, withinBounds } from "./calendar-date";
import type { CalendarDate } from "./calendar-date";
import { formatDate } from "./date-locale";
import { MonthCalendar } from "./month-calendar";
import { PickerFoot, PickerPanel } from "./picker-panel";
import { PickerTrigger, usePickerPanel } from "./picker-trigger";
import type { PickerFieldProps } from "./picker-trigger";

/** The calendar panel's size at the default text size (px): its width, and its height with Today. */
export const CALENDAR_PANEL = { width: 288, height: 380 } as const;

export interface DateFieldProps extends PickerFieldProps {
  /** `YYYY-MM-DD`, or "" while nothing is picked. */
  value: string;
  onChange: (value: string) => void;
  /** The first and last days that may be picked (`YYYY-MM-DD`), each included. */
  min?: string;
  max?: string;
}

export function DateField({
  value,
  onChange,
  min,
  max,
  placeholder,
  clearable,
  ...field
}: DateFieldProps) {
  const strings = useUiStrings().dates;
  const picker = usePickerPanel(CALENDAR_PANEL.height, CALENDAR_PANEL.width);
  const date = parseDate(value);
  const low = parseDate(min ?? "");
  const high = parseDate(max ?? "");
  const today = todayOf(new Date());
  const pick = (day: CalendarDate) => {
    onChange(dateValue(day));
    picker.close();
  };
  return (
    <>
      <PickerTrigger
        {...field}
        picker={picker}
        shown={date === null ? (placeholder ?? strings.pickDate) : formatDate(date, strings.locale)}
        empty={date === null}
        glyph={ICONS.calendar}
        clearable={clearable ?? field.required !== true}
        onClear={() => onChange("")}
        value={value}
      />
      <PickerPanel
        picker={picker}
        label={field.label ?? field["aria-label"] ?? strings.pickDate}
        widthClass="w-72"
      >
        <MonthCalendar
          locale={strings.locale}
          strings={strings}
          today={today}
          selected={date}
          min={low}
          max={high}
          initial={date ?? today}
          onPick={pick}
        />
        <PickerFoot>
          <Button
            variant="ghost"
            size="sm"
            disabled={!withinBounds(today, low, high)}
            onClick={() => pick(today)}
          >
            {strings.today}
          </Button>
        </PickerFoot>
      </PickerPanel>
    </>
  );
}
