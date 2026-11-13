/**
 * A compiled page's HTML as the server sends it: the page runtime's stylesheet and import map
 * first in its `<head>`.
 *
 * The emitted code imports React and the shared UI package by bare specifier, which a browser
 * resolves only through an import map that precedes the page's first module script. So the
 * map is written into the HTML as it is served, never added by the Web App's frame, which
 * reaches the document only once it has loaded. Every URL is relative to the page — `../`
 * once per folder below `ui/` and once for `ui/` itself — so the same HTML works under
 * `/api/…` and under a machine's `/server/<id>/api/…`.
 */
import type { WorkbenchUiRuntime } from "../mechanisms/workbenches.js";

/** Marks the stylesheet written here; the frame leaves its own base stylesheet out of such a page. */
export const PENGUIN_UI_ATTR = "data-penguin-ui";

const escapeAttr = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** Where the tags go: after the `<head>` tag, else after `<html>`, else after the doctype, else first. */
const OPENINGS = [/<head(?=[\s>])[^>]*>/i, /<html(?=[\s>])[^>]*>/i, /<!doctype[^>]*>/i];

/** `html` with the runtime's stylesheet and import map for a page `depth` folders below `ui/`. */
export function withUiRuntime(html: string, depth: number, runtime: WorkbenchUiRuntime): string {
  const base = `${"../".repeat(depth + 1)}sdk/ui/`;
  const imports = Object.fromEntries(
    Object.entries(runtime.imports).map(([specifier, file]) => [specifier, base + file]),
  );
  // `<` escaped so nothing in the map can close the script element early.
  const map = JSON.stringify({ imports }).replace(/</g, "\\u003c");
  const tags =
    `<link rel="stylesheet" href="${escapeAttr(base + runtime.stylesheet)}" ${PENGUIN_UI_ATTR}>` +
    `<script type="importmap">${map}</script>`;
  for (const opening of OPENINGS) {
    const found = opening.exec(html);
    if (found === null) continue;
    const at = found.index + found[0].length;
    return html.slice(0, at) + tags + html.slice(at);
  }
  return tags + html;
}
