/**
 * One wheel of a picker, the way iOS draws an hour or a month: a column of values that scrolls
 * under a band, each value snapping to the band's middle, and the value in the band is the
 * column's. The band itself is drawn once behind every column of a picker (`WheelBand`), so the
 * columns read as one row.
 *
 * Every way of turning it ends on a value:
 *
 * - a mouse wheel moves it one row a notch, and a trackpad one row for every row's height its
 *   fingers travel, so a value can be landed on; neither scrolls the page or the panel behind;
 * - a finger scrolls it natively with `scroll-snap`, and once the column has been still for a
 *   moment the row in the band is the new value;
 * - a mouse drags it (a mouse has no native drag scroll), and on release it snaps to the nearest
 *   row and takes it;
 * - a press on a row takes that row, and a press on the row in the band takes it as it is — the
 *   way to accept a value the picker opened on;
 * - the keyboard steps it as a spin button does: ↑ / ↓ one row, Page Up / Page Down five, Home
 *   and End the ends; typed digits or letters jump to the row whose number or name they spell
 *   ("1", "4" is 14; "p" is PM), and once what is typed can name no longer value the focus moves
 *   on to the next wheel of the row, so "1430" sets an hour and a minute; Enter takes the row in
 *   the band and hands over to the caller (`onEnter`: close the picker, leave the wheels).
 *
 * A notch, a press and a key report the value at once and the column scrolls to it after; a
 * finger's scroll reports it when it settles, and only if it moved. A value that changes from
 * outside scrolls the column to it, at once on first draw and smoothly after (at once under
 * reduced motion).
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
  /** Enter, after the row in the band is taken: what the picker does next. */
  onEnter?: () => void;
}

/** How long a scrolled column must be still before its row counts as picked (ms). */
const SETTLE_MS = 120;
/** How long typed characters keep spelling one value (ms). */
const TYPEAHEAD_MS = 800;
/** A mouse that moves less than this between press and release pressed a row (px). */
const DRAG_SLOP = 4;
/** Rows a Page Up or Page Down moves. */
const PAGE_ROWS = 5;
/**
 * A wheel event this large in pixels is a mouse wheel's notch (browsers send about 100 a notch),
 * which moves one row; smaller ones are a trackpad's, summed until they make a row.
 */
const NOTCH_PX = 40;

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
 * Whether typing more could still name another row than `match`: some other row's number or label
 * starts with what is typed and runs longer ("1" may yet be 10–12 on a 12-hour clock; "14" is all
 * an hour can be). While it could, the focus stays; once it cannot, it moves on.
 */
export function typedMayGoOn(
  options: readonly WheelOption[],
  typed: string,
  match: WheelOption,
): boolean {
  const text = typed.toLowerCase();
  return options.some(
    (option) =>
      option !== match &&
      [String(option.value), option.label.toLowerCase()].some(
        (name) => name.length > text.length && name.startsWith(text),
      ),
  );
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
  onEnter,
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
  // The row a run of wheel events has moved to before the value it reported comes back, so two
  // notches between renders move two rows; and what a trackpad has travelled short of a row.
  const aimed = useRef<number | null>(null);
  const travelled = useRef(0);

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
    aimed.current = null;
    if (drag.current?.moved === true) return;
    scrollToRow(index, drawn.current);
    drawn.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  // The wheel is handled here, not left to the scroller: a native notch scrolls about three rows
  // and `scroll-snap` lands wherever that ends, so no value next to the band could be reached.
  // Not passive, so the page and the panel behind do not scroll with it.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller === null) return;
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY === 0) return;
      event.preventDefault();
      const { options: rows, value: held, onChange: report } = latest.current;
      const row = rowHeight();
      const pixels = event.deltaY * (event.deltaMode === 0 ? 1 : row);
      let steps: number;
      if (event.deltaMode !== 0 || Math.abs(pixels) >= NOTCH_PX) {
        steps = Math.sign(pixels);
        travelled.current = 0;
      } else {
        travelled.current += pixels;
        steps = Math.trunc(travelled.current / row);
        travelled.current -= steps * row;
      }
      if (steps === 0) return;
      const at =
        aimed.current ??
        Math.max(
          0,
          rows.findIndex((option) => option.value === held),
        );
      const next = clamp(at + steps, 0, rows.length - 1);
      aimed.current = next;
      const option = rows[next];
      if (option !== undefined && option.value !== held) report(option.value);
    };
    scroller.addEventListener("wheel", onWheel, { passive: false });
    return () => scroller.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      if (event.key === "Enter") onEnter?.();
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
    if (typedMayGoOn(options, text, match)) return;
    // Nothing longer can be typed here: the next wheel of the row takes the keys that follow.
    typed.current = { text: "", at: 0 };
    const self = event.currentTarget;
    const wheels = [
      ...(self.parentElement?.querySelectorAll<HTMLElement>(':scope > [role="spinbutton"]') ?? []),
    ];
    wheels[wheels.indexOf(self) + 1]?.focus({ preventScroll: true });
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
      className={`group/wheel no-scrollbar relative h-40 overflow-y-auto overscroll-contain outline-none ${
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
          // The keyboard's ring marks the row in the band, inside it (the scroller clips past its
          // edges), rather than the whole five-row column.
          className={`flex h-8 snap-center items-center justify-center whitespace-nowrap rounded-md tabular-nums transition-colors duration-150 ${
            row === index
              ? "font-medium text-fg group-focus-visible/wheel:[outline:var(--ui-focus-ring)] group-focus-visible/wheel:[outline-offset:-2px]"
              : "text-fg-subtle hover:text-fg-muted"
          }`}
        >
          {option.label}
        </div>
      ))}
      <div aria-hidden className="h-16" />
    </div>
  );
}
