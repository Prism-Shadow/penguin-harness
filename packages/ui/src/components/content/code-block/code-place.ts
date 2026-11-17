/**
 * A place in a numbered code surface, as the line at the top of its scroll box.
 *
 * An undrawn chunk of lines stands at an expected height (prose.css's `.line-chunk`), so one pixel
 * offset is not the same line in two surfaces that have drawn different chunks: the source view
 * and the editor that takes its place. Both agree on the line, so the place is the first line
 * reaching below the box's top edge and how far its top is from that edge. A box with no
 * numbered lines (a rendered Markdown file) has only its offset, which a restore falls back to.
 */

/** Where a scroll box is. */
export interface CodePlace {
  /** The box's own offsets. */
  top: number;
  left: number;
  /** The first line reaching below the box's top edge, 0-based; -1 where there are no lines. */
  line: number;
  /** How far that line's top is below the edge, in px; negative for a line the edge cuts. */
  inset: number;
}

/** The numbered lines' chunks under `box`. */
const CHUNKS = ".code-surface .line-chunk";

/**
 * Reads `box`'s place. A chunk's own box is always laid out, so only the lines of the chunk at the
 * edge are measured.
 */
export function readCodePlace(box: HTMLElement): CodePlace {
  const place: CodePlace = { top: box.scrollTop, left: box.scrollLeft, line: -1, inset: 0 };
  const edge = box.getBoundingClientRect().top;
  let before = 0;
  for (const chunk of box.querySelectorAll<HTMLElement>(CHUNKS)) {
    const lines = chunk.children;
    if (chunk.getBoundingClientRect().bottom > edge) {
      for (let i = 0; i < lines.length; i += 1) {
        const rect = lines[i]!.getBoundingClientRect();
        if (rect.bottom > edge) return { ...place, line: before + i, inset: rect.top - edge };
      }
    }
    before += lines.length;
  }
  return place;
}

/**
 * Puts `box` at `place`: its line at the same distance from the top edge, or its offset where the
 * box has no such line.
 */
export function restoreCodePlace(box: HTMLElement, place: CodePlace): void {
  const line = place.line < 0 ? undefined : box.querySelectorAll(`${CHUNKS} > .line`)[place.line];
  if (line === undefined) {
    box.scrollTop = place.top;
  } else {
    box.scrollTop +=
      line.getBoundingClientRect().top - box.getBoundingClientRect().top - place.inset;
  }
  box.scrollLeft = place.left;
}
