/**
 * Citations as they read in print: a run of GFM footnote references (`…a claim[^1][^2].`) becomes
 * one raised group, `[1, 2]`, instead of one bare number per reference running into the next.
 *
 *     <sup class="site-cite">[<a href="#fn-1" id="fnref-1" …>1</a>,&nbsp;<a …>2</a>]</sup>
 *
 * - The brackets and separators are text, so they survive wherever the page's styles do not:
 *   copied text, reader modes, a feed. Each number stays its own link with every attribute the
 *   footnote step gave it (`id`, `href`, `data-footnote-ref`, `aria-describedby`), so a link's
 *   accessible name is still the number alone.
 * - A word joiner before the group, and the no-break space after each comma, keep the group on
 *   the line of the text it follows and in one piece: a line may otherwise break before an opening
 *   bracket, leaving `[1]` alone at the start of the next line.
 *
 * A reference counts as part of a run only when nothing, not even a space, separates it from the
 * previous one. Runs after the footnote step and any raw-HTML pass, as the last rehype plugin.
 *
 * Pure hast in, hast out — no DOM — so the transform is unit-testable.
 */

/** The subset of a hast node this transform reads or writes. */
export interface CitationNode {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: CitationNode[];
  value?: string;
}

const WORD_JOINER = "\u2060";
const SEPARATOR = ",\u00a0";

export function rehypeCitations() {
  return (tree: CitationNode): void => {
    groupRuns(tree);
  };
}

/** A footnote reference as the footnote step emits it: a `sup` holding only its link. */
function citationLink(node: CitationNode): CitationNode | undefined {
  if (node.type !== "element" || node.tagName !== "sup") return undefined;
  const [link, ...rest] = node.children ?? [];
  if (!link || rest.length > 0 || link.type !== "element" || link.tagName !== "a") return undefined;
  // `true` straight from the footnote step, `""` once a raw-HTML pass has re-parsed the tree.
  return link.properties?.dataFootnoteRef != null ? link : undefined;
}

const text = (value: string): CitationNode => ({ type: "text", value });

function groupRuns(parent: CitationNode): void {
  const children = parent.children;
  if (!children) return;
  const out: CitationNode[] = [];
  let i = 0;
  while (i < children.length) {
    const links: CitationNode[] = [];
    while (i < children.length) {
      const link = citationLink(children[i]!);
      if (!link) break;
      links.push(link);
      i++;
    }
    if (links.length > 0) {
      out.push(text(WORD_JOINER), citationGroup(links));
      continue;
    }
    const child = children[i]!;
    groupRuns(child);
    out.push(child);
    i++;
  }
  parent.children = out;
}

function citationGroup(links: CitationNode[]): CitationNode {
  const children: CitationNode[] = [text("[")];
  links.forEach((link, index) => {
    if (index > 0) children.push(text(SEPARATOR));
    children.push(link);
  });
  children.push(text("]"));
  return { type: "element", tagName: "sup", properties: { className: ["site-cite"] }, children };
}
