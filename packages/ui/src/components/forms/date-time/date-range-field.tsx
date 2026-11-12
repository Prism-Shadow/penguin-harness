/**
 * A date-range field: the picker trigger, showing the span the way the locale writes one
 * (2026年11月1日至12日, Nov 1 – 12, 2026), and one month calendar in its panel picking both ends.
 * The first press on a day sets one end; the span then follows the pointer (or the keyboard's
 * focus) on a flat band; the second press sets the other end — in either order, the earlier day
 * always the start — writes the span and closes the panel. A panel closed between the two presses
 * leaves the span as it was.
 *
 * `presets` add a row of quick spans under the calendar ("Last 7 days"); the one the field holds
 * shows pressed, and a press writes it with its id, so the caller can tell a preset from a span
 * picked by hand.
 *
 * Both ends are `YYYY-MM-DD`, both "" while empty; `min` and `max` (the same format, each
 * included) fade and hold back the days outside them. With a `name`, a form posts the span as
 * `from..to`.
 */
import { useEffect, useState } from "react";
import { ICONS } from "../../icons/icons";
import { useUiStrings } from "../../../strings";
import { ChoiceGroup } from "../choice-group/choice-group";
import { compareDates, dateValue, parseDate, todayOf } from "./calendar-date";
import type { CalendarDate } from "./calendar-date";
import { CALENDAR_PANEL } from "./date-field";
import { formatDateRange } from "./date-locale";
import { MonthCalendar } from "./month-calendar";
import type { DayRange } from "./month-calendar";
import { PickerFoot, PickerPanel, usePickerPanel } from "./picker-panel";
import { PickerTrigger } from "./picker-trigger";
import type { PickerFieldProps } from "./picker-trigger";

/** A span of days as the field writes it: both ends `YYYY-MM-DD`, or both "". */
export interface DateRangeValue {
  from: string;
  to: string;
}

/** A quick span offered under the calendar. */
export interface DateRangePreset extends DateRangeValue {
  /** Handed back with the span when it is pressed. */
  id: string;
  label: string;
}

export interface DateRangeFieldProps extends PickerFieldProps {
  from: string;
  to: string;
  /** The span written; `preset` is the id of the preset pressed, absent for a span picked by hand. */
  onChange: (range: DateRangeValue, preset?: string) => void;
  /** The first and last days that may be picked (`YYYY-MM-DD`), each included. */
  min?: string;
  max?: string;
  presets?: readonly DateRangePreset[];
}

/** The two days in order, the earlier first. */
function ordered(a: CalendarDate, b: CalendarDate): DayRange {
  return compareDates(a, b) <= 0 ? { from: a, to: b } : { from: b, to: a };
}

export function DateRangeField({
  from,
  to,
  onChange,
  min,
  max,
  presets = [],
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
  // The first end once it is pressed, and the day the other end follows until it is.
  const [anchor, setAnchor] = useState<CalendarDate | null>(null);
  const [point, setPoint] = useState<CalendarDate | null>(null);
  const today = todayOf(new Date());

  // A closed panel forgets a span it was half-way through.
  useEffect(() => {
    if (picker.open) return;
    setAnchor(null);
    setPoint(null);
  }, [picker.open]);

  const pick = (day: CalendarDate) => {
    if (anchor === null) {
      setAnchor(day);
      setPoint(day);
      return;
    }
    const span = ordered(anchor, day);
    setAnchor(null);
    onChange({ from: dateValue(span.from), to: dateValue(span.to) });
    picker.close();
  };

  const drawn = anchor !== null ? ordered(anchor, point ?? anchor) : held;
  return (
    <>
      <PickerTrigger
        {...field}
        picker={picker}
        shown={
          held === null
            ? (placeholder ?? strings.pickRange)
            : formatDateRange(held.from, held.to, locale)
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
        <MonthCalendar
          locale={locale}
          strings={strings}
          today={today}
          range={drawn}
          min={parseDate(min ?? "")}
          max={parseDate(max ?? "")}
          initial={held?.from ?? today}
          onPick={pick}
          onPoint={(day) => {
            if (anchor !== null) setPoint(day);
          }}
        />
        {/* Read out once the first end is pressed; the band on the grid says it to the eye. */}
        <span className="sr-only" aria-live="polite">
          {anchor !== null ? strings.pickEnd : ""}
        </span>
        {presets.length > 0 && (
          <PickerFoot>
            <ChoiceGroup
              shape="chip"
              size="sm"
              aria-label={field.label ?? field["aria-label"] ?? strings.pickRange}
              options={presets.map((preset) => ({ value: preset.id, label: preset.label }))}
              value={presets.find((preset) => preset.from === from && preset.to === to)?.id ?? null}
              onChange={(id) => {
                const preset = presets.find((each) => each.id === id);
                if (preset === undefined) return;
                onChange({ from: preset.from, to: preset.to }, preset.id);
                picker.close();
              }}
            />
          </PickerFoot>
        )}
      </PickerPanel>
    </>
  );
}
