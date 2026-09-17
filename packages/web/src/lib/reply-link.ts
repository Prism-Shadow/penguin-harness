/**
 * Where a link in a conversation's Markdown goes.
 *
 * A model links the files it wrote the way a README would — `[pelican-bike.html](pelican-bike.html)`,
 * relative to the Workspace it works in. The browser resolves that href against the SPA's own
 * route instead (`/chat/pelican-bike.html`, a page that does not exist), so opening it in a new
 * tab boots a second copy of the App on nothing, and inside the desktop shell every click used to
 * open another app window. Inside a conversation an href is therefore sorted before it renders:
 *
 * - `external` — it names a scheme (`https:`, `mailto:`, …) or is protocol-relative (`//host`).
 *   Another site: it opens in a new tab, as every chat link always has.
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

export type ReplyLink =
  | { kind: "external" }
  | { kind: "anchor"; id: string }
  | { kind: "file"; path: string }
  | { kind: "none" };

/** A URL scheme, as the URL parser reads one: a letter, then letters, digits, `+`, `.` or `-`, then `:`. */
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

const EXTERNAL: ReplyLink = { kind: "external" };
const NONE: ReplyLink = { kind: "none" };

function decode(text: string): string | null {
  try {
    return decodeURIComponent(text);
  } catch {
    return null;
  }
}

/** Sorts one href from a conversation's Markdown; `workspace` is the Session's absolute Workspace path. */
export function resolveReplyLink(href: string | undefined, workspace: string | null): ReplyLink {
  if (href === undefined || href === "") return NONE;
  if (href.startsWith("#")) {
    const id = decode(href.slice(1));
    return id === null || id === "" ? NONE : { kind: "anchor", id };
  }
  if (href.startsWith("//") || SCHEME_RE.test(href)) return EXTERNAL;
  const decoded = decode(href.replace(/[?#].*$/, ""));
  if (decoded === null) return NONE;
  const path = toWorkspaceRelative(decoded, workspace);
  return path === null ? NONE : { kind: "file", path };
}

/** What a conversation hands the Markdown it renders, so a link to a Workspace file opens in place. */
export interface WorkspaceLinks {
  /** The Session's absolute Workspace path, which an absolute href must lie inside. */
  workspace: string | null;
  /** Opens a Workspace-relative path in the conversation's Files panel. */
  openFile: (path: string) => void;
}

/** The attributes a rendered link adds on top of its own. */
export interface LinkBehavior {
  target?: "_blank";
  rel?: "noreferrer";
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
}

/**
 * A new tab with no handle back to this window (`noreferrer` implies `noopener`): every Markdown
 * link outside a conversation, and an external one inside it.
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
  const link = resolveReplyLink(href, links.workspace);
  switch (link.kind) {
    case "external":
      return NEW_TAB;
    case "file":
      return {
        onClick: (event) => {
          event.preventDefault();
          links.openFile(link.path);
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
