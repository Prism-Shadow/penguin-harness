/**
 * Find-in-page: the DOM half. Where the matches *are*, how to show them, and how to bring one
 * into view — the walking and painting that text matching (find-text.ts) knows nothing about, and
 * that a find bar only talks to through these functions. Two drive it: the Web App's page-wide
 * find bar, over the regions below, and the Markdown reader, over its own reading box
 * (markdown-reader.tsx).
 *
 * **Why the DOM and not the view model.** The transcript renders from a model, but three of
 * the four things a reader searches are not in it: the sidebar's Session list, the Files
 * panel, and the file/preview surfaces a tool card draws. Searching what is on screen answers
 * all of them with one implementation, and it makes a hit *by construction* something that can
 * be shown and scrolled to. The price is stated plainly in the UI: only what is loaded can be
 * found — the transcript keeps a window (see lib/amsp/stream-controller.ts), and a region that
 * knows about more content says so with `data-find-more`, which is what the "load earlier
 * messages and keep searching" row is built on.
 *
 * **A region is an element that opted in** (`data-find-region="<kind>"`), and the surfaces
 * that carry one are the conversation, the subagent panel's conversation, the sidebar and the
 * Files panel. `find.open` searches the region the focused element is inside; `find.all`
 * searches all of them and lists the hits by region. Nothing here knows which is which: the find
 * bar asks the DOM.
 *
 * **Text, not elements.** The unit of a search is a *block* — the nearest block-level ancestor
 * of a text node (`<p>`, `<li>`, `<pre>`, …) — and a block's text nodes are joined for
 * matching. That is what lets a query match across inline markup (`say **hello** now` renders
 * as three text nodes in one paragraph) while still never matching across paragraphs, which is
 * not a passage any reader would recognize.
 *
 * **Painting uses the CSS Custom Highlight API.** Ranges are registered in `CSS.highlights`
 * instead of wrapping matches in `<mark>` elements: nothing in the DOM changes, so React's
 * re-renders during a stream cannot notice, drop or fight the highlights, and a text walk
 * stays valid after a paint. Where the API is missing (an older engine) the search still
 * works — navigation and the counter are unaffected — it simply does not paint. The registry
 * holds one highlight per name for the whole document, so every search paints as an `owner` and
 * the two highlights are the union of the owners' ranges: a reader's search inside a dialog and
 * the page's find bar behind it each keep their own marks, and each clears only its own.
 */
import { matchAll, matchSnippet } from "./find-text";
import type { FindQuery, MatchSnippet, TextMatch } from "./find-text";
import "./find.css";

/** Attribute a container opts in with; its value is the region kind ("conversation", "files", …). */
const REGION_ATTR = "data-find-region";
/** Attribute a region sets (any value) while it knows about content it has not loaded. */
export const FIND_MORE_ATTR = "data-find-more";
/** Event a region's owner listens for to load that content (dispatched on the region element). */
export const FIND_LOAD_OLDER_EVENT = "penguin:find-load-older";
/** Painted with `::highlight(penguin-find)` (find.css). */
const HIGHLIGHT_ALL = "penguin-find";
/** Painted with `::highlight(penguin-find-current)`. */
const HIGHLIGHT_CURRENT = "penguin-find-current";
/** The owner a caller paints as when it names none: the page's one find bar. */
const PAGE_OWNER = "page";

/**
 * Subtrees that never hold searchable prose: code that is not displayed, form controls (their
 * value is not a text node anyway, but a `<textarea>` keeps its default value in one), and
 * anything that asks to be skipped. `svg` is in the list because every icon in this app is
 * one, and an icon's path data is not text a reader would search for. `.katex-mathml` is a
 * typeset formula's MathML copy, kept for screen readers and clipped out of sight: searched, every
 * formula would match twice, once where nothing can be shown.
 */
const SKIP_SELECTOR =
  "script, style, noscript, svg, textarea, input, select, .katex-mathml, [data-find-skip]";

/**
 * What counts as a block for grouping. Every element here ends a passage: a match may not span
 * two of them. Inline elements are deliberately absent — that is what lets a hit cross
 * `<strong>`, `<code>` and `<a>` inside one paragraph.
 */
