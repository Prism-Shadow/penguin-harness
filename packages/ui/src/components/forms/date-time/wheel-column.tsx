/**
 * One wheel of a picker, the way iOS draws an hour or a month: a column of values that scrolls
 * under a band, each value snapping to the band's middle, and the value in the band is the
 * column's. The band itself is drawn once behind every column of a picker (`WheelBand`), so the
 * columns read as one row.
 *
 * Every way of turning it ends on a value:
 *
 * - a scroll — a mouse wheel, a trackpad, a finger — runs natively with `scroll-snap`, and once
 *   the column has been still for a moment the row in the band is the new value;
 * - a mouse drags it (a mouse has no native drag scroll), and on release it snaps to the nearest
 *   row and takes it;
 * - a press on a row takes that row, and a press on the row in the band takes it as it is — the
 *   way to accept a value the picker opened on;
 * - the keyboard steps it as a spin button does: ↑ / ↓ one row, Page Up / Page Down five, Home
 *   and End the ends, Enter takes the row in the band, and typed digits or letters jump to the row
 *   whose number or name they spell ("1", "4" is 14; "p" is PM).
 *
 * A press and a key report the value at once and the column scrolls to it after; a scroll reports
 * it when it settles, and only if it moved. A value that changes from outside scrolls the column
 * to it, at once on first draw and smoothly after (at once under reduced motion).
 *
 * The column is a `spinbutton` named by the caller, whose value text is the row's label; the rows
 * are drawing only. Its rows are the theme's spacing (`h-8`) tall: the height is read off a row
 * where the page is laid out and taken as 2rem where it is not (a test's document).
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { usePrefersReducedMotion } from "../../../motion/use-reduced-motion";

export interface WheelOption {
  readonly value: number;
  readonly label: string;
}

export interface WheelColumnProps {
  /** The column's accessible name ("Hour"). */
  label: string;
  /** The rows, in the order they stack; ↑ moves to the next one down. */
  options: readonly WheelOption[];
  /** The value in the band; a value no row holds puts the first row there. */
  value: number;
  onChange: (value: number) => void;
  /** Width of the column (`w-12`); its rows centre their labels. */
  className?: string;
  /** Takes the keyboard focus when it is drawn: the first wheel of a picker that opens on it. */
  autoFocus?: boolean;
}

/** How long a scrolled column must be still before its row counts as picked (ms). */
const SETTLE_MS = 120;
/** How long typed characters keep spelling one value (ms). */
const TYPEAHEAD_MS = 800;
/** A mouse that moves less than this between press and release pressed a row (px). */
const DRAG_SLOP = 4;
/** Rows a Page Up or Page Down moves. */
const PAGE_ROWS = 5;

const clamp = (n: number, low: number, high: number) => Math.min(high, Math.max(low, n));

/** The row the typed text names: a number by its value, a word by the start of its label. */
export function typedOption(
  options: readonly WheelOption[],
  typed: string,
): WheelOption | undefined {
  if (/^\d+$/.test(typed)) return options.find((option) => option.value === Number(typed));
  const text = typed.toLowerCase();
  return options.find((option) => option.label.toLowerCase().startsWith(text));
}

/**
 * The band the columns of one picker share: a flat fill behind the middle row, as tall as a row.
 * It sits under the columns (they come after it), which are transparent.
 */
export function WheelBand() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-1/2 h-8 -translate-y-1/2 rounded-md bg-surface-muted"
    />
  );
}

