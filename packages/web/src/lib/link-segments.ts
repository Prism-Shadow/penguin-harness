/**
 * Plain text cut where it carries web addresses, so a surface that shows text as text — a
 * plugin's description, say — can make each address a link and leave everything else alone,
 * without reading the text as Markdown. An address runs from `http://` or `https://` over the
 * ASCII characters a URL may hold (RFC 3986) and stops at anything else — a space, a quote, a
 * bracket, or any non-ASCII character, so Chinese text or punctuation right after it stays text,
 * as it does in a chat reply (`@prismshadow/chat-markdown`). Trailing sentence
 * punctuation stays text too, so "see https://example.com." links the address without its full
 * stop.
 */
export type LinkSegment = { kind: "text"; text: string } | { kind: "link"; href: string };

const ADDRESS = /https?:\/\/[A-Za-z0-9\-._~:/?#@!$&*+,;=%]+/g;
const TRAILING = /[.,;:!?]+$/;

export function linkSegments(text: string): LinkSegment[] {
  const out: LinkSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(ADDRESS)) {
    const start = match.index;
    const href = match[0].replace(TRAILING, "");
    if (start > last) out.push({ kind: "text", text: text.slice(last, start) });
    out.push({ kind: "link", href });
    last = start + href.length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}
