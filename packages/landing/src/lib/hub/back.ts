/**
 * The way back from a hub entry's page to its list.
 *
 * A card on a list page opens its entry with the list's address in the new history entry's
 * state (`listState`). The entry page's back control (`backTarget`) then steps back through
 * history to that same list, so it comes back as the visitor left it: the query, the facets and
 * the order live in its address, and its scroll is handed back here. A page opened any other way
 * (a deep link, a link from another page, a new tab) has no such state, and its back control
 * opens the list afresh.
 *
 * The scroll is remembered per history entry: a list page notes where it was on every click
 * inside the page (the click that leaves it is the last), and the layout puts it back when
 * history returns to that entry (`useListReturn`), whether through the back control or the
 * browser's own Back button.
 */
import { useEffect } from "react";
import { NavigationType } from "react-router";

/** Where a list page stood: its path and its query string (`?q=…`, or empty). */
export interface ListOrigin {
  pathname: string;
  search: string;
}

/** The history state a list's card puts on the entry page it opens. */
export const listState = ({ pathname, search }: ListOrigin) => ({
  hubList: { pathname, search },
});

/**
 * Where an entry page's back control leads, given the list it belongs to and the page's history
 * state: `href` is the link's own address (the list as the visitor left it, or the bare list),
 * and `history` says the entry right behind this one is that list, so stepping back reaches it.
 */
export function backTarget(listPath: string, state: unknown): { href: string; history: boolean } {
  const origin = (state as { hubList?: Partial<ListOrigin> } | null | undefined)?.hubList;
  if (origin?.pathname === listPath) {
    const search = typeof origin.search === "string" ? origin.search : "";
    return { href: `${listPath}${search}`, history: true };
  }
  return { href: listPath, history: false };
}

const scrolls = new Map<string, number>();

/** Notes how far a list page is scrolled, under its history entry's key. */
export function rememberScroll(key: string, y: number): void {
  scrolls.set(key, y);
}

/** How far the list at this history entry was scrolled when it was left, if it was noted. */
export function recallScroll(key: string): number | undefined {
  return scrolls.get(key);
}

/** The last history entry the return was handled for, kept across the locale-keyed remount. */
let handledKey = "";

/**
 * In the layout, after the route scroll: when history steps back (or forward) to a list entry
 * whose scroll was noted, scroll there. Handled once per arrival, like the route scroll, so the
 * remount a language switch causes leaves the page where it is.
 */
export function useListReturn({ key }: { key: string }, navigationType: NavigationType): void {
  useEffect(() => {
    if (key === handledKey) return;
    handledKey = key;
    if (navigationType !== NavigationType.Pop) return;
    const y = recallScroll(key);
    if (y !== undefined) window.scrollTo(0, y);
  }, [key, navigationType]);
}
