/**
 * Table-of-contents helpers: extract ##/### headings from a Markdown body (skipping
 * fenced code blocks) and slugify them the same way the rendered headings do, so TOC
 * anchors and heading ids always match. Pure and unit-testable; same behavior as the
 * landing page blog.
 */

export interface TocEntry {
  id: string;
  text: string;
  depth: 2 | 3;
}

/** Heading text -> anchor id (keeps CJK, lowercases latin, hyphenates spaces). */
export function slugifyHeading(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-");
}

export function extractToc(body: string): TocEntry[] {
  const entries: TocEntry[] = [];
  let inFence = false;
  for (const line of body.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = /^(#{2,3})\s+(.+?)\s*$/.exec(line);
    if (!match) continue;
    const text = match[2]!;
    entries.push({
      id: slugifyHeading(text),
      text,
      depth: match[1]!.length === 2 ? 2 : 3,
    });
  }
  return entries;
}
