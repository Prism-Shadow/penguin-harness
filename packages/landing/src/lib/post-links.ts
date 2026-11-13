/**
 * Where a link in a post body goes, which decides how it opens: a jump within the page (a
 * citation and its entry in the references, a heading), a page of this site (opens in a new tab),
 * or somewhere else (opens in a new tab after the reader confirms). Pure: the caller supplies the
 * host names that count as this site.
 */

export type PostLinkKind = "anchor" | "internal" | "external";

/** A URL that names its own scheme (`https:`, `mailto:`), or one that only omits it (`//host/…`). */
const ABSOLUTE = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i;

export function classifyPostHref(href: string, ownHosts: readonly string[]): PostLinkKind {
  if (href.startsWith("#")) return "anchor";
  if (!ABSOLUTE.test(href)) return "internal";
  let url: URL;
  try {
    // The base only completes a scheme-relative `//host/…`; an absolute href ignores it.
    url = new URL(href, "https://invalid.example");
  } catch {
    // Not a URL a browser would follow anywhere new: leave it as an ordinary link.
    return "internal";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "external";
  return ownHosts.includes(url.hostname) ? "internal" : "external";
}

/** A path without the trailing slash GitHub Pages adds when it serves a post's folder. */
const pathKey = (path: string) => path.replace(/\/+$/, "");

/**
 * The `#fragment` a link names on the page the reader is on, or `null` when it leads anywhere
 * else. A plain `#…` href is one; so is an address of this very page with a fragment, written as
 * a path (`/blog/<post>#fn-1`) or on one of the site's hosts (`https://penguin.ooo/blog/<post>#…`),
 * with or without the trailing slash. Rendered as the bare fragment, such a link is a jump within
 * the page: written as an address, it would count as a page of this site and open a new tab, or,
 * from the post's slash-ended address, load the page again.
 */
export function inPageHash(href: string, ownHosts: readonly string[], here: string): string | null {
  if (href.startsWith("#")) return href;
  if (!here) return null;
  let url: URL;
  try {
    url = new URL(href, `https://${ownHosts[0] ?? "invalid.example"}${here}`);
  } catch {
    return null;
  }
  if (url.hash.length < 2 || (url.protocol !== "http:" && url.protocol !== "https:")) return null;
  if (ABSOLUTE.test(href) && !ownHosts.includes(url.hostname)) return null;
  return pathKey(url.pathname) === pathKey(here) ? url.hash : null;
}
