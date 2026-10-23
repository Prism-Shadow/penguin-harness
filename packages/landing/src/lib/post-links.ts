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
