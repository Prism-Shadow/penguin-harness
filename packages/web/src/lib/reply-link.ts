/**
 * Where a link in a conversation's Markdown goes.
 *
 * A model links the files it wrote the way a README would — `[pelican-bike.html](pelican-bike.html)`,
 * relative to the Workspace it works in. The browser resolves that href against the SPA's own
 * route instead (`/chat/pelican-bike.html`, a page that does not exist), so opening it in a new
 * tab boots a second copy of the App on nothing, and inside the desktop shell every click used to
 * open another app window. Inside a conversation an href is therefore sorted before it renders:
 *
 * - `route` — the App's own routes: a root-relative `/chat/<sessionId>` or `/org…` href, or a
 *   URL whose origin is exactly the page's (`location.origin`) pointing at either. Clicking
 *   navigates through the App's Router instead of reloading it.
 * - `external` — every other href that names a scheme (`https:`, `mailto:`, …) or carries its
 *   own host (`//host`, `http://…`), whatever the host: another site, or another deployment on
 *   this machine (a different port on the same localhost). It opens in a new tab, as every
 *   chat link always has.
 * - `anchor` — `#id`: a place inside the rendered Markdown (GFM footnotes are the anchors the
 *   renderer emits), never a navigation of the App.
 * - `file` — anything else that resolves to a Workspace-relative path. The href is
 *   percent-decoded first (the renderer encodes non-ASCII, so a CJK file name arrives as
 *   `%E4%B8%AD…`), its query and hash are dropped, and it is then normalized exactly as file
 *   mentions in a reply are (`toWorkspaceRelative`): `./` and empty segments drop, an inner `..`
 *   pops, and an absolute path counts only when it lies inside the Session's Workspace.
 * - `none` — the rest: a `..` that climbs out of the Workspace, an absolute path outside it, a
 *   `~` path, and an href the renderer emptied (react-markdown replaces every scheme it does not
 *   trust with "", `file:` URLs and Windows drive-letter paths included). Nothing in the App
 *   can open it, so it does not navigate at all.
 *
 * Existence is deliberately not checked: a link to a file that is not there still opens the
 * Files panel on that path, and the panel's own state says the file is missing.
 */
import type { MouseEvent } from "react";
import { toWorkspaceRelative } from "./file-path";
import { isPlainClick } from "./shortcuts/plain-click";

export type ReplyLink =
  | { kind: "external" }
  | { kind: "anchor"; id: string }
  | { kind: "file"; path: string }
  | { kind: "route"; to: string }
  | { kind: "none" };

/**
 * The internal SPA route an href holds, when it holds one — `/chat/<sessionId>`, `/org…`, or a
 * URL whose origin is the page's own pointing at either. WHATWG-parsed throughout, so the
 * decision runs on the parsed URL, not the raw string: a path that normalizes into a route
 * (`/chat/../chat/x`) is one, a path that normalizes out of both families (`/chat/` alone,
 * `/chat/x/../..`) is not, and anything that is neither rooted nor carries a scheme is a
 * Workspace file candidate and skips this entirely. A URL that carries its own host counts only
 * when its origin equals the page's `origin` — same scheme, host and port — so another
 * deployment on this machine, another port on the same localhost, stays external; when no page
 * origin is known, no host-bearing URL counts.
 */
function internalRoute(href: string, absolute: URL | null, origin: string | null): string | null {
  // A root-relative href is the page's own by definition — the parser resolves it against the
  // page. `//host/…` is protocol-relative and carries a host after all; anything else without
  // a scheme (a bare relative href) is a Workspace file candidate.
  const rootRelative = href.startsWith("/") && !href.startsWith("//");
  if (!rootRelative && absolute === null && !href.startsWith("//")) return null;
  let url: URL;
  try {
    url = absolute ?? new URL(href, origin ?? "http://localhost/");
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!rootRelative && (origin === null || url.origin !== origin)) return null;
  const to = `${url.pathname}${url.search}${url.hash}`;
  // `/chat/<sessionId>` is one non-empty segment — the id carries no `/`, so `/chat/`, `/chat//`
  // and `/chat/x/y` are not routes.
  const chatId = url.pathname.slice("/chat/".length);
  if (url.pathname.startsWith("/chat/") && chatId !== "" && !chatId.includes("/")) return to;
  if (url.pathname === "/org" || url.pathname.startsWith("/org/")) return to;
  return null;
}

const EXTERNAL: ReplyLink = { kind: "external" };
const NONE: ReplyLink = { kind: "none" };

function decode(text: string): string | null {
  try {
    return decodeURIComponent(text);
  } catch {
    return null;
  }
}

