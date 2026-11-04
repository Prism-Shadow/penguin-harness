/**
 * The Markdown reader's find (the UI package's `MarkdownReader`) on the user's keymap: it opens on
 * the `find.open` binding while the reader has the focus, and its button names that binding. Every
 * surface that reads Markdown through the reader — the plugin detail, the file browser, the Files
 * panel, the handbook — passes these two, so a rebinding in the settings reaches them all.
 */
import { isShortcut } from "./shortcuts/match";
import { currentPlatform } from "./shortcuts/platform";
import { keymap } from "./shortcuts/store";
import { useShortcutLabel } from "./shortcuts/use-keymap";

/** Whether a keydown is the user's `find.open` chord, read from the keymap at the keystroke. */
export function isFindOpenKey(event: KeyboardEvent): boolean {
  return isShortcut(event, keymap(), "find.open", currentPlatform());
}

/** The reader's find props: the matcher, and the chord its button's hint names. */
export function useReaderFind(): {
  isFindKey: (event: KeyboardEvent) => boolean;
  findShortcut: string | null;
} {
  return { isFindKey: isFindOpenKey, findShortcut: useShortcutLabel("find.open") };
}
