/**
 * Something a surface shows directly below one block of Markdown, chosen from the links inside
 * that block — the Web App's conversation puts a player under the paragraph of a reply that links
 * an audio file this way. The Markdown itself is untouched: a link stays a link, and what is added
 * sits after the block, never inside its text.
 *
 * The blocks are paragraphs and list items. A list item's links are the ones written in the item
 * itself: those of a paragraph inside it (a loose list) and of a nested list belong to that inner
 * block, so nothing is shown twice. A link written inside a code span or a code block is not a link
 * — the Markdown parser never makes one there — so it reaches nobody.
 *
 * Only the settled render asks (prose.tsx keeps the adapters out of the streaming map): a reply
 * that is still arriving can end mid-link, and whatever a trailer mounts — a player, a fetch —
 * would come and go with every delta. The settle render re-parses the message anyway, the moment
 * code is highlighted and formulas are typeset.
 */
import { createContext, useContext } from "react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import type { ExtraProps } from "react-markdown";

/** What to show after a block, given the hrefs of its links in reading order; null for nothing. */
export type ProseBlockTrailer = (hrefs: readonly string[]) => ReactNode;

const TrailerContext = createContext<ProseBlockTrailer | null>(null);

/**
 * Hands the Markdown below a block trailer; `null` turns it off. A change re-renders every
 * paragraph in the tree, memoized bodies included, so pass one that keeps its identity while its
 * inputs do.
 */
export function ProseBlockTrailerProvider({
  trailer,
  children,
}: {
  trailer: ProseBlockTrailer | null;
  children?: ReactNode;
}) {
  return <TrailerContext.Provider value={trailer}>{children}</TrailerContext.Provider>;
}

/** The hast shape walked here, structurally (hast's own types are not a dependency of this package). */
interface HastNode {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: readonly HastNode[];
}

/** Blocks inside a list item that own their links. */
const INNER_BLOCKS = new Set(["p", "ul", "ol"]);

/** The hrefs of the links in a block, in reading order, skipping inner blocks when `skipInner`. */
export function blockLinks(node: HastNode | undefined, skipInner: boolean): string[] {
  const out: string[] = [];
  const walk = (n: HastNode): void => {
    for (const child of n.children ?? []) {
      if (child.type !== "element") continue;
      if (skipInner && INNER_BLOCKS.has(child.tagName ?? "")) continue;
      const href = child.tagName === "a" ? child.properties?.href : undefined;
      if (typeof href === "string" && href !== "") out.push(href);
      walk(child);
    }
  };
  if (node !== undefined) walk(node);
  return out;
}

function useTrailer(node: HastNode | undefined, skipInner: boolean): ReactNode {
  const trailer = useContext(TrailerContext);
  if (trailer === null) return null;
  const hrefs = blockLinks(node, skipInner);
  return hrefs.length === 0 ? null : trailer(hrefs);
}

/** Paragraph adapter: the trailer follows the paragraph (a `<p>` cannot hold a block). */
export function MdParagraph({ node, ...props }: ComponentPropsWithoutRef<"p"> & ExtraProps) {
  const after = useTrailer(node as HastNode | undefined, false);
  return (
    <>
      <p {...props} />
      {after}
    </>
  );
}

/** List item adapter: the trailer ends the item, so it stays inside the list's structure. */
export function MdListItem({
  node,
  children,
  ...props
}: ComponentPropsWithoutRef<"li"> & ExtraProps) {
  const after = useTrailer(node as HastNode | undefined, true);
  return (
    <li {...props}>
      {children}
      {after}
    </li>
  );
}
