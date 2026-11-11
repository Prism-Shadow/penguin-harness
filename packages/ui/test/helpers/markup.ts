/**
 * Static markup read back as a tree, for the suites that ask a rendered component for an
 * attribute: the value, wherever the renderer put it among the others, and the element it sits
 * on. The same reader as the Web App's `test/helpers/markup.ts`.
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

/** The element children of `node`, in order. */
export function childElements(node: MarkupElement): MarkupElement[] {
  return node.children.filter((child): child is MarkupElement => typeof child !== "string");
}

/** Every element under `node`, depth first. */
export function elementsOf(node: MarkupElement): MarkupElement[] {
  return childElements(node).flatMap((child) => [child, ...elementsOf(child)]);
}
