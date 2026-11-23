/**
 * What the leaderboard charts share: the width they draw at, axis ticks on round numbers, the
 * readout that names a hovered or focused mark, and how an entry is labelled.
 */
import { useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { LeaderboardEntry } from "../../../lib/hub/types";
import { S } from "../../../lib/strings";
import type { NameOf } from "./entry-name";

/** The element's content width, kept current; 0 until the first layout. */
export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.clientWidth);
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

export interface Scale {
  min: number;
  max: number;
  step: number;
  ticks: number[];
}

/**
 * An axis over [lo, hi] with ticks inside it on round steps (1, 2, 2.5 or 5 times a power of
 * ten): the finest step that gives at most `most` of them, or one more than that when it would
 * otherwise leave fewer than three.
 */
export function niceScale(lo: number, hi: number, most = 4): Scale {
  if (!(hi - lo > 1e-9)) {
    const pad = Math.abs(hi) * 0.1 || 1;
    lo -= pad;
    hi += pad;
  }
  const magnitude = 10 ** Math.floor(Math.log10(hi - lo));
  const options = [0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10].map((m) => {
    const step = m * magnitude;
    const first = Math.ceil(lo / step - 1e-9);
    const last = Math.floor(hi / step + 1e-9);
    return { step, first, count: last - first + 1 };
  });
  const k = options.findIndex(({ count }) => count <= most);
  const finer = options[k - 1];
  const chosen =
    options[k] && options[k].count < 3 && finer && finer.count <= most + 1 ? finer : options[k];
  if (!chosen) return { min: lo, max: hi, step: hi - lo, ticks: [lo, hi] };
  const decimals = decimalsOf(chosen.step);
  const ticks = Array.from({ length: chosen.count }, (_, i) =>
    Number(((chosen.first + i) * chosen.step).toFixed(decimals)),
  );
  return { min: lo, max: hi, step: chosen.step, ticks };
}

/** How many decimals the ticks of a step need: 0.25 → 2, 2.5 → 1, 5 → 0. */
export function decimalsOf(step: number): number {
  const text = String(Number(step.toPrecision(6)));
  const dot = text.indexOf(".");
  return dot === -1 ? 0 : text.length - dot - 1;
}

let measureContext: CanvasRenderingContext2D | null | undefined;

/** The drawn width of `text` in `font` (a CSS font shorthand), for placing labels before drawing. */
export function textWidth(text: string, font: string): number {
  if (measureContext === undefined) {
    measureContext = document.createElement("canvas").getContext("2d");
  }
  if (!measureContext) return text.length * 7;
  measureContext.font = font;
  return measureContext.measureText(text).width;
}

/** Entries best first; ties keep their order in the chart file. */
export function byValue(entries: readonly LeaderboardEntry[]): LeaderboardEntry[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => b.entry.value - a.entry.value || a.index - b.index)
    .map(({ entry }) => entry);
}

/** One label per entry: its method, with the model added where two entries share a method. */
export function labelsOf(entries: readonly LeaderboardEntry[], nameOf: NameOf): string[] {
  const names = entries.map(nameOf);
  const count = new Map<string, number>();
  for (const name of names) count.set(name.method, (count.get(name.method) ?? 0) + 1);
  return names.map((name) =>
    (count.get(name.method) ?? 0) > 1
      ? S.hub.leaderboards.methodOnModel(name.method, name.model)
      : name.method,
  );
}

/**
 * The ring a chart shows while the keyboard is on it, the same as the site's buttons and links;
 * a pointer's focus shows none.
 */
export const CHART_FOCUS =
  "focus-visible:outline-[3px] focus-visible:outline-offset-4 focus-visible:outline-gray-500/40";

/** Where a readout points: a mark's centre and its top and bottom edges, in the wrapper's pixels. */
export interface Anchor {
  x: number;
  top: number;
  bottom: number;
}

/**
 * The text naming one mark, set just above it and kept inside the chart's width. With `flip` it
 * drops below the mark when the chart has no room above it. It is drawn for the eye only; the
 * chart's live region speaks.
 */
export function Readout({
  id,
  anchor,
  bound,
  start = 0,
  flip = true,
  children,
}: {
  /** Names what the readout shows; it is measured and placed again when this changes. */
  id: string;
  anchor: Anchor;
  /** The readout's right limit, and `start` its left one, in the wrapper's pixels. */
  bound: number;
  start?: number;
  flip?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    const left = Math.max(start, Math.min(anchor.x - width / 2, bound - width));
    const above = anchor.top - height - 6;
    const top = above >= 0 || !flip ? above : anchor.bottom + 6;
    setPlace((current) =>
      current && current.left === left && current.top === top ? current : { left, top },
    );
  }, [id, anchor.x, anchor.top, anchor.bottom, bound, start, flip]);
  return (
    <div
      ref={ref}
      aria-hidden
      className="pointer-events-none absolute z-10 w-max max-w-64 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs leading-5 text-gray-600 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-400"
      style={place ? place : { left: 0, top: 0, visibility: "hidden" }}
    >
      {children}
    </div>
  );
}
