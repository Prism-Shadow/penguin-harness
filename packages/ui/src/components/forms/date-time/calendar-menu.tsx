/**
 * The menu a month calendar's head opens in the grid's place, after Material 3's month and year
 * selection: every month, or every year the bounds allow, as a grid of three columns, the one
 * the calendar is on filled with the accent. A press takes it and brings the days back.
 *
 * It is a listbox with one Tab stop, on the option it holds: the arrows move the focus by one
 * (left, right) or by a row (up, down), Home and End go to the ends, Enter or Space takes the
 * focused option. It opens scrolled to its value, with the focus on it.
 */
import { useLayoutEffect, useRef } from "react";
import type { KeyboardEvent } from "react";

export interface CalendarMenuOption {
  readonly value: number;
  readonly label: string;
}

const COLUMNS = 3;

export function CalendarMenu({
  label,
  options,
  value,
  onPick,
}: {
  /** The listbox's accessible name ("Month"). */
  label: string;
  options: readonly CalendarMenuOption[];
  value: number;
  onPick: (value: number) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const held = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    // A document that lays nothing out (a test's) has no scrolling to do.
    held?.scrollIntoView?.({ block: "center" });
    held?.focus({ preventScroll: true });
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step =
      event.key === "ArrowLeft"
        ? -1
        : event.key === "ArrowRight"
          ? 1
          : event.key === "ArrowUp"
            ? -COLUMNS
            : event.key === "ArrowDown"
              ? COLUMNS
              : event.key === "Home"
                ? -options.length
                : event.key === "End"
                  ? options.length
                  : 0;
    if (step === 0) return;
    event.preventDefault();
    const items = [...(listRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    items[Math.min(items.length - 1, Math.max(0, at + step))]?.focus();
  };

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label={label}
      onKeyDown={onKeyDown}
      className="grid h-full grid-cols-3 content-start gap-1 overflow-y-auto"
    >
      {options.map((option) => {
        const held = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="option"
            aria-selected={held}
            tabIndex={held ? 0 : -1}
            onClick={() => onPick(option.value)}
            className={`h-8 whitespace-nowrap rounded-control text-sm tabular-nums transition-colors duration-150 ${
              held ? "bg-accent font-medium text-accent-fg" : "text-fg hover:bg-control-hover"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
