/**
 * The height an undrawn chunk of wrapped lines stands at (prose.css's `.line-chunk`): the rows its
 * lines' characters fill at the code layer's width, less the gutter. It is written to each chunk
 * as `--chunk-rows`, so a resize restyles the chunks and re-renders nothing, and in the layout
 * phase, so a caller that puts the surface at a line as it mounts measures chunks already at
 * their heights.
 *
 * It is an estimate: a monospace face advances about six tenths of its size a character, and a
 * line breaks at a word, so it runs a little over. What depends on a position is carried as a
 * line (code-place.ts), never as this sum.
 */
import { useEffect, useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";

/** A monospace character's advance over its font size. */
const CELL_ADVANCE = 0.6;
/** From here on a character takes two cells: CJK, Hangul, the full-width forms. */
const WIDE_FROM = 0x2e80;

/** The cells `text` takes on one row: a wide character two, a tab four (prose.css's tab-size). */
export function cells(text: string): number {
  let count = text.length;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code >= WIDE_FROM) count += 1;
    else if (code === 9) count += 3;
  }
  return count;
}

/** The rows `lines` fill when each wraps at `cols` cells: one a line at least. */
function wrappedRows(lines: readonly string[], cols: number): number {
  let rows = 0;
  for (const line of lines) rows += Math.max(1, Math.ceil(cells(line) / cols));
  return rows;
}

/** What the estimate reads and writes. */
export interface WrapRowTargets {
  /** The surface, observed for its width. */
  surface: RefObject<HTMLElement | null>;
  /** The code layer: its font and padding size a column, and its chunks take the rows. */
  layer: RefObject<HTMLElement | null>;
}

/**
 * Keeps `--chunk-rows` on the chunks of a wrapped surface of `lines` (null: not wrapped, nothing
 * to estimate). `chunkLines` is the lines a chunk holds, `gutterCells` the gutter's width in
 * characters.
 */
export function useWrapRows(
  targets: WrapRowTargets,
  lines: readonly string[] | null,
  chunkLines: number,
  gutterCells: number,
): void {
  /** What the chunks were last estimated for. */
  const done = useRef<{ layer: HTMLElement | null; cols: number; lines: readonly string[] | null }>(
    { layer: null, cols: 0, lines: null },
  );
  const estimate = (): void => {
    const layer = targets.layer.current;
    if (lines === null || layer === null) return;
    const style = getComputedStyle(layer);
    const cell = parseFloat(style.fontSize) * CELL_ADVANCE;
    const width =
      layer.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    if (!(cell > 0) || !(width > 0)) return;
    const cols = Math.max(1, Math.floor(width / cell) - gutterCells);
    const last = done.current;
    if (last.layer === layer && last.cols === cols && last.lines === lines) return;
    done.current = { layer, cols, lines };
    const chunks = layer.querySelectorAll<HTMLElement>(".line-chunk");
    for (let i = 0; i < chunks.length; i += 1) {
      const rows = String(wrappedRows(lines.slice(i * chunkLines, (i + 1) * chunkLines), cols));
      // Only a changed value is written: a write restyles the chunk's lines.
      const chunk = chunks[i]!;
      if (chunk.style.getPropertyValue("--chunk-rows") !== rows) {
        chunk.style.setProperty("--chunk-rows", rows);
      }
    }
  };
  // Every commit: the lines may be new ones, and the chunks new elements.
  useLayoutEffect(estimate);
  useEffect(() => {
    const surface = targets.surface.current;
    if (lines === null || surface === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(estimate);
    observer.observe(surface);
    return () => observer.disconnect();
    // `estimate` reads the latest lines through this render's closure; the observer is rebuilt
    // when they change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, chunkLines, gutterCells]);
}
