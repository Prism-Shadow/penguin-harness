/**
 * The package's own words: the accessibility fallbacks a primitive needs when its caller passes
 * none, and nothing else.
 *
 * Copy is the caller's. A title, a status label, an empty state's sentence or a tooltip that
 * names something in the app arrives as a prop, because only the app knows its concepts and its
 * dictionaries. What is left is the handful of strings a primitive announces on its own — the
 * close cross's name, the "Copied" confirmation a live region reads out, a busy fallback — and a
 * component that forgot them would be silent to a screen reader. Those live here, English by
 * default; the app injects its own per interface language through {@link UiStringsProvider},
 * once, around its tree.
 *
 * A key joins the interface when a component that moves into the package needs one; the app's
 * mapping from its dictionaries must then cover it in every language it ships.
 */
import { createContext, createElement, useContext } from "react";
import type { ReactElement, ReactNode } from "react";

export interface UiStrings {
  /** The close cross's accessible name (`CloseButton`). */
  close: string;
  /** What a live region announces once something has been copied to the clipboard. */
  copied: string;
  /** A busy fallback a primitive may announce while its caller has named nothing. */
  loading: string;
}

/** The English fallbacks, used wherever no provider is mounted (a test, a stand-alone page). */
export const DEFAULT_UI_STRINGS: UiStrings = {
  close: "Close",
  copied: "Copied",
  loading: "Loading…",
};

const UiStringsContext = createContext<UiStrings>(DEFAULT_UI_STRINGS);

/** Supplies the app's words for the whole tree below it; mount it once, per interface language. */
export function UiStringsProvider({
  strings,
  children,
}: {
  strings: UiStrings;
  children?: ReactNode;
}): ReactElement {
  return createElement(UiStringsContext.Provider, { value: strings }, children);
}

/** The words in effect: the nearest provider's, or the English defaults when none is mounted. */
export function useUiStrings(): UiStrings {
  return useContext(UiStringsContext);
}
