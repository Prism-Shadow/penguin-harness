/**
 * A tab's page size as the toolbar offers it: fitting the panel, one of a few common desktop sizes,
 * or a custom one. The size is the server's (the tab list carries it, and an agent's `penguin
 * browser resize` changes the same one), so a choice here is a request, and the button follows
 * the next tab list rather than guessing ahead of it.
 */
import type { BuiltinBrowserTab } from "@prismshadow/penguin-server/api";
import { apiErrorText, toastApiError } from "@prismshadow/penguin-web-plugin";
import { resizeBuiltinBrowserTab } from "./api";
import { fitScale, type Size } from "./geometry";
import { S } from "./strings";

/** The sizes the menu offers by name: common laptop and desktop viewports. */
export const PAGE_SIZE_PRESETS: readonly Size[] = [
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
];

/** The edges a page size may have, CSS px (the server's own bounds). */
export const PAGE_SIZE_MIN = 200;
export const PAGE_SIZE_MAX = 4096;

/** A tab's fixed size, or null while it fits the panel. */
export function fixedPageSize(tab: BuiltinBrowserTab | null): Size | null {
  const viewport = tab?.viewport;
  return viewport === undefined ? null : { width: viewport.width, height: viewport.height };
}

export function sameSize(a: Size | null, b: Size | null): boolean {
  return a !== null && b !== null && a.width === b.width && a.height === b.height;
}

/** A whole number of CSS px within the bounds, read from a field; null for anything else. */
export function pageEdge(raw: string): number | null {
  if (!/^\s*\d{1,5}\s*$/.test(raw)) return null;
  const value = Number(raw);
  return value >= PAGE_SIZE_MIN && value <= PAGE_SIZE_MAX ? value : null;
}

/**
 * The button's tooltip: fitting the panel, or the fixed size with the zoom it is drawn at in a
 * slot of `slot` (null where the page is not drawn in the panel: the user's Chrome).
 */
export function pageSizeLabel(size: Size | null, slot: Size | null): string {
  if (size === null) return S.builtinBrowser.pageSizeFit;
  const percent =
    slot === null || slot.width <= 0 || slot.height <= 0
      ? null
      : Math.round(fitScale(slot, size) * 100);
  return S.builtinBrowser.pageSizeFixed(size.width, size.height, percent);
}

/** Asks the server for a tab's new size (null: the panel's again); a failure says why. */
export async function resizeTab(tabId: number, size: Size | null): Promise<boolean> {
  try {
    await resizeBuiltinBrowserTab(tabId, size === null ? { fit: true } : size);
    return true;
  } catch (err) {
    toastApiError(err, { text: S.builtinBrowser.resizeFailed(apiErrorText(err)) });
    return false;
  }
}
