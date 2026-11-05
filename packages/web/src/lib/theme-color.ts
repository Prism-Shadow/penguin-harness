/**
 * The page's theme colour: the canvas the current theme and mode actually paint, written into
 * every `<meta name="theme-color">`.
 *
 * A host draws its own chrome in this colour — a phone browser's toolbar, and the desktop shell's
 * window controls, which sit over the page's top band and pick light or dark symbols from it. The
 * static tags in index.html can only follow the system's light/dark preference, and the app's own
 * mode setting may differ from it.
 */
export function syncThemeColor(doc: Document): void {
  const canvas = doc.defaultView?.getComputedStyle(doc.body).backgroundColor ?? "";
  // A body with no fill (a host page without the theme's sheet) has no colour to report.
  if (canvas === "" || canvas === "transparent" || canvas === "rgba(0, 0, 0, 0)") return;
  for (const meta of doc.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    meta.content = canvas;
  }
}
