/**
 * A pie's geometry: pure, no React (test/chart-pie.test.ts). A pie is drawn as ring arcs
 * (ChartArc), the ring gauge's maths (ringArcs) with the slices' total as the whole: slices run
 * clockwise from twelve o'clock in order, each its share of the circle, and a slice of nothing
 * draws nothing.
 *
 * A full pie is one ring as wide as its radius — the arc's stroke covers the disc from the centre
 * out — and a donut a ring that leaves the inner part of the radius open. Neighbouring slices are
 * kept a hairline apart along the arc, so two slices in near colours still read as two.
 */
import type { ChartPaint } from "../marks/marks";
import { ringArcs } from "../ring/ring";

export interface PieSlice {
  label: string;
  /** The slice's amount; nothing is drawn for zero or less. */
  value: number;
  /** The slice's colour; palette slot `i` (its position) when omitted. */
  paint?: ChartPaint;
}

/** The share of the radius a donut leaves open. */
export const DONUT_HOLE = 0.6;
/** The gap between neighbouring slices, px along the arc. */
const SLICE_GAP = 1.5;

/** The ring a pie of `size` px is drawn as: its centre, its radius and stroke width, its length. */
export function pieRing(
  size: number,
  donut: boolean,
): { c: number; r: number; width: number; circumference: number } {
  const radius = size / 2;
  const width = donut ? radius * (1 - DONUT_HOLE) : radius;
  const r = radius - width / 2;
  return { c: radius, r, width, circumference: 2 * Math.PI * r };
}

/** Where each drawn slice starts and how long it runs, px along the ring. */
export function pieArcs(
  slices: readonly Pick<PieSlice, "value">[],
  circumference: number,
): { index: number; length: number; offset: number }[] {
  const arcs = ringArcs(
    slices.map((slice) => ({ value: slice.value })),
    0,
    circumference,
  );
  if (arcs.length < 2) return arcs;
  return arcs.map((arc) => ({ ...arc, length: Math.max(arc.length / 2, arc.length - SLICE_GAP) }));
}

/** Each slice's share of the total, 0–1 (0 for a slice of nothing). */
export function sliceShares(slices: readonly Pick<PieSlice, "value">[]): number[] {
  const counted = slices.map((slice) =>
    Number.isFinite(slice.value) && slice.value > 0 ? slice.value : 0,
  );
  const total = counted.reduce((sum, v) => sum + v, 0);
  return counted.map((v) => (total > 0 ? v / total : 0));
}

/** A share as the legend prints it: a whole percent, and "<1%" for a sliver that is not none. */
export function shareText(share: number): string {
  if (share <= 0) return "0%";
  const percent = Math.round(share * 100);
  return percent < 1 ? "<1%" : `${percent}%`;
}
