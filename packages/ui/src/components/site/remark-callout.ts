/**
 * Callouts: a blockquote whose first line carries a `[!TYPE]` marker becomes a boxed
 * note instead of a quote. A trailing `-` collapses it by default and `+` renders it
 * open; with neither, the box is a plain non-collapsible aside. The rest of that line is
 * the title.
 *
 *     > [!INFO]- 首次启动被系统拦下
 *     >
 *     > …ordinary Markdown, fenced code included…
 *
 * Collapsing is emitted as native `<details>`/`<summary>`, so it needs no JavaScript and
 * the body stays in the DOM — the browser's find-in-page and the page's own "Copy
 * Markdown" keep seeing it. The marker is spelled the way GitHub alerts are, which is
 * what the repo's READMEs already use and what a reader copying the Markdown expects.
 *
 * Pure mdast in, mdast out — no Vite or DOM — so the transform is unit-testable.
 */

/** The subset of an mdast node this transform reads or writes. */
export interface CalloutNode {
  type: string;
  value?: string;
  children?: CalloutNode[];
  data?: {
    hName?: string;
    hProperties?: Record<string, string | boolean>;
  };
}

/** `[!TYPE]`, an optional collapse marker, then the title — matched on the first line. */
const MARKER = /^\[!(\w+)\]([-+]?)[ \t]*(.*)$/;

export function remarkCallout() {
  return (tree: CalloutNode): void => {
    transform(tree);
  };
}

function transform(node: CalloutNode): void {
  if (!node.children) return;
  for (const child of node.children) {
    if (child.type === "blockquote") applyCallout(child);
    transform(child);
  }
}

function applyCallout(quote: CalloutNode): void {
  const paragraph = quote.children?.[0];
  const lead = paragraph?.type === "paragraph" ? paragraph.children?.[0] : undefined;
  if (!paragraph || lead?.type !== "text" || typeof lead.value !== "string") return;

  const [firstLine = "", ...restLines] = lead.value.split("\n");
  const marker = MARKER.exec(firstLine);
  if (!marker) return;

  const [, rawType = "", collapse = "", title = ""] = marker;
  const type = rawType.toLowerCase();
  const collapsible = collapse === "-" || collapse === "+";

  // Drop the marker line; if it was all the node held, drop the node — and the paragraph
  // with it when the marker line was the whole paragraph.
  const remainder = restLines.join("\n");
  if (remainder) {
    lead.value = remainder;
  } else {
    paragraph.children = paragraph.children?.slice(1);
    if (paragraph.children?.length === 0) quote.children = quote.children?.slice(1);
  }

  quote.children = [
    {
      type: "calloutTitle",
      children: [{ type: "text", value: title.trim() || type.toUpperCase() }],
      data: { hName: collapsible ? "summary" : "p", hProperties: { className: "callout-title" } },
    },
    ...(quote.children ?? []),
  ];
  quote.data = {
    hName: collapsible ? "details" : "aside",
    hProperties: {
      className: `callout callout-${type}`,
      ...(collapse === "+" ? { open: true } : {}),
    },
  };
}
