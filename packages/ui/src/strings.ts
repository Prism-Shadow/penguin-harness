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
  /** The name of a password field's reveal toggle while the value is masked (`PasswordInput`). */
  showPassword: string;
  /** The same toggle's name while the value is shown. */
  hidePassword: string;
  /** The name of a search box's clear button (`SearchInput`). */
  clearSearch: string;
  /** The "?" disclosure's name when it names no subject, and a help fold's row text. */
  moreInfo: string;
  /** The same name with the subject folded in ("More info: Vault"): InfoPopover, HelpFold. */
  moreInfoAbout: (subject: string) => string;
  /** The toast stack's name as a live region and landmark (`Toaster`). */
  notifications: string;
  /** What pressing a toast does, read after its text: it dismisses it (`Toaster`). */
  dismiss: string;
  /** The name and tooltip of a code block's copy button (`CodeBlock`). */
  copyCode: string;
  /** A collapsed group header's name: pressing it expands the group (`GroupHeader`). */
  expand: string;
  /** An expanded group header's name: pressing it collapses the group (`GroupHeader`). */
  collapse: string;
  /** A "more" row's text and name when its caller counts nothing (`MoreRow`, `FolderSection`). */
  more: string;
  /** The row that folds a revealed list back to its first page (`FolderSection`). */
  fewer: string;
  /** A pager's step back, as its name and tooltip (`Pager`). */
  previous: string;
  /** A pager's step forward, as its name and tooltip (`Pager`). */
  next: string;
  /** What a pager's "2/5" readout says aloud: the page, then how many there are (`Pager`). */
  pagePosition: (page: number, pageCount: number) => string;
}

/** The English fallbacks, used wherever no provider is mounted (a test, a stand-alone page). */
export const DEFAULT_UI_STRINGS: UiStrings = {
  close: "Close",
  copied: "Copied",
  loading: "Loading…",
  showPassword: "Show password",
  hidePassword: "Hide password",
  clearSearch: "Clear search",
  moreInfo: "More info",
  moreInfoAbout: (subject) => `More info: ${subject}`,
  notifications: "Notifications",
  dismiss: "Dismiss",
  copyCode: "Copy code",
  expand: "Expand",
  collapse: "Collapse",
  more: "More",
  fewer: "Show less",
  previous: "Previous page",
  next: "Next page",
  pagePosition: (page, pageCount) => `Page ${page} of ${pageCount}`,
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
