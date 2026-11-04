/**
 * The Markdown reader's outline, as numbers (node-testable; markdown-reader.tsx measures the DOM
 * and hands the measurements here).
 *
 * - Which headings make the outline, and how far each is indented: ranks 1 to 4, indented by how
 *   much deeper each is than the shallowest rank the document uses, so a document that starts at
 *   `##` does not open with an empty level.
 * - Which section is current while the reader scrolls. A fixed reading line near the top of the
 *   box would never reach a short last section — the box stops scrolling before its heading gets
 *   there — so the line slides from the top of the box towards its bottom as the scroll runs from
 *   start to end: every heading then gets a stretch of scrolling in which it is current, in order,
 *   and the end of the scroll is the last one's.
 * - Where the box scrolls to bring a heading to its top, a little below the edge so the heading
 *   does not sit flush against it, and never past either end of the scroll.
 */

/** Heading ranks the outline lists. */
export const OUTLINE_SELECTOR = "h1, h2, h3, h4";

/** Fewer headings than this, and the document is not worth an outline. */
export const OUTLINE_MIN_ENTRIES = 2;

/** Where the reading line starts at the top of the scroll, below the box's top edge (px). */
const READ_LINE_TOP = 24;
/** How far above the box's bottom edge the line stops at the end of the scroll (px). */
const READ_LINE_BOTTOM = 40;
/** The scroll is at its end within this many px. */
const END_SLACK = 2;
/** Room left above a heading the outline scrolls to (px). */
const HEADING_MARGIN = 8;

/** A heading as the page rendered it: its rank and its text. */
export interface HeadingFact {
  level: number;
  text: string;
}

/** One row of the outline. */
export interface OutlineEntry {
  /** The heading's rank, 1–4. */
  level: number;
  /** Its indent in the outline, 0–3. */
  depth: number;
  text: string;
}

/** The outline of these headings, in order; a heading with no text is left out. */
export function outlineEntries(headings: readonly HeadingFact[]): OutlineEntry[] {
  const named = headings
    .map((heading) => ({ level: heading.level, text: heading.text.replace(/\s+/g, " ").trim() }))
    .filter((heading) => heading.text !== "" && heading.level >= 1 && heading.level <= 4);
  if (named.length === 0) return [];
  const top = Math.min(...named.map((heading) => heading.level));
  return named.map((heading) => ({ ...heading, depth: heading.level - top }));
}

/** The scroll box's state, in px. */
export interface ScrollBox {
  /** How far it is scrolled. */
  top: number;
  /** The height of everything in it. */
  height: number;
  /** The height of its visible part. */
  viewport: number;
}

/**
 * The current section: the last heading the reading line has passed, the first one before any
 * has, the last one at the end of the scroll; -1 when there are none. `tops` are the headings'
 * offsets from the top of the scrolled content, in document order. A box that does not scroll
 * shows every section at once, and the first is current.
 */
export function activeEntry(tops: readonly number[], box: ScrollBox): number {
  if (tops.length === 0) return -1;
  const maxScroll = Math.max(0, box.height - box.viewport);
  if (maxScroll === 0) return 0;
  if (box.top >= maxScroll - END_SLACK) return tops.length - 1;
  const progress = Math.min(1, Math.max(0, box.top / maxScroll));
  const line =
    box.top +
    READ_LINE_TOP +
    Math.max(0, box.viewport - READ_LINE_TOP - READ_LINE_BOTTOM) * progress;
  let current = 0;
  for (let i = 0; i < tops.length; i++) {
    if (tops[i]! <= line) current = i;
  }
  return current;
}

/** Where the box scrolls to bring a heading `headingTop` px down the content to its top. */
export function scrollTargetFor(headingTop: number, box: Omit<ScrollBox, "top">): number {
  const maxScroll = Math.max(0, box.height - box.viewport);
  return Math.min(maxScroll, Math.max(0, Math.round(headingTop - HEADING_MARGIN)));
}
