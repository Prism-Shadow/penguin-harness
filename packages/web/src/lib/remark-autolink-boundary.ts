/**
 * Where a bare URL ends.
 *
 * GFM's autolink-literal extension ends a bare URL at whitespace and then hands the tail to its own
 * "trail" check, which drops trailing punctuation — `*`, `_`, `~`, `)`, `.`, `,` and the rest. That
 * check only fires when the run is followed by whitespace, a `<`, or the end of the input, so it
 * never sees what CJK does to a sentence: `见 https://penguin.ooo，然后继续` is not
 * whitespace-separated after the host, so the comma and the clause after it are swallowed into the
 * href, which then 404s; `请**打开 http://127.0.0.1:4321/**查看` puts the closing `**` in the href
 * the same way. English is unaffected — `see https://penguin.ooo, then` already ends correctly.
 *
 * This pass re-applies the boundary where GFM stopped looking. On an autolink literal's URL only —
 * an explicit `[text](url)` link is never touched — it cuts from the right, repeatedly, until
 * nothing matches:
 *
 * - a run of non-ASCII characters. A URL is ASCII by RFC 3986; anything else belongs
 *   percent-encoded.
 * - a run of `*`, `~` or `` ` ``. Those are Markdown span markers, they are never meaningful at the
 *   end of a URL, and GFM's own trail already drops `*` and `~` when it gets to look.
 * - a run of `_`, but only when a text node before the link in the same parent holds one too. `_`
 *   is ordinary inside a path (`a_b`) and only reads as a closing marker when something opened.
 * - a single `)` or `]` that nothing inside the URL opened, or a `>` (a `<` ends a URL, so a
 *   trailing `>` never has a partner).
 *
 * Only a *trailing* run is ever cut, so `…/a_b` and `…?q=*b` keep what is in their middle.
 *
 * The cut characters are handed back to the paragraph as a text node, so the sentence keeps them.
 * What this cannot do is re-close the emphasis: emphasis is resolved while parsing and this runs on
 * the tree that came out, so a `**` handed back renders as the two characters it is. For the shape
 * this was written against that is what CommonMark asks for anyway — in `请**打开 <url>/**查看` the
 * closing `**` sits between a `/` and a CJK character, which is neither left- nor right-flanking,
 * and `请**打开 abc/**查看` is not bold either. The one shape where it differs is a URL ending in a
 * letter (`…/index**查看`), where the emphasis would have closed had the autolink not eaten the
 * markers; re-pairing delimiter runs on a finished tree is a whole second parser, so those markers
 * stay literal. Written with a space or a line end after the closing `**` the emphasis closes
 * during parsing, the markers never reach the URL, and this pass has nothing left to do.
 *
 * The trade the non-ASCII cut makes: a URL carrying *unencoded* CJK in its path — `…/wiki/中文`
 * pasted raw rather than percent-encoded — is trimmed at the last ASCII character. That form is
 * invalid per the RFC and browsers only accept it by encoding it for you; the same link pasted in
 * its encoded form is untouched.
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

/** Trailing Markdown span markers: emphasis, strikethrough and inline code, none of them URL syntax. */
const TRAILING_SPAN_MARKERS = /[*~`]+$/;

/** A trailing run of `_`, cut only when the paragraph opened emphasis with one. */
const TRAILING_UNDERSCORES = /_+$/;

/** Closers whose opener, if there is one, would be inside the URL. */
const CLOSERS: ReadonlyArray<readonly [close: string, open: string]> = [
  [")", "("],
  ["]", "["],
  [">", "<"],
];

/** True when this link came from autolinking rather than `[text](url)` syntax. */
function isAutolinkLiteral(node: LinkNode): boolean {
  if (node.children.length !== 1) return false;
  const child = node.children[0];
  if (!child || child.type !== "text") return false;
  const { value } = child as TextNode;
  // GFM sets url to the matched text, prefixing `http://` for a bare `www.` match.
  return node.url === value || node.url === `http://${value}`;
}

/** True when the final character of `value` closes something the rest of `value` never opened. */
function closesNothing(value: string, close: string, open: string): boolean {
  let depth = 0;
  for (const ch of value) {
    if (ch === open) depth += 1;
    else if (ch === close) depth -= 1;
  }
  return depth < 0;
}

/**
 * How much of `value` is still URL. Each cut can expose another — `…/**）` is a full-width bracket
 * over a `**` — so they run in a loop until the value stops shrinking.
 */
function boundaryOf(value: string, underscoreOpened: boolean): number {
  let kept = value;
  for (;;) {
    const before = kept;
    kept = kept.replace(TRAILING_NON_ASCII, "").replace(TRAILING_SPAN_MARKERS, "");
    if (underscoreOpened) kept = kept.replace(TRAILING_UNDERSCORES, "");
    for (const [close, open] of CLOSERS) {
      if (kept.endsWith(close) && closesNothing(kept, close, open)) kept = kept.slice(0, -1);
    }
    if (kept === before) return kept.length;
  }
}

/** The cut characters, as the text node they go back to, or null when the URL already ended right. */
function trimNode(node: LinkNode, underscoreOpened: boolean): TextNode | null {
  if (!isAutolinkLiteral(node)) return null;
  const child = node.children[0] as TextNode;
  const boundary = boundaryOf(child.value, underscoreOpened);
  if (boundary === child.value.length) return null;
  const kept = child.value.slice(0, boundary);
  // A "URL" that is punctuation or non-ASCII all the way to its scheme is not one this should be
  // splitting.
  if (!kept.includes("://") && !kept.startsWith("www.")) return null;
  const spilled = child.value.slice(boundary);
  child.value = kept;
  node.url = node.url.startsWith("http://") && !kept.startsWith("http") ? `http://${kept}` : kept;
  return { type: "text", value: spilled };
}

/**
 * Whether anything before this position in the same parent spells a `_`. The cheap stand-in for
 * "emphasis was opened with `_`": had the emphasis actually closed, the marker would be a node
 * boundary rather than text, so a `_` still sitting in the text is one that opened nothing yet.
 */
function underscoreOpenedBefore(children: Node[], index: number): boolean {
  for (let i = 0; i < index; i += 1) {
    const sibling = children[i]!;
    if (sibling.type === "text" && (sibling as TextNode).value.includes("_")) return true;
  }
  return false;
}

/** Walks every parent, so a link nested in emphasis or a list item is covered too. */
function walk(parent: Parent): void {
  for (let i = 0; i < parent.children.length; i += 1) {
    const node = parent.children[i]!;
    if (node.type === "link") {
      const spill = trimNode(node as LinkNode, underscoreOpenedBefore(parent.children, i));
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
