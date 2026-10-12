/**
 * Plain text cut where it carries web addresses, so a surface that shows text as text — a
 * plugin's description, say — can make each address a link and leave everything else alone,
 * without reading the text as Markdown. An address runs from `http://` or `https://` to the
 * first space, quote or bracket (ASCII or full-width); trailing sentence punctuation stays text,
 * so "see https://example.com." links the address without its full stop.
 */
export type LinkSegment = { kind: "text"; text: string } | { kind: "link"; href: string };

const ADDRESS = /https?:\/\/[^\s"'<>()[\]{}（）【】「」《》，。；：！？、]+/g;
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
