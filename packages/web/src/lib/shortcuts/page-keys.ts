/**
 * The plain keys a page may claim on its own — the ones no chord covers because they belong to
 * the page's own surface: a board's `/` for its search box, `N` for a new item, Escape to leave
 * what is on screen.
 *
 * A page never reads a modifier itself (see test/shortcut-guard.test.ts): a hand-written
 * `event.ctrlKey` check is a binding the settings page cannot see and one that is wrong on a
 * Mac, so every chord stays in the registry and is matched against the user's keymap. What is
 * left for a page is a *bare* key, which is exactly what this reads: a chord — any modifier at
 * all, or the platform's ⌘/Ctrl — is the registry's, and the page steps aside with null.
 *
 * The same distinction decides the other two questions a page key has to answer: whether a
 * field has focus (a keystroke meant for the search box must not also open a dialog) and
 * whether something modal is already up.
 */

/**
 * The bare key of an event, or null when it carries a modifier — Shift included, since a
 * shifted key is a different key ("N" and "n" are one command; Shift+F10 is not).
 */
export function bareKey(event: KeyboardEvent): string | null {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return null;
  return event.key;
}

/** Whether the keystroke belongs to a field the reader is typing in. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable
  );
}
