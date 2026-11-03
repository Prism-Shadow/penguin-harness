/**
 * Which round is in view (pure — the rounds button's label and the navigator's current row).
 *
 * The rounds are rows under the panel's sticky toolbar. The one in view is the first drawn round
 * that shows below the toolbar either whole or by at least a head and a half: a collapsed row the
 * reader is looking at counts once it is fully under the toolbar, an open round as long as more
 * than the tail of its body is left, and the sliver of the round above a jumped-to head — which
 * cannot always climb to the toolbar, there being nothing below it to scroll — does not. Once the
 * panel is scrolled to its end it is the last drawn round, which the file opens on. With no round
 * on screen yet (the reader is at the top, over the Session and the summary), it is the first
 * drawn round, the one the reader is about to meet.
 */

/** A drawn round's row in viewport coordinates: its top and bottom, and its head's height. */
export interface RoundRowBox {
  taskIndex: number;
  top: number;
  bottom: number;
  headHeight: number;
}

/** What the rows are measured against: the toolbar's bottom edge, the scroll box's bottom edge, and whether the box is scrolled to its end. */
export interface RoundView {
  line: number;
  bottom: number;
  atEnd: boolean;
}

/** The round in view among `rows` (in drawing order); null with none drawn. */
export function roundInView(rows: readonly RoundRowBox[], view: RoundView): number | null {
  if (rows.length === 0) return null;
  if (view.atEnd) return rows[rows.length - 1]!.taskIndex;
  for (const row of rows) {
    const shown = Math.min(row.bottom, view.bottom) - Math.max(row.top, view.line);
    if (shown >= Math.min(row.bottom - row.top, 1.5 * row.headHeight)) return row.taskIndex;
  }
  return rows[0]!.taskIndex;
}
