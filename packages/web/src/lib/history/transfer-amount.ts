/**
 * The amount a transfer row shows ("  3.2 / 9.6 MB"): the bytes done against the whole, both in
 * the whole's unit and at its precision, and the done figure padded with figure spaces to the
 * whole's width. So for one total every reading renders at one width and in one unit — never
 * "900 KB / 1.2 MB" — and nothing on the line moves as the bytes count up: a figure space is as
 * wide as a digit in tabular figures, and both figures carry the same decimals.
 */

/** As wide as a digit in tabular figures, and not collapsed the way an ordinary space is. */
const FIGURE_SPACE = " ";

const KIB = 1024;
const MIB = KIB * 1024;
const GIB = MIB * 1024;

/** The unit a total is read in, its size, and the decimals both figures take. */
function unitOf(total: number): { unit: string; size: number; decimals: number } {
  if (total < KIB) return { unit: "B", size: 1, decimals: 0 };
  // Picked on the rounded figure, so 1023.7 KiB reads as 1.0 MB rather than as "1024 KB".
  if (Math.round(total / KIB) < 1000) return { unit: "KB", size: KIB, decimals: 0 };
  if (Number((total / MIB).toFixed(1)) < 1000) return { unit: "MB", size: MIB, decimals: 1 };
  return { unit: "GB", size: GIB, decimals: 1 };
}

/** The amount for `done` of `total` bytes; null while the total is not known (zero or less). */
export function transferAmount(done: number, total: number): string | null {
  if (!(total > 0)) return null;
  const { unit, size, decimals } = unitOf(total);
  const whole = (total / size).toFixed(decimals);
  const sofar = (Math.min(Math.max(done, 0), total) / size).toFixed(decimals);
  return `${sofar.padStart(whole.length, FIGURE_SPACE)} / ${whole} ${unit}`;
}
