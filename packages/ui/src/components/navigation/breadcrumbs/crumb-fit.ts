/**
 * How much of a path a one-row breadcrumb strip can show — pure, so the fit is unit-tested:
 * which trailing items fit across the strip, an estimate of an item's rendered width to fit them
 * by, and how a file name splits so that its stem gives way before its extension.
 */

/** The single item a run of dropped leading items collapses into. */
export const CRUMB_ELLIPSIS = "…";

/** What of a path the strip can show: the trailing items that fit, and whether anything was dropped ahead of them. */
export interface CrumbLayout {
  visible: string[];
  collapsed: boolean;
}

/**
 * Which items fit across `availablePx`, tail first. The last item — where the path ends — is
 * always kept, however long it is; leading items are taken while they fit and the rest collapse
 * into one ellipsis item, so whatever shares the row is never pushed onto a second one.
 * `measure` gives a rendered item's width in px, ellipsis item included, which is what lets a
 * test state a fixed per-character width.
 */
export function visibleCrumbSegments(
  segments: readonly string[],
  availablePx: number,
  measure: (text: string) => number,
): CrumbLayout {
  if (segments.length === 0) return { visible: [], collapsed: false };
  const last = segments.length - 1;
  const visible = [segments[last]!];
  let used = measure(segments[last]!);
  for (let i = last - 1; i >= 0; i -= 1) {
    // Taking this item still leaves an ellipsis ahead of it unless it is the first one, so the
    // ellipsis is priced into every step but the last.
    const ellipsis = i > 0 ? measure(CRUMB_ELLIPSIS) : 0;
    const width = measure(segments[i]!);
    if (used + width + ellipsis > availablePx) break;
    visible.unshift(segments[i]!);
    used += width;
  }
  return { visible, collapsed: visible.length < segments.length };
}

/**
 * An item's rendered width, approximated: the strip has no text metrics to measure against, so
 * one character at the strip's text size costs CRUMB_CHAR_PX (a wide character — CJK, full-width
 * punctuation — two of those) and the item itself costs its gap plus the separator drawn before
 * it. Erring wide is the safe direction: it collapses one item early rather than letting the row
 * outgrow its space.
 */
const CRUMB_CHAR_PX = 7;
const CRUMB_ITEM_PX = 16;
const WIDE_CHAR_RE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]/;

export function crumbItemWidth(text: string): number {
  let cells = 0;
  for (const ch of text) cells += WIDE_CHAR_RE.test(ch) ? 2 : 1;
  return CRUMB_ITEM_PX + cells * CRUMB_CHAR_PX;
}

/**
 * A file name split for display: the stem, and the extension with its dot still on it.
 *
 * Only a real extension counts. A leading dot is part of the name — `.gitignore` is all stem —
 * and a name with no dot has no extension at all. Splitting it lets the stem ellipsize while the
 * extension stays: the extension is the shortest part and says what kind of thing this is, so it
 * is the last thing worth losing when the row runs out of room.
 */
export function splitFileName(name: string): { stem: string; ext: string } {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? { stem: name.slice(0, dot), ext: name.slice(dot) } : { stem: name, ext: "" };
}