const BLOCK_SELECTOR =
  "p, li, h1, h2, h3, h4, h5, h6, td, th, pre, blockquote, dd, dt, figcaption, summary, " +
  "label, button, div, section, article, header, footer, aside, tr, table, ul, ol, form, fieldset";

/** One opted-in searchable container. */
export interface FindRegion {
  /** The kind its owner declared (the app's find bar names each kind in its result rows). */
  kind: string;
  element: HTMLElement;
}

/** One match, with everything needed to show it and to jump to it. */
export interface FindHit {
  /** Kind of the region it was found in. */
  region: string;
  range: Range;
  /** The block's full text, for the result row's context line (see `hitSnippet`). */
  text: string;
  /** Where in `text` the hit is. */
  match: TextMatch;
  /** The block element: the anchor `revealHit` scrolls against. */
  block: HTMLElement;
}

/** A text node within a block, and the offsets it occupies in the block's joined text. */
interface Span {
  node: Text;
  start: number;
  end: number;
  /** Position of this node in the document walk — the sort key for the hits inside it. */
  order: number;
}

interface Block {
  element: HTMLElement;
  text: string;
  spans: Span[];
}

/**
 * Regions currently in the document, in DOM order, skipping the ones that are not displayed
 * and any that nest inside another region (their text is already covered by the outer one).
 */
export function findRegions(root: ParentNode = document): FindRegion[] {
  const regions: FindRegion[] = [];
  for (const element of root.querySelectorAll<HTMLElement>(`[${REGION_ATTR}]`)) {
    if (!displayed(element)) continue;
    if (element.parentElement?.closest(`[${REGION_ATTR}]`) != null) continue;
    regions.push({ kind: element.dataset["findRegion"] ?? "", element });
  }
  return regions;
}

/**
 * Whether an element is on screen at all. `offsetParent` is null for a `display: none` subtree
 * (and for fixed positioning, which is why the two are told apart) — a hidden region or block
 * would otherwise contribute hits that can never be shown or reached.
 */
function displayed(element: HTMLElement): boolean {
  if (element.offsetParent !== null) return true;
  return getComputedStyle(element).position === "fixed";
}

/** Every hit of `query` across `regions`, in document order. */
export function indexRegions(regions: readonly FindRegion[], query: FindQuery): FindHit[] {
  if (query.text === "") return [];
  // Regions are containers, so their contents do not interleave: ordering hits within a region
  // is enough, and the regions themselves are already in document order.
  const hits: FindHit[] = [];
  // One by one rather than spread: a common letter in a long document can match more often than
  // a spread call takes arguments.
  for (const region of regions) for (const hit of indexRegion(region, query)) hits.push(hit);
  return hits;
}

function indexRegion(region: FindRegion, query: FindQuery): FindHit[] {
  const walker = document.createTreeWalker(
    region.element,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
    {
      acceptNode: (node) =>
        node.nodeType === Node.ELEMENT_NODE
          ? (node as HTMLElement).matches(SKIP_SELECTOR)
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_SKIP
          : NodeFilter.FILTER_ACCEPT,
    },
  );

  const blocks = new Map<HTMLElement, Block>();
  let order = 0;
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node as Text;
    const parent = text.parentElement;
    if (parent === null) continue;
    const element = parent.closest<HTMLElement>(BLOCK_SELECTOR) ?? parent;
    let block = blocks.get(element);
    if (block === undefined) {
      block = { element, text: "", spans: [] };
      blocks.set(element, block);
    }
    const start = block.text.length;
    block.text += text.nodeValue ?? "";
    block.spans.push({ node: text, start, end: block.text.length, order: order++ });
  }

  /** The (text node, offset) a block-text offset lands on. */
  const locate = (block: Block, offset: number): { node: Text; offset: number; order: number } => {
    for (const span of block.spans) {
      if (offset <= span.end) {
        return { node: span.node, offset: offset - span.start, order: span.order };
      }
    }
    const last = block.spans[block.spans.length - 1]!;
    return { node: last.node, offset: last.end - last.start, order: last.order };
  };

  const found: Array<{ hit: FindHit; order: number }> = [];
  for (const block of blocks.values()) {
    if (!displayed(block.element)) continue;
    for (const match of matchAll(block.text, query)) {
      const start = locate(block, match.start);
      const end = locate(block, match.end);
      const range = document.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      found.push({
        hit: { region: region.kind, range, text: block.text, match, block: block.element },
        order: start.order,
      });
    }
  }
  // One block's text nodes can be split by a nested block (`<div>a<p>b</p>c</div>`), so hits are
  // ordered by the walked position of their own start node: "next hit" then means "the next one
  // down the page".
  found.sort((a, b) => a.order - b.order || a.hit.match.start - b.hit.match.start);
  return found.map((entry) => entry.hit);
}

