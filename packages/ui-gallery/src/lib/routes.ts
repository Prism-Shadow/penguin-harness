/**
 * The site's routes, by path — pure, so the address rules are unit-tested and the app's switch
 * (app.tsx) stays a lookup. Every route is a full page load (each is also an iframe or a
 * screenshot target), so there is no client-side router to keep in step.
 *
 *   /                 home: the intro, the app shell, the component index
 *   /c/<module>       one module's page; `#<variant>` addresses a variant's section, `#parts`,
 *                     `#tokens` and `#source` the sections after them, `#<part-id>` a part
 *   /embed            one module variant or one part demo, alone (pages/embed.tsx)
 *   /screens/<name>   a full-viewport composite
 *   /fonts            font specimens, declared faces and licences
 *
 * The view state (theme, mode, …) rides in the query on every route (lib/url-state.ts), so a link
 * built here carries it, and a reader who follows one keeps what they had set.
 */
import { MODULE_IDS } from "../../../ui/src/module";
import type { ModuleId } from "../../../ui/src/module";
import { formatGalleryQuery } from "./url-state";
import type { GalleryState } from "./url-state";

export type Route =
  | { kind: "home" }
  | { kind: "module"; id: ModuleId }
  | { kind: "embed" }
  | { kind: "screen"; name: string }
  | { kind: "fonts" }
  /** `/c/<something>` that names no module: the page says so and lists the modules. */
  | { kind: "missing"; id: string }
  | { kind: "unknown"; path: string };

const isModuleId = (id: string): id is ModuleId => (MODULE_IDS as readonly string[]).includes(id);

/** The route a base-stripped path names (`/`, `/c/status`, `/screens/chat`). */
export function parseRoute(path: string): Route {
  const clean = path.replace(/\/+$/, "") || "/";
  if (clean === "/") return { kind: "home" };
  if (clean === "/embed") return { kind: "embed" };
  if (clean === "/fonts") return { kind: "fonts" };
  const screen = /^\/screens\/([^/]+)$/.exec(clean)?.[1];
  if (screen !== undefined) return { kind: "screen", name: decodeURIComponent(screen) };
  const component = /^\/c\/([^/]+)$/.exec(clean)?.[1];
  if (component !== undefined) {
    const id = decodeURIComponent(component);
    return isModuleId(id) ? { kind: "module", id } : { kind: "missing", id };
  }
  return { kind: "unknown", path: clean };
}

/** `/c/<module>`, without the base. */
export function modulePath(id: string): string {
  return `/c/${encodeURIComponent(id)}`;
}

/**
 * A link to a module page carrying the view state: `/c/<module>?theme=…#<variant>`. Picks and a
 * pinned compare belong to the page they were made on, so a link to another page drops them.
 */
export function moduleHref(base: string, state: GalleryState, id: string, anchor?: string): string {
  const query = formatGalleryQuery(pageState(state));
  return `${base}${modulePath(id)}${query}${anchor ? `#${encodeURIComponent(anchor)}` : ""}`;
}

/** A link to the home page, or to a section of it (`#components`), carrying the view state. */
export function homeHref(base: string, state: GalleryState, anchor?: string): string {
  return `${base}/${formatGalleryQuery(pageState(state))}${anchor ? `#${anchor}` : ""}`;
}

/** A link to another route (`/fonts`, `/screens/chat`) carrying the view state. */
export function routeHref(base: string, state: GalleryState, path: string): string {
  return `${base}${path}${formatGalleryQuery(pageState(state))}`;
}

/** The state a link to another page carries: the preferences and flags, never one page's picks. */
export function pageState(state: GalleryState): GalleryState {
  return {
    ...state,
    compare: state.compare === true,
    variants: {},
  };
}

/** The variant or section a page's hash names, or null for none. */
export function anchorOf(hash: string): string | null {
  const id = decodeURIComponent(hash.replace(/^#/, ""));
  return id === "" ? null : id;
}
