/**
 * The site's page addresses, without the base: one page per surface (`/s/<surface>`), one per
 * library topic (`/c/<topic>`), and the three fonts pages (`/fonts`, `/fonts/specimens`,
 * `/fonts/licences`). lib/routes.ts parses these addresses and builds the links to them.
 *
 * No value import beyond the pure data in surfaces.ts and topics.ts, so the Vite config can read
 * this file as well: a build writes a copy of the gallery's document at every address
 * `deepPagePaths` lists, and a static host — the public site serves the gallery under
 * `/gallery/` — answers a reload or a quoted link with the page rather than its 404 page.
 */
import { SURFACE_IDS } from "../app/surfaces";
import { TOPIC_IDS } from "../library/topics";

export const FONTS_PAGE_IDS = ["defaults", "specimens", "licences"] as const;
export type FontsPageId = (typeof FONTS_PAGE_IDS)[number];

/** `/s/<surface>`, without the base. */
export function surfacePath(id: string): string {
  return `/s/${encodeURIComponent(id)}`;
}

/** `/c/<topic>`, without the base. */
export function topicPath(id: string): string {
  return `/c/${encodeURIComponent(id)}`;
}

/** `/fonts`, `/fonts/specimens` or `/fonts/licences`, without the base. */
export function fontsPath(page: FontsPageId): string {
  return page === "defaults" ? "/fonts" : `/fonts/${page}`;
}

/** Every page's address except the home page's, which is the document's own (`/`). */
export function deepPagePaths(): string[] {
  return [
    ...SURFACE_IDS.map(surfacePath),
    ...TOPIC_IDS.map(topicPath),
    ...FONTS_PAGE_IDS.map(fontsPath),
  ];
}
