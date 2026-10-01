/**
 * A chart's legend: each item a swatch painted the way its marks are, and its label.
 *
 * Two layouts:
 * - `inline` (the default): a wrapping row of items under or beside a chart. While an item is
 *   singled out (`active`: pointed at here or on the chart's marks) the others fade — the
 *   site-wide highlight.
 * - `list`: one item per row with its figures after the label (`value`: a count, a share), the
 *   label truncating first. The active row takes a wash, and a pinned one (`pinned`) a ring as
 *   well, so a pin does not read as a hover that happened to stay. A row may leave its swatch
 *   out (a ranking whose rows have no mark) and keeps the same box as the rows that have one.
 *
 * `onHover` makes the items answer the pointer; `onSelect` makes each a toggle button, pressed
 * while pinned — the way a keyboard reaches a highlight, since a chart's marks are pointer-only.
 * An item that explains a shape rather than naming a series (the dash that says "the lines are
 * the success rate") passes `interactive: false` and never highlights or fades.
 *
 * A swatch is the chart's own (`ChartSwatch`); an item may draw a mark of its own in its place
 * (`mark`: a state `Dot`, say). Every label is the caller's words.
 */
import type { ReactNode } from "react";
import { ChartSwatch } from "../marks/marks";
import type { ChartPaint, ChartSwatchShape } from "../marks/marks";

export interface LegendItem {
  /** Names the item to `active`, `pinned`, `onHover` and `onSelect`. */
  key: string;
  label: string;
  /** The swatch's colour, as the item's marks are painted. No paint and no mark: no swatch. */
  paint?: ChartPaint;
  shape?: ChartSwatchShape;
  /** Drawn in the swatch's place. */
  mark?: ReactNode;
  /** The tooltip over a truncated label, when it should say more than the label (a file's path). */
  title?: string;
  /** What a `list` row prints after its label. */
  value?: ReactNode;
  /** False for an item that explains a shape rather than naming a series. */
  interactive?: boolean;
}

export type LegendLayout = "inline" | "list";

export function Legend({
  items,
  layout = "inline",
  label,
  active = null,
  pinned = null,
  onHover,
  onSelect,
  mono = false,
  className = "",
}: {
  items: readonly LegendItem[];
  layout?: LegendLayout;
  /** The list's accessible name, when no heading beside it names it already. */
  label?: string;
  /** The item singled out, by a pointer on the legend or on the chart's marks. */
  active?: string | null;
  /** The item a click pinned (with `onSelect`). */
  pinned?: string | null;
  onHover?: (key: string | null) => void;
  onSelect?: (key: string) => void;
  /** Set the labels in the data face (identifiers: a tool, a file, an agent id). */
  mono?: boolean;
  /** Layout only (a margin); the type and the inks are the legend's. */
  className?: string;
}) {
  const list = layout === "list";
  return (
    <ul
      aria-label={label}
      className={`${list ? "flex flex-col" : "flex flex-wrap items-center gap-x-3 gap-y-1"} text-xs text-fg-muted ${className}`}
    >
      {items.map((item) => {
        const interactive = item.interactive !== false;
        const lit = active === item.key;
        const swatch =
          item.mark ??
          (item.paint === undefined ? null : (
            <ChartSwatch paint={item.paint} shape={item.shape ?? "square"} />
          ));
        const cells = (
          <>
            {swatch}
            <span
              data-tooltip={item.title ?? item.label}
              data-tooltip-content={mono ? "code" : "text"}
              className={`min-w-0 truncate ${list ? "flex-1" : ""} ${mono ? "font-mono" : ""}`}
            >
              {item.label}
            </span>
            {list ? item.value : null}
          </>
        );
        // The box carries the highlight: a list row washes (and rings while pinned), an inline
        // item fades while another one is singled out.
        const box = list
          ? `flex items-center gap-1.5 rounded px-1 py-0.5 transition-colors duration-150 ${
              lit ? "bg-tone-neutral-bg" : ""
            } ${pinned === item.key ? "inset-ring-1 inset-ring-fg-subtle" : ""}`
          : `flex min-w-0 items-center gap-1.5 transition-opacity duration-150 ${
              interactive && active !== null && !lit ? "opacity-30" : ""
            }`;
        const hover =
          interactive && onHover !== undefined
            ? { onMouseEnter: () => onHover(item.key), onMouseLeave: () => onHover(null) }
            : {};
        // A list row's box bleeds past the column by its own padding, so its label lines up
        // with the text above and below it.
        const bleed = list ? "-mx-1" : "";
        if (interactive && onSelect !== undefined) {
          return (
            <li key={item.key} className={list ? bleed : "flex min-w-0"}>
              <button
                type="button"
                aria-pressed={pinned === item.key}
                onClick={() => onSelect(item.key)}
                {...hover}
                className={`cursor-pointer text-left ${list ? "w-full" : ""} ${box}`}
              >
                {cells}
              </button>
            </li>
          );
        }
        return (
          <li key={item.key} {...hover} className={`${bleed} ${box}`}>
            {cells}
          </li>
        );
      })}
    </ul>
  );
}
