/**
 * The month calendar every date picker opens, after Material 3's: a head with a month menu and a
 * year menu (in the order the locale names them: 2026年 11月, November 2026) and the two month
 * steps, a row of weekdays in the order the locale's week runs (Monday first for zh-CN, Sunday
 * for en-US), each as its narrow name with the whole one on hover, and six weeks of days, always
 * six so the grid keeps its height from one month to the next. A day takes the theme's control
 * shape (a disc in Frost, a square in Console): the picked day filled with the accent, today in
 * the accent's ink and weight inside a hairline ring of it, a day outside the bounds faded and
 * not pickable, and the days of the months on either side left blank. A range draws its two ends
 * filled and the days between them on one flat band.
 *
 * Pressing a menu's button swaps the grid for that menu in its place (calendar-menu.tsx): the
 * twelve months, or the years the bounds allow. A press on one brings back the grid on it, the
 * focus on its day; pressing the button again leaves the menu as it was. A new month arrives
 * under the theme's reveal (`data-reveal`): Frost fades it in, Console jumps, and reduced motion
 * shows it at once.
 *
 * The grid follows the ARIA date-grid pattern: one Tab stop on the focused day, the arrows, Home
 * and End, Page Up and Page Down (with Shift, a year) moving the focus and the month with it
 * (calendar-keys.ts), Enter or Space picking. Each day is named in full ("Thursday, November 12,
 * 2026"), the picked days carry `aria-selected`, and today `aria-current="date"`; the grid itself
 * is named by its month.
 *
 * `cover` lays something over the whole calendar, which keeps its size underneath: the
 * date-and-time picker's time wheels sit there, so swapping between the two never resizes the
 * panel.
 */
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { ICON_SIZE } from "../../../icon-scale";
import type { DateStrings } from "../../../strings";
import { IconButton } from "../../actions/button/button";
import { ChevronFlip } from "../../icons/chevron/chevron";
import { GlyphIcon } from "../../icons/glyph-icon/glyph-icon";
import { ICONS } from "../../icons/icons";
import {
  addMonths,
  clampDate,
  compareDates,
  dateValue,
  daysInMonth,
  inMonth,
  monthWeeks,
  sameDate,
  withinBounds,
} from "./calendar-date";
import type { CalendarDate, CalendarMonth } from "./calendar-date";
import { gridKeyTarget } from "./calendar-keys";
import { CalendarMenu } from "./calendar-menu";
import {
  firstDayOfWeek,
  formatDayName,
  formatMonthTitle,
  monthNames,
  weekdayNames,
  yearFirst,
  yearName,
} from "./date-locale";

/** A span of days, its ends in order. */
export interface DayRange {
  readonly from: CalendarDate;
  readonly to: CalendarDate;
}

export interface MonthCalendarProps {
  locale: string;
  strings: DateStrings;
  /** Today on the reader's calendar. */
  today: CalendarDate;
  /** The picked day. */
  selected?: CalendarDate | null;
  /** A span to draw: its ends as discs, the days between on a band. */
  range?: DayRange | null;
  /** The first and last days that may be picked, each included. */
  min?: CalendarDate | null;
  max?: CalendarDate | null;
  /** The day the focus starts on, and so the month shown first. */
  initial: CalendarDate;
  onPick: (date: CalendarDate) => void;
  /** The day the pointer or the keyboard is on: a range's moving end follows it. */
  onPoint?: (date: CalendarDate) => void;
  /** Laid over the whole calendar, which keeps its size underneath. */
  cover?: ReactNode;
}

/** How far the year wheel runs either side of today when no bound stops it. */
const YEAR_SPAN = 100;

const monthKey = (month: CalendarMonth) => `${month.year}-${month.month}`;

/** Where a day sits in a range: an end, between the ends, or outside. */
function rangePlace(day: CalendarDate, range: DayRange | null): "from" | "to" | "inside" | null {
  if (range === null) return null;
  const fromOrder = compareDates(day, range.from);
  const toOrder = compareDates(day, range.to);
  if (fromOrder === 0) return "from";
  if (toOrder === 0) return "to";
  return fromOrder > 0 && toOrder < 0 ? "inside" : null;
}

/** The band behind a day of a range: whole between the ends, half at an end that has a partner. */
const BAND: Record<"from" | "to" | "inside", string> = {
  from: "left-1/2 right-0",
  to: "left-0 right-1/2",
  inside: "inset-x-0",
};

/**
 * The band a day of a range draws, if any. An end's half band reaches toward the other end, so an
 * end at the edge of its week, with that half on the outer side (the start on a week's last day,
 * the end on its first), draws none: the band carries on in the row above or below, and a half
 * here would hang outside the grid.
 */
