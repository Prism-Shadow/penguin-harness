/**
 * How an icon reaches a page: as an image this server serves by URL, never as markup in a
 * listing. A listing names the URL with the image's content revision (`?rev=`), so the image is
 * cached for good and a changed icon is a new URL; the route answers with the bytes under the type
 * they are (core reads them by their bytes, never by a file name).
 *
 * The answer is sandboxed for the one case an image is not drawn as one: an SVG opened on its own
 * in a tab. `Content-Security-Policy: …; sandbox` puts that document in an opaque origin with no
 * script, so even an SVG that slipped past the deny-list could not act on this origin, and
 * `nosniff` keeps a browser from reading the bytes as anything but the declared type.
 */
import { createHash } from "node:crypto";
import { ICON_CONTENT_TYPES } from "@prismshadow/penguin-core";
import type { IconImage } from "@prismshadow/penguin-core";
import type { IconRef } from "../api/types.js";
import { HttpError } from "./errors.js";

/** The headers every icon is answered with, beside its content type. */
export const ICON_HEADERS: Readonly<Record<string, string>> = {
  "Cache-Control": "private, max-age=31536000, immutable",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  "Cross-Origin-Resource-Policy": "same-origin",
};

/** The content revision of an icon: what its URL carries, so a new image is a new URL. */
export function iconRev(icon: IconImage): string {
  return createHash("sha256").update(icon.bytes).digest("hex").slice(0, 12);
}

/** An icon as a listing names it: the route that serves it, with its revision, and how to draw it. */
export function iconRef(route: string, icon: IconImage): IconRef {
  const join = route.includes("?") ? "&" : "?";
  return { url: `${route}${join}rev=${iconRev(icon)}`, tint: icon.tint };
}

/** The answer of an icon route: the image, or 404 `icon_not_found` when there is none that reads clean. */
export function iconResponse(icon: IconImage | undefined): Response {
  if (icon === undefined) throw new HttpError(404, "icon_not_found", "No icon here.");
  return new Response(new Uint8Array(icon.bytes), {
    status: 200,
    headers: { "Content-Type": ICON_CONTENT_TYPES[icon.format], ...ICON_HEADERS },
  });
}
