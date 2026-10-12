/**
 * Static markup read back as a tree, for the node suite, which has no DOM: what a test needs of a
 * rendered component that its element tree does not show — the attributes the shared package's
 * components write, and the words a reader sees.
 *
 * It reads what `renderToStaticMarkup` writes and nothing more: double-quoted attributes, the
 * escapes React emits, void elements closed as `<br/>`, every other element closed by its own
 * end tag. Anything else is an error rather than a guess, so a test never passes on markup it
 * misread.
 */

export interface MarkupElement {
  readonly tag: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly children: MarkupNode[];
  readonly parent: MarkupElement | null;
}

/** An element, or a run of text. */
export type MarkupNode = MarkupElement | string;

const TOKEN =
  /<\/([a-zA-Z][\w-]*)>|<([a-zA-Z][\w-]*)((?:\s+[^\s"'>/=]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/g;
const ATTRIBUTE = /([^\s"'>/=]+)(?:="([^"]*)")?/g;
const VOID = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);
const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#x27;": "'",
  "&#39;": "'",
};

const decode = (text: string) =>
  text.replace(/&(?:amp|lt|gt|quot|#x27|#39);/g, (entity) => ENTITIES[entity]!);

/** The markup as one root element, tagged `#root`, holding its top-level nodes. */
export function readMarkup(html: string): MarkupElement {
  const root: MarkupElement = { tag: "#root", attrs: {}, children: [], parent: null };
  let open = root;
  let at = 0;
  for (const match of html.matchAll(TOKEN)) {
    if (match.index !== at) throw new Error(`markup: cannot read ${html.slice(at, at + 40)}`);
    at = match.index + match[0].length;
    const [, end, tag, attrs, selfClosed, text] = match;
    if (text !== undefined) {
      open.children.push(decode(text));
    } else if (end !== undefined) {
      if (end !== open.tag) throw new Error(`markup: </${end}> closes <${open.tag}>`);
      open = open.parent!;
    } else {
      const read: Record<string, string> = {};
      for (const [, name, value] of attrs!.matchAll(ATTRIBUTE)) read[name!] = decode(value ?? "");
      const element: MarkupElement = { tag: tag!, attrs: read, children: [], parent: open };
      open.children.push(element);
      if (selfClosed !== "/" && !VOID.has(tag!)) open = element;
    }
  }
  if (at !== html.length) throw new Error(`markup: cannot read ${html.slice(at, at + 40)}`);
  if (open !== root) throw new Error(`markup: <${open.tag}> is never closed`);
  return root;
}

/** Every element under `node`, depth first. */
export function elementsOf(node: MarkupElement): MarkupElement[] {
  return node.children.flatMap((child) =>
    typeof child === "string" ? [] : [child, ...elementsOf(child)],
  );
}

/** An element a reader cannot see: screen-reader-only copy, or anything `hidden`. */
const unseen = (element: MarkupElement) =>
  "hidden" in element.attrs || /(?:^|\s)sr-only(?:\s|$)/.test(element.attrs.class ?? "");

/** The words a reader sees in a node, run together: screen-reader-only and hidden text left out. */
export function seenText(node: MarkupNode): string {
  if (typeof node === "string") return node;
  return unseen(node) ? "" : node.children.map(seenText).join("");
}
