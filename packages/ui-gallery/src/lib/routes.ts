/**
 * The site's routes, by path — pure, so the address rules are unit-tested and the app's switch
 * (app.tsx) stays a lookup. Every route is a full page load (each is also a screenshot target),
 * so there is no client-side router to keep in step.
 *
 *   /                 home: the app in a frame, the surface and library indexes
 *   /s/<surface>      界面: one surface's page, the app framed at that route
 *   /c/<topic>        基础: one component library page, the topic's board framed
 *   /fonts            字体: each theme's default faces and the current choice
 *   /fonts/specimens  the specimens at the five sizes and the declared faces
 *   /fonts/licences   the bundled faces' licence texts
 *
 * The framed documents, `app.html` and `lib.html`, are not routes of the site: their URLs are
 * built by `appFrameSrc` (src/app/frame.ts) and `libraryFrameSrc` (src/library/frame.ts), and
 * those are also what "open standalone" opens.
 *
 * The view state (theme, mode, …) rides in the query on every route (lib/url-state.ts), so a link
 * built here carries it, and a reader who follows one keeps what they had set.
 */
import { isSurfaceId } from "../app/surfaces";
import type { SurfaceId } from "../app/surfaces";
import { isTopicId } from "../library/topics";
import type { TopicId } from "../library/topics";
import { formatGalleryQuery } from "./url-state";
import type { GalleryState } from "./url-state";

export const FONTS_PAGE_IDS = ["defaults", "specimens", "licences"] as const;
export type FontsPageId = (typeof FONTS_PAGE_IDS)[number];

export type Route =
  | { kind: "home" }
  | { kind: "surface"; id: SurfaceId }
  | { kind: "topic"; id: TopicId }
  | { kind: "fonts"; page: FontsPageId }
  /** `/s/<something>`, `/c/<something>` or `/fonts/<something>` that names nothing: the page says so. */
  | { kind: "missing"; id: string }
  | { kind: "unknown"; path: string };

const isFontsPage = (id: string): id is FontsPageId =>
  (FONTS_PAGE_IDS as readonly string[]).includes(id);

/** The route a base-stripped path names (`/`, `/s/chat`, `/c/buttons`, `/fonts/specimens`). */
export function parseRoute(path: string): Route {
  const clean = path.replace(/\/+$/, "") || "/";
  if (clean === "/") return { kind: "home" };
  if (clean === "/fonts") return { kind: "fonts", page: "defaults" };
  const fonts = /^\/fonts\/([^/]+)$/.exec(clean)?.[1];
  if (fonts !== undefined) {
    const id = decodeURIComponent(fonts);
    return isFontsPage(id) ? { kind: "fonts", page: id } : { kind: "missing", id };
  }
  const surface = /^\/s\/([^/]+)$/.exec(clean)?.[1];
  if (surface !== undefined) {
    const id = decodeURIComponent(surface);
    return isSurfaceId(id) ? { kind: "surface", id } : { kind: "missing", id };
  }
  const topic = /^\/c\/([^/]+)$/.exec(clean)?.[1];
  if (topic !== undefined) {
    const id = decodeURIComponent(topic);
    return isTopicId(id) ? { kind: "topic", id } : { kind: "missing", id };
  }
  return { kind: "unknown", path: clean };
}

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

/** A link to a surface page carrying the view state. */
export function surfaceHref(base: string, state: GalleryState, id: string): string {
  return `${base}${surfacePath(id)}${formatGalleryQuery(state)}`;
}

/** A link to a library page carrying the view state: `/c/<topic>?theme=…#<group>`. */
export function topicHref(base: string, state: GalleryState, id: string, anchor?: string): string {
  const query = formatGalleryQuery(state);
  return `${base}${topicPath(id)}${query}${anchor ? `#${encodeURIComponent(anchor)}` : ""}`;
}

/** A link to a fonts page carrying the view state. */
export function fontsHref(base: string, state: GalleryState, page: FontsPageId): string {
  return `${base}${fontsPath(page)}${formatGalleryQuery(state)}`;
}

/** A link to the home page, or to a section of it (`#surfaces`), carrying the view state. */
export function homeHref(base: string, state: GalleryState, anchor?: string): string {
  return `${base}/${formatGalleryQuery(state)}${anchor ? `#${anchor}` : ""}`;
}

/** The section a page's hash names, or null for none. */
export function anchorOf(hash: string): string | null {
  const id = decodeURIComponent(hash.replace(/^#/, ""));
  return id === "" ? null : id;
}
