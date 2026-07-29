/**
 * The image attachment line — `[attached image: <path|URL>]`.
 *
 * The odd one out in this module: not a `[tag]…[/tag]` block but a single self-closing line
 * carrying an address. It stands in for an image folded out of the input — one line per image,
 * appended to the user text (see `imagesToScratchpadPaths`), pointing at a session-scratchpad
 * file or at an http(s) URL referenced as-is.
 *
 * Producer and parser sit together because the line crosses a package boundary: core writes it,
 * the Web reads it back to restore the thumbnail. Reworded on one side only, the picture stops
 * rendering with nothing to say so — no error, no failing test, the image simply isn't there.
 */

/** Everything before the address. Both functions below are built from it, so they cannot drift. */
const PREFIX = "[attached image: ";

/** The line standing in for a folded-out image; `address` is a local path or an http(s) URL. */
export function attachedImageLine(address: string): string {
  return `${PREFIX}${address}]`;
}

/** Whether a text carries any attachment line — a cheap guard before splitting it into lines. */
export function hasAttachedImageLine(text: string): boolean {
  return text.includes(PREFIX);
}

/**
 * The address inside a single attachment line, or null for any other line (which the render
 * layers keep as ordinary text — a "could not be saved" note, say, or a line the user typed).
 */
export function parseAttachedImageLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith(PREFIX) || !trimmed.endsWith("]")) return null;
  const address = trimmed.slice(PREFIX.length, -1);
  return address.length > 0 ? address : null;
}
