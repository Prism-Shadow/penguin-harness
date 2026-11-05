/**
 * Pure helpers behind the public sites' Markdown pages (blog posts and doc pages): frontmatter,
 * heading anchors and the table of contents built from them, the URL hash an anchor link
 * produces, and the reads the renderer makes on react-markdown's nodes. No React state and no
 * DOM, so content tests can call them under plain Node.
 */
import type { ReactNode } from "react";

export interface Frontmatter {
  meta: Record<string, string>;
  body: string;
}

/**
 * A leading `---` block of `key: value` lines (values may contain colons; quotes optional),
 * then the body. A file without the block is all body.
 */
export function parseFrontmatter(raw: string): Frontmatter {
  const normalized = raw.replace(/\r\n/g, "\n");
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(normalized);
  if (!match) return { meta: {}, body: normalized.trim() };
  const meta: Record<string, string> = {};
  for (const line of match[1]!.split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) meta[key] = value;
  }
  return { meta, body: normalized.slice(match[0].length).trim() };
}

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

/**
 * The ##/### headings of a Markdown body, skipping fenced code blocks, with the ids the
 * rendered headings carry (same slugifier), so a TOC entry always finds its heading.
 */
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

/**
 * URL hash -> the id of the element it targets.
 *
 * `location.hash` carries the fragment percent-encoded: a link to the CJK heading `## 安装参考`
 * arrives as `#%E5%AE%89%E8%A3%85%E5%8F%82%E8%80%83`, while the heading's id (slugifyHeading)
 * holds the decoded text, so the fragment is decoded before any lookup. A malformed escape
 * (`#100%`) cannot be decoded and falls back to the raw fragment instead of throwing — a throw
 * inside a React effect would unmount the page. The leading `#` is optional.
 */
export function hashTargetId(hash: string): string {
  const fragment = hash.startsWith("#") ? hash.slice(1) : hash;
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}

/** react-markdown heading children flattened to plain text, for slugging. */
export function nodeText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (typeof node === "object" && "props" in node) {
    return nodeText((node as { props: { children?: ReactNode } }).props.children);
  }
  return "";
}

/** The hast shape the renderer's overrides read back off their nodes. */
export interface HastElement {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastElement[];
  value?: string;
}

/** Fence language and source text of a `<pre><code class="language-x">` hast node. */
export function readFencedCode(node: HastElement | undefined): { code: string; language: string } {
  const codeEl = node?.children?.find((child) => child.tagName === "code");
  const className = codeEl?.properties?.className;
  const language = (Array.isArray(className) ? className : [])
    .map(String)
    .find((name) => name.startsWith("language-"))
    ?.slice("language-".length);
  const collect = (el: HastElement | undefined): string =>
    el?.type === "text" ? (el.value ?? "") : (el?.children ?? []).map(collect).join("");
  return { code: collect(codeEl).replace(/\n$/, ""), language: language ?? "" };
}

/** Tab labels a tab group carries (remarkTabs' `data-tab-labels`), in child order; empty when unusable. */
export function parseTabLabels(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * The TOC entry a reader is on: the last heading above the reading line. The line sits 100px
 * under the sticky header at the top of the page and slides down to ~40px above the viewport
 * bottom at full scroll; being monotonic in the scroll position, every heading gets a band of
 * its own, so short tail sections that never reach a fixed line are not skipped. Fully at the
 * bottom (after the page actually scrolled) it settles on the last entry.
 *
 * `tops` are the headings' viewport tops in entry order, `null` where a heading is missing.
 */
export function activeTocEntry(
  ids: readonly string[],
  tops: readonly (number | null)[],
  view: { scrollY: number; maxScroll: number; height: number },
): string {
  if (ids.length === 0) return "";
  const progress = view.maxScroll > 0 ? Math.min(1, view.scrollY / view.maxScroll) : 0;
  const line = 100 + Math.max(0, view.height - 140) * progress;
  let current = ids[0]!;
  ids.forEach((id, i) => {
    const top = tops[i];
    if (top !== null && top !== undefined && top <= line) current = id;
  });
  if (view.maxScroll > 0 && view.scrollY >= view.maxScroll - 4) current = ids[ids.length - 1]!;
  return current;
}