/** The href without its query or hash — where a Workspace file's own name ends. */
function stripQueryHash(href: string): string {
  const query = href.indexOf("?");
  const hash = href.indexOf("#");
  const cut = query === -1 ? hash : hash === -1 ? query : Math.min(query, hash);
  return cut === -1 ? href : href.slice(0, cut);
}

/**
 * Sorts one href from a conversation's Markdown; `workspace` is the Session's absolute Workspace
 * path and `origin` the page's `location.origin`, which a URL carrying its own host must match
 * exactly to count as a route (see {@link internalRoute}).
 */
export function resolveReplyLink(
  href: string | undefined,
  workspace: string | null,
  origin?: string | null,
): ReplyLink {
  if (href === undefined || href === "") return NONE;
  if (href.startsWith("#")) {
    const id = decode(href.slice(1));
    return id === null || id === "" ? NONE : { kind: "anchor", id };
  }
  // The parser's own scheme test: a URL carries a scheme exactly when it parses without a base.
  let absolute: URL | null = null;
  try {
    absolute = new URL(href);
  } catch {
    // Relative — rooted, protocol-relative or bare.
  }
  const route = internalRoute(href, absolute, origin ?? null);
  if (route !== null) return { kind: "route", to: route };
  if (href.startsWith("//") || absolute !== null) return EXTERNAL;
  const decoded = decode(stripQueryHash(href));
  if (decoded === null) return NONE;
  const path = toWorkspaceRelative(decoded, workspace);
  return path === null ? NONE : { kind: "file", path };
}

/** What a conversation hands the Markdown it renders, so a link to a Workspace file opens in place. */
export interface WorkspaceLinks {
  /** The Session's absolute Workspace path, which an absolute href must lie inside. */
  workspace: string | null;
  /**
   * The page's `location.origin`. A URL carrying its own host counts as a route only on exactly
   * this origin — another deployment on this machine stays external — and when absent, no
   * host-bearing URL is claimed as a route at all.
   */
  origin?: string | null;
  /** Opens a Workspace-relative path in the conversation's Files panel; absent when the surface has no Files panel, and a file link then keeps a new tab. */
  openFile?: (path: string) => void;
  /** Navigates to an internal SPA route (`/chat/<sessionId>`, `/org…`) through the app's Router. */
  openRoute: (to: string) => void;
}

/** The attributes a rendered link adds on top of its own. */
export interface LinkBehavior {
  target?: "_blank";
  rel?: "noreferrer";
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
}

/**
 * A new tab with no handle back to this window (`noreferrer` implies `noopener`): an external link
 * inside a conversation — the same attributes the shared UI package gives every Markdown link
 * outside one (`PROSE_NEW_TAB`).
 */
export const NEW_TAB: LinkBehavior = { target: "_blank", rel: "noreferrer" };

const preventNavigation = (event: MouseEvent<HTMLAnchorElement>): void => event.preventDefault();

/**
 * Scrolls to the element an in-page link names, searching outward from the link: every reply
 * numbers its footnotes from 1, so one transcript can hold several `user-content-fn-1`, and the
 * one meant is the one nearest the link that was clicked.
 */
function scrollToAnchor(from: Element, id: string): void {
  for (let scope = from.parentElement; scope !== null; scope = scope.parentElement) {
    const target = scope.querySelector(`#${CSS.escape(id)}`);
    if (target !== null) {
      target.scrollIntoView({ block: "center" });
      return;
    }
  }
}

/**
 * How a link behaves inside a conversation. Only an external link opens a new tab; a Workspace
 * file opens in the Files panel, an anchor scrolls within the page, and an href with nowhere to
 * go stays put. Each of the last three prevents the default for every click, modifier keys
 * included — the href they would follow is a route of the App, never a page.
 */
export function replyLinkBehavior(href: string | undefined, links: WorkspaceLinks): LinkBehavior {
  const link = resolveReplyLink(href, links.workspace, links.origin ?? null);
  switch (link.kind) {
    case "external":
      return NEW_TAB;
    case "file":
      return links.openFile
        ? {
            onClick: (event) => {
              event.preventDefault();
              links.openFile!(link.path);
            },
          }
        : NEW_TAB;
    case "route":
      return {
        onClick: (event) => {
          if (!isPlainClick(event)) return;
          event.preventDefault();
          links.openRoute(link.to);
        },
      };
    case "anchor":
      return {
        onClick: (event) => {
          event.preventDefault();
          scrollToAnchor(event.currentTarget, link.id);
        },
      };
    case "none":
      return { onClick: preventNavigation };
  }
}
