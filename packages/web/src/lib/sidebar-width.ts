/**
 * The pinned sidebar's width as the reader dragged it: a layout preference of this browser, in
 * px, kept where the dock's width is kept. Nothing stored, or anything that does not read as a
 * positive number, is the theme's own width; a double click on the handle clears the key, so the
 * column follows the theme and the text size again. The shell brings the width within the
 * current window's bounds as it draws it, so a value carried over from a larger screen is not
 * rewritten here.
 *
 * It is written once per gesture (a drag's release, an arrow key), never per frame: the shell
 * follows the pointer on its own and hands over only the width to keep.
 */
import { useCallback, useState } from "react";

export const SIDEBAR_WIDTH_KEY = "penguin.sidebarWidth";

/** Tolerant parse of the stored width: null for nothing stored and for anything not a positive number. */
export function parseSidebarWidth(raw: string | null): number | null {
  if (raw === null) return null;
  const value = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function readSidebarWidth(): number | null {
  try {
    // localStorage is resolved inside the try: merely touching it throws when site data is
    // blocked, and this runs from a useState initializer.
    return parseSidebarWidth(localStorage.getItem(SIDEBAR_WIDTH_KEY));
  } catch {
    return null;
  }
}

function writeSidebarWidth(width: number | null): void {
  try {
    if (width === null) localStorage.removeItem(SIDEBAR_WIDTH_KEY);
    else localStorage.setItem(SIDEBAR_WIDTH_KEY, String(Math.round(width)));
  } catch {
    /* best-effort persistence (quota limits / private browsing) */
  }
}

/** The stored width and its setter, in the shape `AppShell`'s `navResize` takes. */
export function useSidebarWidth(): {
  width: number | null;
  onChange: (width: number | null) => void;
} {
  const [width, setWidth] = useState(readSidebarWidth);
  const onChange = useCallback((next: number | null) => {
    setWidth(next);
    writeSidebarWidth(next);
  }, []);
  return { width, onChange };
}