function bandAt(
  place: ReturnType<typeof rangePlace>,
  range: DayRange | null,
  column: number,
): "from" | "to" | "inside" | null {
  if (place === null || range === null || sameDate(range.from, range.to)) return null;
  if (place === "from" && column === 6) return null;
  if (place === "to" && column === 0) return null;
  return place;
}

export function MonthCalendar({
  locale,
  strings,
  today,
  selected = null,
  range = null,
  min = null,
  max = null,
  initial,
  onPick,
  onPoint,
  cover,
}: MonthCalendarProps) {
  const firstDay = firstDayOfWeek(locale);
  const [focus, setFocus] = useState(() => clampDate(initial, min, max));
  // The menu the head has open in the grid's place: the months, the years, or neither.
  const [menu, setMenu] = useState<"month" | "year" | null>(null);
  // Months moved since the calendar opened: the first month is drawn, every later one revealed.
  const [moves, setMoves] = useState(0);
  const moveFocus = useRef(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const visible: CalendarMonth = { year: focus.year, month: focus.month };

  const goTo = (next: CalendarDate, keyboard: boolean) => {
    const target = clampDate(next, min, max);
    if (!inMonth(target, visible)) setMoves((n) => n + 1);
    moveFocus.current = keyboard;
    setFocus(target);
    if (keyboard) onPoint?.(target);
  };

  // A day picked from outside the grid (the Today shortcut) brings its month into view.
  const selectedKey = selected === null ? "" : dateValue(selected);
  const shownSelection = useRef(selectedKey);
  useEffect(() => {
    if (selectedKey === shownSelection.current) return;
    shownSelection.current = selectedKey;
    if (selected !== null) goTo(selected, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey]);

  // A key moved the focus (or a menu's pick brought the grid back): the focused day takes the
  // keyboard focus once it is drawn.
  useEffect(() => {
    if (!moveFocus.current || menu !== null) return;
    moveFocus.current = false;
    gridRef.current?.querySelector<HTMLElement>('button[tabindex="0"]')?.focus();
  }, [focus, menu]);

  const onGridKey = (event: KeyboardEvent<HTMLDivElement>) => {
    // Enter picks the focused day on the key itself, the grid's pick and not each button's own
    // activation; Space keeps the button's.
    if (event.key === "Enter") {
      event.preventDefault();
      if (withinBounds(focus, min, max)) onPick(focus);
      return;
    }
    const target = gridKeyTarget(event.key, focus, firstDay, event.shiftKey);
    if (target === null) return;
    event.preventDefault();
    goTo(target, true);
  };

  const firstOfMonth: CalendarDate = { year: visible.year, month: visible.month, day: 1 };
  const before = addMonths(firstOfMonth, -1);
  const lastBefore = { ...before, day: daysInMonth(before.year, before.month) };
  const after = addMonths(firstOfMonth, 1);
  const noEarlier = min !== null && compareDates(lastBefore, min) < 0;
  const noLater = max !== null && compareDates(after, max) > 0;

  const title = formatMonthTitle(visible, locale);
  const weekdays = weekdayNames(locale, firstDay);

  const months = monthNames(locale).map((name, i) => ({ value: i + 1, label: name }));
  const fromYear = Math.min(min?.year ?? today.year - YEAR_SPAN, visible.year);
  const toYear = Math.max(max?.year ?? today.year + YEAR_SPAN, visible.year);
  const years = Array.from({ length: toYear - fromYear + 1 }, (_, i) => ({
    value: fromYear + i,
    label: yearName(fromYear + i, locale),
  }));
  // A menu's pick brings the grid back on that month, its day in the focus.
  const takeMonth = (year: number, month: number) => {
    goTo({ year, month, day: Math.min(focus.day, daysInMonth(year, month)) }, false);
    moveFocus.current = true;
    setMenu(null);
  };
  const menuButton = (kind: "month" | "year", name: string, shown: string) => (
    <button
      key={kind}
      type="button"
      aria-haspopup="listbox"
      aria-expanded={menu === kind}
      aria-label={strings.fieldName(name, shown)}
      onClick={() => setMenu((open) => (open === kind ? null : kind))}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-control px-1.5 py-1 font-semibold text-fg transition-colors duration-150 hover:bg-control-hover ${
        menu === kind ? "bg-control-hover" : ""
      }`}
    >
      {shown}
      <ChevronFlip up={menu === kind} size={ICON_SIZE.caretDense} className="text-fg-muted" />
    </button>
  );
  const monthButton = menuButton("month", strings.month, months[visible.month - 1]!.label);
  const yearButton = menuButton("year", strings.year, yearName(visible.year, locale));

  // `column` is the day's place in its week row, 0 to 6.
  const day = (date: CalendarDate, column: number) => {
    if (!inMonth(date, visible))
      return <span key={dateValue(date)} role="gridcell" className="h-9" />;
    const enabled = withinBounds(date, min, max);
    const place = rangePlace(date, range);
    const picked = sameDate(date, selected) || place === "from" || place === "to";
    const isToday = sameDate(date, today);
    const band = bandAt(place, range, column);
    const look = picked
      ? "bg-accent font-medium text-accent-fg"
      : !enabled
        ? "cursor-not-allowed text-fg-subtle opacity-60"
        : isToday
          ? // The accent's ink alone is the body's own under a neutral accent (Frost's, Console's),
            // so today also takes a hairline ring in the accent's line.
            "font-semibold text-accent ring-1 ring-inset ring-accent-line hover:bg-control-hover"
          : "text-fg hover:bg-control-hover";
    return (
      <div
        key={dateValue(date)}
        role="gridcell"
        aria-selected={picked || place === "inside" ? true : undefined}
        className="relative flex h-9 items-center justify-center"
      >
        {band !== null && (
          <span aria-hidden className={`absolute inset-y-0.5 bg-accent-muted ${BAND[band]}`} />
        )}
        <button
          type="button"
          tabIndex={sameDate(date, focus) ? 0 : -1}
          // The panel hands the focus to the focused day when it opens.
          data-autofocus={sameDate(date, focus) ? "" : undefined}
          aria-label={formatDayName(date, locale)}
          aria-current={isToday ? "date" : undefined}
          aria-disabled={enabled ? undefined : true}
          onClick={() => {
            if (!enabled) return;
            setFocus(date);
            onPick(date);
          }}
          onMouseEnter={() => onPoint?.(date)}
          className={`relative size-8 rounded-control text-sm tabular-nums transition-colors duration-150 ${look}`}
        >
          {date.day}
        </button>
      </div>
    );
  };

  const calendar = (
    <>
      <div className="flex items-center justify-between gap-2 pb-2">
        <span className="flex items-center gap-1">
          {yearFirst(locale) ? [yearButton, monthButton] : [monthButton, yearButton]}
        </span>
        {/* The month steps hide while a menu holds the grid's place, and leave the Tab order. */}
        <span
          className={`flex items-center gap-1 ${menu !== null ? "invisible" : ""}`}
          {...(menu !== null ? { inert: true } : {})}
        >
          <IconButton
            size="sm"
            variant="ghost"
            label={strings.previousMonth}
            disabled={noEarlier}
            onClick={() => goTo(addMonths(focus, -1), false)}
          >
            <GlyphIcon d={ICONS.chevronLeft} size={ICON_SIZE.iconButton} />
          </IconButton>
          <IconButton
            size="sm"
            variant="ghost"
            label={strings.nextMonth}
            disabled={noLater}
            onClick={() => goTo(addMonths(focus, 1), false)}
          >
            <GlyphIcon d={ICONS.chevronRight} size={ICON_SIZE.iconButton} />
          </IconButton>
        </span>
      </div>
      <div className="relative">
        <div
          ref={gridRef}
          role="grid"
          aria-label={title}
          onKeyDown={onGridKey}
          className={menu !== null ? "invisible" : undefined}
          {...(menu !== null ? { inert: true, "aria-hidden": true } : {})}
        >
          <div role="rowgroup">
            <div role="row" className="grid grid-cols-7">
              {weekdays.map((weekday) => (
                <span
                  key={weekday.long}
                  role="columnheader"
                  aria-label={weekday.long}
                  data-tooltip={weekday.long}
                  data-tooltip-extra
                  className="flex h-6 items-center justify-center text-xs text-fg-subtle"
                >
                  {weekday.short}
                </span>
              ))}
            </div>
          </div>
          <div key={monthKey(visible)} role="rowgroup" data-reveal={moves > 0 ? "" : undefined}>
            {monthWeeks(visible, firstDay).map((week) => (
              <div key={dateValue(week[0]!)} role="row" className="grid grid-cols-7">
                {week.map((date, column) => day(date, column))}
              </div>
            ))}
          </div>
        </div>
        {menu !== null && (
          <div className="absolute inset-0">
            {menu === "month" ? (
              <CalendarMenu
                key="month"
                label={strings.month}
                options={months}
                value={visible.month}
                onPick={(month) => takeMonth(visible.year, month)}
              />
            ) : (
              <CalendarMenu
                key="year"
                label={strings.year}
                options={years}
                value={visible.year}
                onPick={(year) => takeMonth(year, visible.month)}
              />
            )}
          </div>
        )}
      </div>
    </>
  );

  // One shape with or without the cover, so swapping it in keeps the calendar's own elements.
  const covered = cover !== undefined;
  return (
    <div className="relative">
      <div
        className={covered ? "invisible" : undefined}
        {...(covered ? { inert: true, "aria-hidden": true } : {})}
      >
        {calendar}
      </div>
      {covered && <div className="absolute inset-0 flex items-center justify-center">{cover}</div>}
    </div>
  );
}
