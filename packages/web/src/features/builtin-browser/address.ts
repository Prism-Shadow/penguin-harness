/**
 * What the built-in browser's address bar makes of what the user typed, and how it shows a
 * page's address back. Pure, so the rules are pinned by tests rather than rediscovered in a
 * running desktop app.
 *
 * The rules, in order:
 * - `http://` / `https://` addresses are taken as typed (the URL parser normalises them);
 * - `about:blank` is the one other page a tab may show, the empty one a new tab starts on;
 * - a bare host — `amazon.com/your-orders`, `localhost:3000`, `192.168.1.1` — gets a scheme:
 *   https for a public name, http for a loopback or IP address (a development server rarely
 *   speaks TLS);
 * - anything else — words, a sentence, `file:` or `javascript:` text — is a web search.
 */

/** Where a search goes. */
export const SEARCH_URL = "https://www.bing.com/search?q=";

/** The page a new tab starts on, and the address bar shows empty. */
export const BLANK_URL = "about:blank";

/**
 * A domain name: dot-separated labels of letters, digits and inner hyphens, ending in an
 * alphabetic top-level label (or its punycode form). The alphabetic TLD is what keeps `1.5`
 * and `3.14` searches; Unicode letters are allowed so an internationalised name is a name.
 */
const DOMAIN =
  /^(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?\.)+(?:\p{L}{2,63}|xn--[a-z0-9-]{1,59})$/iu;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const IPV6 = /^\[[0-9a-f:.]+\]$/i;

function parseUrl(text: string): URL | null {
  try {
    return new URL(text);
  } catch {
    return null;
  }
}

/** The host part of a scheme-less address: everything up to the first `/`, `?` or `#`. */
function hostPart(text: string): string {
  const end = text.search(/[/?#]/);
  return end === -1 ? text : text.slice(0, end);
}

/** `host[:port]` split apart; null when the port is not a port. */
function splitPort(host: string): { name: string; port: string | null } | null {
  // An IPv6 literal carries colons of its own inside the brackets.
  const match = /^(\[[^\]]*\]|[^:]*)(?::(\d{1,5}))?$/.exec(host);
  if (!match) return null;
  return { name: match[1] ?? "", port: match[2] ?? null };
}

/** Loopback and IP addresses: served over plain http by default. */
function isLocalName(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower === "localhost" || lower.endsWith(".localhost") || IPV4.test(name) || IPV6.test(name)
  );
}

/** Whether a scheme-less word names a host rather than being a search. */
function bareHost(text: string): string | null {
  if (/\s/.test(text)) return null;
  const parts = splitPort(hostPart(text));
  if (parts === null || parts.name === "") return null;
  const { name } = parts;
  if (isLocalName(name) || DOMAIN.test(name)) return name;
  return null;
}

/**
 * The URL to load for the address bar's text, or null when there is nothing to load (blank
 * input). Never throws, and never returns anything but an http(s) URL or `about:blank`.
 */
export function normalizeAddress(input: string): string | null {
  const text = input.trim();
  if (text === "") return null;
  if (text.toLowerCase() === BLANK_URL) return BLANK_URL;
  if (/^https?:\/\//i.test(text)) {
    const url = parseUrl(text);
    // `https://` with nothing after it fails to parse and falls through to a search.
    if (url !== null && url.hostname !== "") return url.href;
  }
  const host = bareHost(text);
  if (host !== null) {
    const url = parseUrl(`${isLocalName(host) ? "http" : "https"}://${text}`);
    if (url !== null) return url.href;
  }
  return `${SEARCH_URL}${encodeURIComponent(text)}`;
}

/** Whether a URL is a web page (the only kind that may be handed to the system browser). */
export function isWebUrl(url: string): boolean {
  const parsed = parseUrl(url);
  return parsed !== null && (parsed.protocol === "http:" || parsed.protocol === "https:");
}

/** A tab showing nothing yet: the address bar reads empty and the panel shows its own blank state. */
export function isBlankUrl(url: string): boolean {
  return url === "" || url === BLANK_URL;
}

/** What the address bar shows for a page: its address, or nothing for a blank tab. */
export function displayAddress(url: string): string {
  return isBlankUrl(url) ? "" : url;
}

/** A tab's name in the strip: its title, else its host, else its address, else `untitled`. */
export function tabLabel(tab: { title: string; url: string }, untitled: string): string {
  const title = tab.title.trim();
  if (title !== "") return title;
  if (isBlankUrl(tab.url)) return untitled;
  const parsed = parseUrl(tab.url);
  return parsed !== null && parsed.hostname !== "" ? parsed.hostname : tab.url;
}

/**
 * A page's favicon as the strip may load it, or null to draw the generic glyph instead. The
 * icon is fetched by the app's own page, not by the guest, so only two kinds pass: an image
 * `data:` URL, and a web URL on another origin. A page may name any URL as its icon, and
 * one on the app's own origin would be requested with the app's session cookie.
 */
export function faviconSrc(favicon: string | undefined, appOrigin: string): string | null {
  if (favicon === undefined || favicon === "") return null;
  if (/^data:image\//i.test(favicon)) return favicon;
  const parsed = parseUrl(favicon);
  if (parsed === null || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) return null;
  return parsed.origin === appOrigin ? null : parsed.href;
}
