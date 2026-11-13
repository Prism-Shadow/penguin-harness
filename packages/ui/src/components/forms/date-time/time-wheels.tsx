/**
 * The time wheels: an hour and a minute column under one band, and on a 12-hour clock a column of
 * day periods, set where the locale writes it (2:30 PM, 下午2:30). Hours read 00–23 on a 24-hour
 * clock and 1–12 on a 12-hour one; minutes run on the field's step (every minute, every 5, every
 * 15), and a minute off the step still shows as itself, so a stored 09:37 is never shown as
 * 09:35.
 */
import type { DateStrings } from "../../../strings";
import type { ClockTime } from "./calendar-date";
import { dayPeriodNames, periodFirst } from "./date-locale";
import type { HourCycle } from "./date-locale";
import { WheelBand, WheelColumn } from "./wheel-column";
import type { WheelOption } from "./wheel-column";

const pad = (n: number) => String(n).padStart(2, "0");

const HOURS_24: readonly WheelOption[] = Array.from({ length: 24 }, (_, hour) => ({
  value: hour,
  label: pad(hour),
}));

const HOURS_12: readonly WheelOption[] = Array.from({ length: 12 }, (_, i) => ({
  value: i + 1,
  label: String(i + 1),
}));

/** The minutes a wheel offers: every `step`th, and `held` among them when it is off the step. */
export function minuteOptions(step: number, held: number): WheelOption[] {
  const every = Math.max(1, Math.floor(step));
  const minutes = new Set<number>([held]);
  for (let minute = 0; minute < 60; minute += every) minutes.add(minute);
  return [...minutes]
    .sort((a, b) => a - b)
    .map((minute) => ({ value: minute, label: pad(minute) }));
}

export interface TimeWheelsProps {
  time: ClockTime;
  onChange: (time: ClockTime) => void;
  cycle: HourCycle;
  minuteStep: number;
  locale: string;
  strings: DateStrings;
  /** The hour wheel takes the keyboard focus when drawn. */
  autoFocus?: boolean;
}

export function TimeWheels({
  time,
  onChange,
  cycle,
  minuteStep,
  locale,
  strings,
  autoFocus = false,
}: TimeWheelsProps) {
  const minute = (
    <WheelColumn
      key="minute"
      label={strings.minute}
      options={minuteOptions(minuteStep, time.minute)}
      value={time.minute}
      onChange={(next) => onChange({ hour: time.hour, minute: next })}
    />
  );
  if (cycle === "h23") {
    return (
      <div className="relative flex items-center justify-center gap-2">
        <WheelBand />
        <WheelColumn
          label={strings.hour}
          options={HOURS_24}
          value={time.hour}
          onChange={(hour) => onChange({ hour, minute: time.minute })}
          autoFocus={autoFocus}
        />
        {minute}
      </div>
    );
  }
  const afternoon = time.hour >= 12 ? 1 : 0;
  const [am, pm] = dayPeriodNames(locale);
  const hour = (
    <WheelColumn
      key="hour"
      label={strings.hour}
      options={HOURS_12}
      value={time.hour % 12 === 0 ? 12 : time.hour % 12}
      onChange={(next) => onChange({ hour: (next % 12) + afternoon * 12, minute: time.minute })}
      autoFocus={autoFocus}
    />
  );
  const period = (
    <WheelColumn
      key="period"
      label={strings.dayPeriod}
      options={[
        { value: 0, label: am },
        { value: 1, label: pm },
      ]}
      value={afternoon}
      onChange={(next) => onChange({ hour: (time.hour % 12) + next * 12, minute: time.minute })}
    />
  );
  return (
    <div className="relative flex items-center justify-center gap-2">
      <WheelBand />
      {periodFirst(locale) ? [period, hour, minute] : [hour, minute, period]}
    </div>
  );
}
