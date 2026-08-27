/**
 * Ends a bare URL at the last ASCII character.
 *
 * GFM's autolink-literal extension ends a bare URL at whitespace, then trims a short list of
 * trailing ASCII punctuation. Neither rule sees CJK: `见 https://penguin.ooo，然后继续` is not
 * whitespace-separated after the host, so the comma and the clause after it are swallowed into the
 * href, which then 404s, and the sentence loses its punctuation to link styling. English is
 * unaffected — `see https://penguin.ooo, then` already trims correctly — so this only ever fires on
 * text GFM was not written for.
 *
 * A URL is ASCII by RFC 3986; anything outside it belongs percent-encoded. So the boundary is the
 * last ASCII character, and a trailing non-ASCII run is handed back to the paragraph as text.
 *
 * The trade this makes: a URL carrying *unencoded* CJK in its path — `…/wiki/中文` pasted raw
 * rather than percent-encoded — is trimmed at the last ASCII character. That form is invalid per
 * the RFC and browsers only accept it by encoding it for you; the same link pasted in its encoded
 * form is untouched. Explicit `[text](url)` links are never touched at all.
 */
/**
 * The mdast shapes this touches, declared structurally rather than pulling `@types/mdast` in as a
 * dependency for three of them. Anything else on a node passes through untouched.
 */
interface TextNode {
  type: "text";
  value: string;
}
interface LinkNode {
  type: "link";
  url: string;
  children: Node[];
}
type Node = TextNode | LinkNode | { type: string; children?: Node[] };
interface Parent {
  children: Node[];
}

/** Trailing characters outside ASCII: never part of a well-formed URL. */
const TRAILING_NON_ASCII = /[^\x00-\x7F]+$/;

/** True when this link came from autolinking rather than `[text](url)` syntax. */
function isAutolinkLiteral(node: LinkNode): boolean {
  if (node.children.length !== 1) return false;
  const child = node.children[0];
  if (!child || child.type !== "text") return false;
  const { value } = child as TextNode;
  // GFM sets url to the matched text, prefixing `http://` for a bare `www.` match.
  return node.url === value || node.url === `http://${value}`;
}

function trimNode(node: LinkNode): TextNode | null {
  if (!isAutolinkLiteral(node)) return null;
  const child = node.children[0] as TextNode;
  const match = TRAILING_NON_ASCII.exec(child.value);
  if (!match) return null;
  const kept = child.value.slice(0, match.index);
  // A "URL" that is non-ASCII all the way to its scheme is not one this should be splitting.
  if (!kept.includes("://") && !kept.startsWith("www.")) return null;
  child.value = kept;
  node.url = node.url.startsWith("http://") && !kept.startsWith("http") ? `http://${kept}` : kept;
  return { type: "text", value: match[0] };
}

/** Walks every parent, so a link nested in emphasis or a list item is covered too. */
function walk(parent: Parent): void {
  for (let i = 0; i < parent.children.length; i += 1) {
    const node = parent.children[i]!;
    if (node.type === "link") {
      const spill = trimNode(node as LinkNode);
      if (spill) parent.children.splice(i + 1, 0, spill);
    }
    const children = (node as { children?: Node[] }).children;
    if (Array.isArray(children)) walk(node as Parent);
  }
}

/** Runs after remark-gfm, on the tree it produced. */
export function remarkAutolinkBoundary() {
  return (tree: Parent): void => walk(tree);
}
