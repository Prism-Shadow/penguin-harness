/**
 * A time field: the picker trigger, and the time wheels in its panel, the hour wheel taking the
 * focus. Every turn of a wheel writes the time at once; the panel closes as any popover does.
 * An empty field opens on the reader's clock now (on the minute step), and a press on the row in
 * the band, or Enter, takes that time as it is. The clock face is the locale's (2:30 PM for
 * en-US, 14:30 for zh-CN) unless `hourCycle` names one.
 *
 * The value is the native time input's `HH:mm`, "" while empty; `min` and `max` (the same format,
 * each included) hold a written time inside them.
 */
import { useMemo } from "react";
import { ICONS } from "../../icons/icons";
import { useUiStrings } from "../../../strings";
import { clockOf, floorToStep, parseTime, timeValue } from "./calendar-date";
import type { ClockTime } from "./calendar-date";
import { formatTime, hourCycleOf } from "./date-locale";
import type { HourCycle } from "./date-locale";
import { PickerPanel, usePickerPanel } from "./picker-panel";
import { PickerTrigger } from "./picker-trigger";
import type { PickerFieldProps } from "./picker-trigger";
import { TimeWheels } from "./time-wheels";

/** The wheel panel's size at the default text size (px). */
const WHEEL_PANEL = { width: 224, height: 200 } as const;

/** What a time-taking field adds to the field's props. */
export interface ClockProps {
  /** Minutes between the minute wheel's rows: 1 (the default), 5, 15. */
  minuteStep?: number;
  /** A clock face other than the locale's own. */
  hourCycle?: HourCycle;
}

export interface TimeFieldProps extends PickerFieldProps, ClockProps {
  /** `HH:mm`, or "" while nothing is picked. */
  value: string;
  onChange: (value: string) => void;
  /** The earliest and latest times that may be written (`HH:mm`), each included. */
  min?: string;
  max?: string;
}

/** `value` held inside the bounds; the zero-padded format compares as text. */
export function clampValue(value: string, min: string | undefined, max: string | undefined) {
  if (min !== undefined && min !== "" && value < min) return min;
  if (max !== undefined && max !== "" && value > max) return max;
  return value;
}

/** The time a field without one opens on: the reader's clock now, moved down onto the step. */
export function openingTime(minuteStep: number): ClockTime {
  return floorToStep(clockOf(new Date()), minuteStep);
}

export function TimeField({
  value,
  onChange,
  min,
  max,
  minuteStep = 1,
  hourCycle,
  placeholder,
  clearable,
  ...field
}: TimeFieldProps) {
  const strings = useUiStrings().dates;
  const picker = usePickerPanel(WHEEL_PANEL.height, WHEEL_PANEL.width);
  const time = parseTime(value);
  const cycle = hourCycle ?? hourCycleOf(strings.locale);
  // Read once per opening, so the wheels hold still while a minute passes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const opening = useMemo(() => openingTime(minuteStep), [picker.open, minuteStep]);
  return (
    <>
      <PickerTrigger
        {...field}
        picker={picker}
        shown={
          time === null
            ? (placeholder ?? strings.pickTime)
            : formatTime(time, strings.locale, cycle)
        }
        empty={time === null}
        glyph={ICONS.clock}
        clearable={clearable ?? field.required !== true}
        onClear={() => onChange("")}
        value={value}
      />
      <PickerPanel
        picker={picker}
        label={field.label ?? field["aria-label"] ?? strings.pickTime}
        widthClass="w-56"
      >
        <TimeWheels
          time={time ?? opening}
          onChange={(next) => onChange(clampValue(timeValue(next), min, max))}
          cycle={cycle}
          minuteStep={minuteStep}
          locale={strings.locale}
          strings={strings}
          autoFocus
        />
      </PickerPanel>
    </>
  );
}
