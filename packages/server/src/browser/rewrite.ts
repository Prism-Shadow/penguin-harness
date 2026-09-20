/**
 * What changes on the way through the Browser's proxy, in both directions.
 *
 * As little as possible. The page is served on a host of its own, so its root-absolute
 * paths, its cookies and its storage all work untouched; what is rewritten is only what
 * names the ORIGIN — the page's origin is the Browser host, the site's is the upstream —
 * and what would stop the page from being shown in the panel at all.
 */
import type { BrowserTarget } from "./address.js";

/** Where the bootstrap script is served on every Browser host. */
export const BOOTSTRAP_PATH = "/__penguin/browser.js";

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

/** HTML past this size goes through as it is: the bootstrap is a nicety, a page is not. */
export const MAX_INJECT_BYTES = 8 * 1024 * 1024;

/** Whether `url` names the upstream itself — for a Workspace target, under any loopback name. */
function isUpstream(url: URL, target: BrowserTarget): boolean {
  if (target.kind === "public") return url.origin === target.origin;
  const host = url.hostname.toLowerCase();
  const loopback =
    host === "localhost" || host.endsWith(".localhost") || host === "[::1]" || /^127\./.test(host);
  const port = url.port === "" ? (url.protocol === "https:" ? 443 : 80) : Number(url.port);
  return loopback && (url.protocol === "https:") === target.secure && port === target.port;
}

/** The headers the upstream is asked with. */
export function upstreamRequestHeaders(
  incoming: Headers,
  target: BrowserTarget,
  browserOrigin: string,
): Headers {
  const out = new Headers();
  incoming.forEach((value, name) => {
    if (HOP_BY_HOP.has(name) || name === "host" || name === "content-length") return;
    out.append(name, value);
  });
  // The site sees its own name, not the Browser's: virtual hosts route on it, and a CSRF
  // check compares Origin against it.
  out.set("host", new URL(target.origin).host);
  for (const name of ["origin", "referer"]) {
    const value = incoming.get(name);
    if (value === null) continue;
    if (value === browserOrigin || value.startsWith(`${browserOrigin}/`)) {
      out.set(name, target.origin + value.slice(browserOrigin.length));
    } else {
      // The App's own origin (the panel is the embedder) is nothing the site should learn.
      out.delete(name);
    }
  }
  // The body may have to be read (HTML gets the bootstrap), so it must arrive uncompressed.
  out.set("accept-encoding", "identity");
  return out;
}

/** Drops `frame-ancestors`, which would refuse the panel; every other directive stands. */
function withoutFrameAncestors(policy: string): string {
  return policy
    .split(";")
    .map((directive) => directive.trim())
    .filter((directive) => directive !== "" && !/^frame-ancestors(\s|$)/i.test(directive))
    .join("; ");
}

/** The first nonce a policy allows scripts with, so the bootstrap can carry it. */
export function scriptNonce(policy: string | null): string | null {
  if (policy === null) return null;
  const match = /'nonce-([A-Za-z0-9+/_=-]+)'/.exec(policy);
  return match ? (match[1] as string) : null;
}

/** The headers the page is answered with. `bodyChanged` = the body was rewritten, so its length is no longer the upstream's. */
export function browserResponseHeaders(
  upstream: Headers,
  target: BrowserTarget,
  browserOrigin: string,
  bodyChanged: boolean,
): Headers {
  const out = new Headers();
  upstream.forEach((value, name) => {
    if (HOP_BY_HOP.has(name)) return;
    if (name === "set-cookie") return; // appended below, one header per cookie
    if (name === "x-frame-options" || name === "strict-transport-security") return;
    if (name === "content-encoding" && value.toLowerCase() === "identity") return;
    if (name === "content-length" && bodyChanged) return;
    if (name === "content-security-policy" || name === "content-security-policy-report-only") {
      const policy = withoutFrameAncestors(value);
      if (policy !== "") out.append(name, policy);
      return;
    }
    if (name === "location") {
      out.set(name, rewriteLocation(value, target, browserOrigin));
      return;
    }
    out.append(name, value);
  });
  for (const cookie of upstream.getSetCookie()) out.append("set-cookie", framedCookie(cookie));
  // The Browser host's name is a capability. A Referer would hand it to every third party
  // the page links to or loads from.
  out.set("referrer-policy", "no-referrer");
  return out;
}

/**
 * A cookie as it has to be written to survive in the panel's frame.
 *
 * `Domain` goes: the site's own domain means nothing on the Browser host, and without it the
 * cookie is host-only — this site's, on this host, and nobody else's.
 *
 * `SameSite=None; Secure; Partitioned` comes: the frame is CROSS-SITE to the app by design
 * (that is the isolation), and a browser drops a cookie there unless it says `SameSite=None`
 * — the default, Lax, is refused outright, from a header and from script alike, so a site's
 * sign-in would not last one request. `Secure` is what `None` requires, and is honoured on
 * `*.localhost` over plain http; `Partitioned` keeps the cookie where third-party cookies
 * are blocked, by keying it to the app it is framed in — which is the only place it is used.
 * What the site asked for (`Strict`, `Lax`) protected it against being framed by strangers;
 * here the only embedder is the panel, and the host is a capability strangers do not have.
 */
export function framedCookie(cookie: string): string {
  const kept = cookie
    .split(";")
    .map((part) => part.trim())
    .filter(
      (part, index) => index === 0 || !/^(domain|samesite|secure|partitioned)(=|$)/i.test(part),
    );
  return [...kept, "SameSite=None", "Secure", "Partitioned"].join("; ");
}

/** A redirect to the site itself stays in the Browser; one that leaves is the browser's to follow. */
export function rewriteLocation(
  location: string,
  target: BrowserTarget,
  browserOrigin: string,
): string {
  let url: URL;
  try {
    url = new URL(location);
  } catch {
    return location; // relative: already resolves against the Browser host
  }
  return isUpstream(url, target) ? browserOrigin + url.pathname + url.search + url.hash : location;
}

/** Puts the bootstrap first in the document: in `<head>`, else after `<html>`, else at the very start. */
export function injectBootstrap(html: string, nonce: string | null): string {
  const tag = `<script src="${BOOTSTRAP_PATH}"${nonce === null ? "" : ` nonce="${nonce}"`}></script>`;
  const head = /<head(\s[^>]*)?>/i.exec(html);
  if (head)
    return (
      html.slice(0, head.index + head[0].length) + tag + html.slice(head.index + head[0].length)
    );
  const root = /<html(\s[^>]*)?>/i.exec(html);
  if (root)
    return (
      html.slice(0, root.index + root[0].length) + tag + html.slice(root.index + root[0].length)
    );
  return tag + html;
}

export function isHtml(headers: Headers): boolean {
  return /^text\/html\b/i.test(headers.get("content-type") ?? "");
}