/** The context line for a hit (see find-text.ts's matchSnippet). */
export function hitSnippet(hit: FindHit, radius: number): MatchSnippet {
  return matchSnippet(hit.text, hit.match, radius);
}

/** Whether this engine can paint highlights at all. */
export function highlightsSupported(): boolean {
  return typeof CSS !== "undefined" && CSS.highlights !== undefined;
}

/** What each owner has painted: every hit but the current one, and the current one. */
const painted = new Map<string, { all: readonly Range[]; current: Range | null }>();

/** Writes the union of every owner's ranges into the two highlights. */
function repaint(): void {
  if (!highlightsSupported()) return;
  const all: Range[] = [];
  const current: Range[] = [];
  for (const paint of painted.values()) {
    for (const range of paint.all) all.push(range);
    if (paint.current !== null) current.push(paint.current);
  }
  writeHighlight(HIGHLIGHT_ALL, all);
  writeHighlight(HIGHLIGHT_CURRENT, current);
}

/** One highlight's ranges, or the name dropped when there are none. */
function writeHighlight(name: string, ranges: readonly Range[]): void {
  if (ranges.length === 0) {
    CSS.highlights.delete(name);
    return;
  }
  const highlight = new Highlight();
  for (const range of ranges) highlight.add(range);
  CSS.highlights.set(name, highlight);
}

/**
 * Paints `hits` as `owner`, with `current` (an index into them, -1 for none) in the stronger of
 * the two colours. Called on every re-index; the owner's previous ranges are replaced, and every
 * other owner's stay.
 */
export function paintHits(hits: readonly FindHit[], current: number, owner = PAGE_OWNER): void {
  if (!highlightsSupported()) return;
  const all: Range[] = [];
  for (let i = 0; i < hits.length; i++) {
    if (i !== current) all.push(hits[i]!.range);
  }
  const focused = current >= 0 && current < hits.length ? hits[current]!.range : null;
  painted.set(owner, { all, current: focused });
  repaint();
}

/** Drops `owner`'s paint (its bar closed, or it has nothing to show); other owners' stays. */
export function clearHighlights(owner = PAGE_OWNER): void {
  if (!highlightsSupported()) return;
  if (!painted.delete(owner)) return;
  repaint();
}

/** What `revealHit` could do about the hit it was given. */
export type RevealResult = "scrolled" | "gone";

/**
 * Brings a hit into view: scrolls the nearest scrollable ancestor so the hit sits in the
 * middle. Reports `gone` when the hit's block has left the document — a re-index has to happen
 * before anything can be scrolled to, which is what a streaming transcript does to a stale
 * index. Only that one scroller moves, so a reader inside a dialog never scrolls the dialog or
 * the page behind it.
 */
export function revealHit(hit: FindHit): RevealResult {
  const element = hit.range.startContainer.parentElement;
  if (element === null || !element.isConnected) return "gone";
  const scroller = scrollableAncestor(element);
  if (scroller === null) {
    element.scrollIntoView({ block: "center" });
    return "scrolled";
  }
  const rect = element.getBoundingClientRect();
  // A skipped subtree (`content-visibility: auto` on an off-screen code block) measures as
  // empty: there is no rect to center on, so the scroll goes to the element itself, which does
  // have a box.
  if (rect.height === 0 && rect.width === 0) {
    element.scrollIntoView({ block: "center" });
    return "scrolled";
  }
  const frame = scroller.getBoundingClientRect();
  scroller.scrollTop += rect.top - frame.top - (scroller.clientHeight - rect.height) / 2;
  return "scrolled";
}

/** The nearest ancestor that actually scrolls, or null when the page itself does. */
function scrollableAncestor(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node !== null; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && node.scrollHeight > node.clientHeight) {
      return node;
    }
  }
  return null;
}
