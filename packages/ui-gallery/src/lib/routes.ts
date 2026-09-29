/**
 * The site's routes, by path — pure, so the address rules are unit-tested and the app's switch
 * (app.tsx) stays a lookup. Every route is a full page load (each is also a screenshot target),
 * so there is no client-side router to keep in step.
 *
 *   /                 home: the app in a frame, the surface index
 *   /s/<surface>      one surface's page: the app at that route, framed per theme when comparing
 *   /c/<module>       a documentation module's page (Foundations): `#<board>` addresses a section,
 *                     `#parts`, `#tokens` and `#source` the sections after them
 *   /fonts            font specimens, declared faces and licences
 *
 * The framed app's own document, `app.html`, is not a route of the site: the frame's URL is
 * built by `appFrameSrc` (src/app/frame.ts), and it is also what "open standalone" opens.
 *
 * The view state (theme, mode, …) rides in the query on every route (lib/url-state.ts), so a link
 * built here carries it, and a reader who follows one keeps what they had set.
 */
import { MODULE_IDS } from "../../../ui/src/module";
import type { ModuleId } from "../../../ui/src/module";
import { isSurfaceId } from "../app/surfaces";
import type { SurfaceId } from "../app/surfaces";
import { formatGalleryQuery } from "./url-state";
import type { GalleryState } from "./url-state";

export type Route =
  | { kind: "home" }
  | { kind: "surface"; id: SurfaceId }
  | { kind: "module"; id: ModuleId }
  | { kind: "fonts" }
  /** `/s/<something>` or `/c/<something>` that names nothing: the page says so and lists what exists. */
  | { kind: "missing"; id: string }
  | { kind: "unknown"; path: string };

const isModuleId = (id: string): id is ModuleId => (MODULE_IDS as readonly string[]).includes(id);

/** The route a base-stripped path names (`/`, `/s/chat`, `/c/foundations`). */
export function parseRoute(path: string): Route {
  const clean = path.replace(/\/+$/, "") || "/";
  if (clean === "/") return { kind: "home" };
  if (clean === "/fonts") return { kind: "fonts" };
  const surface = /^\/s\/([^/]+)$/.exec(clean)?.[1];
  if (surface !== undefined) {
    const id = decodeURIComponent(surface);
    return isSurfaceId(id) ? { kind: "surface", id } : { kind: "missing", id };
  }
  const component = /^\/c\/([^/]+)$/.exec(clean)?.[1];
  if (component !== undefined) {
    const id = decodeURIComponent(component);
    return isModuleId(id) ? { kind: "module", id } : { kind: "missing", id };
  }
  return { kind: "unknown", path: clean };
}

/** `/s/<surface>`, without the base. */
export function surfacePath(id: string): string {
  return `/s/${encodeURIComponent(id)}`;
}

/** `/c/<module>`, without the base. */
export function modulePath(id: string): string {
  return `/c/${encodeURIComponent(id)}`;
}

/** A link to a surface page carrying the view state. A pinned compare belongs to its page, so a link drops it. */
export function surfaceHref(base: string, state: GalleryState, id: string): string {
  return `${base}${surfacePath(id)}${formatGalleryQuery(pageState(state))}`;
}

/** A link to a module page carrying the view state: `/c/<module>?theme=…#<board>`. */
export function moduleHref(base: string, state: GalleryState, id: string, anchor?: string): string {
  const query = formatGalleryQuery(pageState(state));
  return `${base}${modulePath(id)}${query}${anchor ? `#${encodeURIComponent(anchor)}` : ""}`;
}

/** A link to the home page, or to a section of it (`#surfaces`), carrying the view state. */
export function homeHref(base: string, state: GalleryState, anchor?: string): string {
  return `${base}/${formatGalleryQuery(pageState(state))}${anchor ? `#${anchor}` : ""}`;
}

/** A link to another route (`/fonts`) carrying the view state. */
export function routeHref(base: string, state: GalleryState, path: string): string {
  return `${base}${path}${formatGalleryQuery(pageState(state))}`;
}

/** The state a link to another page carries: the preferences and the site-wide compare, never one page's pin. */
export function pageState(state: GalleryState): GalleryState {
  return { ...state, compare: state.compare === true };
}

/** The section a page's hash names, or null for none. */
export function anchorOf(hash: string): string | null {
  const id = decodeURIComponent(hash.replace(/^#/, ""));
  return id === "" ? null : id;
}
