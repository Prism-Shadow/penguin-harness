/**
 * Putting a text selection back after a menu acted on it — shared by the two menus that act on
 * selected text: the Files panel preview's and the conversation's.
 *
 * Both menus hand the selection to the composer, and the composer focuses its textarea to take
 * it; focusing a text field drops whatever the document had selected. Contributing a quote to
 * the conversation is not an edit to what was quoted, and losing the highlight would cost the
 * reader their place, so the highlight is restored by hand afterwards.
 */

/**
 * Puts `range` back as the document's one selection, a frame after the caller hands text to
 * the composer: the composer focuses its textarea inside a requestAnimationFrame of its own,
 * scheduled first, and that focus is what clears the selection this restores.
 *
 * A range whose ends have since left the document is dropped rather than re-applied — the
 * content it was read from is no longer on screen, and re-selecting detached nodes would
 * either throw or select nothing.
 */
export function restoreSelection(range: Range): void {
  requestAnimationFrame(() => {
    if (!range.startContainer.isConnected || !range.endContainer.isConnected) return;
    const selection = window.getSelection();
    if (selection === null) return;
    selection.removeAllRanges();
    selection.addRange(range);
  });
}
