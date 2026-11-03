/**
 * Keyboard movement through the address bar's history suggestions, as a pure function.
 *
 * The highlight is a row index, or -1 for none: the text the user typed. Down and Up cycle
 * through the rows and back to the typed text, the way a browser's address bar does, so the
 * user can always return to what they wrote. Home and End are left alone — in a text field
 * they move the caret.
 */

/** Nothing highlighted: Enter goes to the typed text. */
export const NO_HIGHLIGHT = -1;

/**
 * The next highlight after `key`, or null when the key is not one the list handles (the
 * input then keeps it). With no rows there is nothing to move through.
 */
export function moveHighlight(current: number, count: number, key: string): number | null {
  if (key !== "ArrowDown" && key !== "ArrowUp") return null;
  if (count <= 0) return null;
  // Positions run -1 (the typed text), 0 … count-1; a step wraps across all count + 1 of them.
  const span = count + 1;
  const position = Math.min(Math.max(current, NO_HIGHLIGHT), count - 1) + 1;
  const step = key === "ArrowDown" ? 1 : -1;
  return ((position + step + span) % span) - 1;
}
