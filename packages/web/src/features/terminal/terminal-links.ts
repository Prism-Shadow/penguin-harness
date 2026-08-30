/**
 * Opening a link a terminal printed.
 *
 * Two kinds arrive here and both used to be broken:
 *
 * - **A URL in the output**, found by the web-links addon. Its built-in handler opens a
 *   BLANK window first (`window.open()` with no argument), clears `opener`, then assigns
 *   `location.href`. In a browser that is a way to get an opener-less tab; inside the
 *   desktop shell it is a link to `about:blank`, which the shell's window-open handler sees
 *   as an external address and hands to the system browser — so the address bar said
 *   `about:` and the real link never opened. `noopener` on a real `window.open` does the
 *   same job in one step, and hands the shell the address it is actually meant to route.
 * - **An OSC 8 hyperlink**, which is how a program that knows it is on a capable terminal
 *   writes a link — `gh`, and the agent CLIs printing a pull request. xterm routes those to
 *   `linkHandler`, and with none set it falls back to a `confirm()` warning; the link was
 *   effectively not clickable. Wiring the same opener makes both kinds behave alike.
 *
 * The scheme check is the point, not decoration: a terminal's output is not trusted input.
 * A program can print `javascript:` or `data:` as easily as `https:`, and this is exactly
 * the sink xterm's own documentation warns to validate.
 */

/** Whether a link a terminal printed may be opened at all. */
export function isOpenableLink(uri: string): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false; // Not absolute: nothing to navigate to.
  }
  return url.protocol === "http:" || url.protocol === "https:";
}

/**
 * Opens a link from terminal output in a new tab, or does nothing when it is not one of the
 * two schemes a page may be at. Silent on refusal: the output that produced it is a
 * program's, not the reader's, and there is nothing for them to act on.
 */
export function openTerminalLink(uri: string): void {
  if (!isOpenableLink(uri)) return;
  window.open(uri, "_blank", "noopener,noreferrer");
}