export function WheelColumn({
  label,
  options,
  value,
  onChange,
  className = "w-14",
  autoFocus = false,
}: WheelColumnProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const reducedMotion = usePrefersReducedMotion();
  const found = options.findIndex((option) => option.value === value);
  const index = found < 0 ? 0 : found;
  const current = options[index];

  // Read through refs by the timers and the listeners below, which outlive a render.
  const latest = useRef({ options, value, onChange, reducedMotion });
  latest.current = { options, value, onChange, reducedMotion };

  const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const drag = useRef<{ y: number; top: number; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  const draggedLast = useRef(false);
  const typed = useRef({ text: "", at: 0 });
  const drawn = useRef(false);

  const rowHeight = (): number => {
    const row = scrollerRef.current?.querySelector<HTMLElement>("[data-row]");
    const measured = row?.offsetHeight ?? 0;
    if (measured > 0) return measured;
    const root = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
    return (Number.isFinite(root) && root > 0 ? root : 16) * 2;
  };

  const scrollToRow = (row: number, smooth: boolean) => {
    const scroller = scrollerRef.current;
    if (scroller === null) return;
    const top = row * rowHeight();
    if (Math.abs(scroller.scrollTop - top) < 1) return;
    const reduced =
      latest.current.reducedMotion || document.documentElement.dataset.motion === "reduced";
    if (smooth && !reduced && typeof scroller.scrollTo === "function") {
      scroller.scrollTo({ top, behavior: "smooth" });
    } else {
      scroller.scrollTop = top;
    }
  };

  /** The row in the band once a scroll has stopped: snapped onto exactly, and reported if new. */
  const settle = () => {
    clearTimeout(settleTimer.current);
    const scroller = scrollerRef.current;
    if (scroller === null || drag.current?.moved === true) return;
    const { options: rows, value: held, onChange: report } = latest.current;
    const row = clamp(Math.round(scroller.scrollTop / rowHeight()), 0, rows.length - 1);
    scrollToRow(row, true);
    const picked = rows[row];
    if (picked !== undefined && picked.value !== held) report(picked.value);
  };

  // The value in the band follows the value from outside: at once when the column is first
  // drawn, smoothly after. A scroll that settled on the value has already put it there.
  useLayoutEffect(() => {
    if (drag.current?.moved === true) return;
    scrollToRow(index, drawn.current);
    drawn.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  useEffect(() => {
    if (autoFocus) scrollerRef.current?.focus({ preventScroll: true });
    return () => clearTimeout(settleTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onScroll = () => {
    clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(settle, SETTLE_MS);
  };

  const press = (row: number) => {
    // The click a drag ends with is the drag's, not a press on the row it was released over.
    if (draggedLast.current) {
      draggedLast.current = false;
      return;
    }
    const option = options[row];
    if (option !== undefined) onChange(option.value);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    draggedLast.current = false;
    drag.current = { y: event.clientY, top: event.currentTarget.scrollTop, moved: false };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const held = drag.current;
    if (held === null) return;
    const dy = event.clientY - held.y;
    if (!held.moved) {
      if (Math.abs(dy) < DRAG_SLOP) return;
      held.moved = true;
      setDragging(true);
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }
    event.currentTarget.scrollTop = held.top - dy;
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    const held = drag.current;
    drag.current = null;
    if (held?.moved !== true) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    draggedLast.current = true;
    setDragging(false);
    settle();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const last = options.length - 1;
    const step: Record<string, number> = {
      ArrowUp: index + 1,
      ArrowDown: index - 1,
      PageUp: index + PAGE_ROWS,
      PageDown: index - PAGE_ROWS,
      Home: 0,
      End: last,
    };
    const to = step[event.key];
    if (to !== undefined) {
      event.preventDefault();
      const option = options[clamp(to, 0, last)];
      if (option !== undefined && option.value !== value) onChange(option.value);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (current !== undefined) onChange(current.value);
      return;
    }
    if (event.key.length !== 1 || event.key.trim() === "") return;
    const now = Date.now();
    const text = (now - typed.current.at < TYPEAHEAD_MS ? typed.current.text : "") + event.key;
    typed.current = { text, at: now };
    const match = typedOption(options, text);
    if (match === undefined) return;
    event.preventDefault();
    if (match.value !== value) onChange(match.value);
  };

  return (
    <div
      ref={scrollerRef}
      role="spinbutton"
      tabIndex={0}
      aria-label={label}
      aria-valuenow={current?.value}
      aria-valuetext={current?.label}
      aria-valuemin={options[0]?.value}
      aria-valuemax={options[options.length - 1]?.value}
      onScroll={onScroll}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      className={`no-scrollbar relative h-40 overflow-y-auto overscroll-contain rounded-md outline-none focus-visible:[outline:var(--ui-focus-ring)] focus-visible:[outline-offset:var(--ui-focus-ring-offset)] ${
        dragging ? "cursor-grabbing" : "cursor-grab snap-y snap-mandatory"
      } ${className}`}
    >
      {/* Two rows of room above the first row and below the last, so either can reach the
          band: `h-16` is two rows of `h-8`, and the column `h-40` five. */}
      <div aria-hidden className="h-16" />
      {options.map((option, row) => (
        <div
          key={option.value}
          data-row=""
          aria-hidden
          onClick={() => press(row)}
          className={`flex h-8 snap-center items-center justify-center whitespace-nowrap tabular-nums transition-colors duration-150 ${
            row === index ? "font-medium text-fg" : "text-fg-subtle hover:text-fg-muted"
          }`}
        >
          {option.label}
        </div>
      ))}
      <div aria-hidden className="h-16" />
    </div>
  );
}
