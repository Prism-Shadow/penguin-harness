/**
 * The half of Markdown relaying that must not differ per channel: reading the model's
 * reply as Markdown, and deciding where a reply too long for one message may be cut.
 *
 * It sits beside the connectors for the same reason media.ts does. The Agent writes one
 * reply, and which constructs that reply CONTAINS is a fact about the text, not about the
 * chat it lands in — so the dialect is fixed here (CommonMark plus GFM, matching what the
 * web transcript renders) and each connector renders the resulting tree into its own
 * markup. A channel that parsed for itself would disagree with the others about what the
 * model wrote, and the same reply would then carry different content in two chats.
 *
 * The parser is `remark-parse` + `remark-gfm` over `unified` — the stack packages/web
 * already renders Markdown with, so the two surfaces read a reply the same way. A parser
 * is not something to hand-roll here: emphasis, links and fenced code are context-
 * sensitive, and a substitution pass mangles exactly the replies (code containing
 * asterisks, nested emphasis, links with parentheses) that make the feature worth having.
 *
 * The RENDER is deliberately not shared. Four channels accept four different subsets —
 * Telegram has code and no headings, lists or tables; Feishu has all of them; QQ has
 * headings and lists but no code and no tables; WeChat reads Markdown itself, so its
 * renderer subtracts what the client will not show rather than translating — over three
 * different markups and four different escaping rules. A printer parameterised over that
 * would be a table of capability flags whose every branch belongs to exactly one channel,
 * which is the connector's own job under a name that hides it. So each channel renders this
 * tree itself: telegram-html.ts, feishu-card.ts, qq-markdown.ts and wechat-markdown.ts, each
 * beside the adapter that sends its output. Nothing in this module knows any channel's
 * markup.
 */
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import type { Nodes, Root, RootContent } from "mdast";

/**
 * The one processor, built once: `unified` compiles the extension lists on first use, and
 * a fresh processor per relayed message would redo that for every reply. Parsing is
 * stateless, so one instance serves every binding.
 */
const processor = unified().use(remarkParse).use(remarkGfm);

/** Reads a reply as Markdown. Never throws: any text at all is a valid document. */
export function parseMarkdown(text: string): Root {
  return processor.parse(text);
}

/**
 * The URL schemes a rendered link may point at.
 *
 * Shared for the same reason the parse is: the reply is model output steerable by whoever
 * is in the chat, and which destinations a link may name is a safety answer, not a
 * presentation one — it cannot come out differently on two channels. Everything else
 * renders as its own label text, so nothing is hidden from the reader, only made
 * unclickable.
 */
const SAFE_LINK_SCHEMES: ReadonlySet<string> = new Set([
  "http:",
  "https:",
  "mailto:",
  "tel:",
  "tg:",
]);

/** Whether a Markdown link's target may be rendered as a link at all (see SAFE_LINK_SCHEMES). */
export function isSafeUrl(url: string): boolean {
  // A scheme-relative or in-document target carries no scheme to object to; a bare relative
  // path has nowhere to resolve against in a chat, but it cannot execute either.
  if (url === "" || url.startsWith("#")) return false;
  try {
    return SAFE_LINK_SCHEMES.has(new URL(url, "https://example.invalid/").protocol);
  } catch {
    return false;
  }
}

/**
 * A node's source span. Every node a parse produces carries one; the type is optional
 * because mdast allows synthesised trees, which nothing here builds.
 */
function spanOf(node: Nodes): { from: number; to: number } | null {
  const { position } = node;
  if (position?.start.offset === undefined || position.end.offset === undefined) return null;
  return { from: position.start.offset, to: position.end.offset };
}

/**
 * Parents whose children are BLOCKS rather than inline content, so a cut between two of
 * them must be moved back to the start of its source line.
 *
 * The prefix is why. A blockquote's second paragraph starts after the `> ` that introduces
 * it, and a list item's after its `- `; cutting at the child's own offset would open the
 * next message with a line whose marker was left behind in the previous one, and the
 * construct would be gone. Inline parents get the opposite treatment — their children all
 * sit on one line, and snapping would collapse every candidate onto the same offset.
 */
const BLOCK_PARENTS: ReadonlySet<string> = new Set([
  "root",
  "blockquote",
  "list",
  "listItem",
  "table",
  "footnoteDefinition",
]);

/** The offset of the start of the source line `offset` sits on. */
function lineStart(text: string, offset: number): number {
  return text.lastIndexOf("\n", offset - 1) + 1;
}

/** The longest run of backticks in a string — what a fence has to beat to close correctly. */
function longestBacktickRun(value: string): number {
  let best = 0;
  let run = 0;
  for (const ch of value) {
    run = ch === "`" ? run + 1 : 0;
    if (run > best) best = run;
  }
  return best;
}

/**
 * Splits a string at hard character boundaries, preferring the last whitespace in each
 * window. The last resort under every other rule below: reached only by a single
 * unbreakable line longer than one whole message.
 */
function splitHard(text: string, max: number): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    const space = window.search(/\s\S*$/);
    // Only a break in the window's back half is worth taking — an early one would produce a
    // tiny fragment and many more messages.
    const cut = space > max / 2 ? space : max;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\s+/, "");
  }
  if (rest !== "") out.push(rest);
  return out;
}

/**
 * Splits a span at its own line boundaries, keeping every line whole.
 *
 * The fallback for a block with no usable interior structure, and line-aligned because the
 * markers that make a block what it is live at the front of each of its lines: a blockquote
 * continued into a second message still opens each line with `>`, a list still opens each
 * item with its bullet.
 */
function splitLines(src: string, max: number): string[] {
  const out: string[] = [];
  let buf = "";
  for (const line of src.split("\n")) {
    if (buf !== "" && buf.length + 1 + line.length > max) {
      out.push(buf);
      buf = "";
    }
    if (line.length > max) {
      if (buf !== "") {
        out.push(buf);
        buf = "";
      }
      for (const piece of splitHard(line, max)) out.push(piece);
      continue;
    }
    buf = buf === "" ? line : `${buf}\n${line}`;
  }
  if (buf !== "") out.push(buf);
  return out;
}

/**
 * Splits a fenced code block into several fenced code blocks.
 *
 * A code fence is the one construct whose halves cannot simply be handed to two messages:
 * the opening fence would run to the end of the first and the remainder would arrive as
 * prose, so the second half loses both its monospacing and the escaping that keeps its
 * contents from being read as markup. Each piece is therefore re-opened and re-closed with
 * the same language, and every message reads as the code block it is part of.
 */
function splitFencedCode(value: string, lang: string | null | undefined, max: number): string[] {
  const language = typeof lang === "string" ? lang : "";
  const fence = "`".repeat(Math.max(3, longestBacktickRun(value) + 1));
  const open = `${fence}${language}`;
  const room = max - open.length - fence.length - 2; // the two newlines around the body
  if (room <= 0) return splitHard(value, max); // a max this small has no room for a fence
  return splitLines(value, room).map((piece) => `${open}\n${piece}\n${fence}`);
}

/**
 * Splits one over-long block, preferring the boundaries between its own children.
 *
 * The children of a paragraph are its inline runs, so cutting between two of them is what
 * keeps a `**bold**` or a `[link](…)` out of two messages — split through one, neither
 * half renders as anything and the reader gets the asterisks. Where the children give no
 * usable cut (one enormous child, or none at all) the line splitter takes over.
 */
function splitBlock(text: string, node: RootContent, max: number): string[] {
  const span = spanOf(node);
  if (span === null) return [];
  const src = text.slice(span.from, span.to);
  if (src.length <= max) return [src];
  if (node.type === "code") return splitFencedCode(node.value, node.lang, max);
  const children: readonly Nodes[] = "children" in node ? node.children : [];
  const snap = BLOCK_PARENTS.has(node.type);
  // Ascending, deduped cut offsets strictly inside the block. The first child's start is
  // not one: everything before it (a list's bullet, a heading's hashes) belongs with it.
  const cuts: number[] = [];
  for (const child of children.slice(1)) {
    const childSpan = spanOf(child);
    if (childSpan === null) continue;
    const at = snap ? lineStart(text, childSpan.from) : childSpan.from;
    if (at > span.from && at < span.to && at !== cuts.at(-1)) cuts.push(at);
  }
  if (cuts.length === 0) return splitLines(src, max);
  const bounds = [span.from, ...cuts, span.to];
  const out: string[] = [];
  let buf = "";
  for (let i = 0; i + 1 < bounds.length; i += 1) {
    const piece = text.slice(bounds[i]!, bounds[i + 1]!);
    if (buf !== "" && buf.length + piece.length > max) {
      out.push(buf);
      buf = "";
    }
    if (piece.length > max) {
      if (buf !== "") {
        out.push(buf);
        buf = "";
      }
      for (const part of splitLines(piece, max)) out.push(part);
      continue;
    }
    buf += piece;
  }
  if (buf !== "") out.push(buf);
  return out;
}

/**
 * Splits a Markdown reply into pieces of at most `max` characters, each of which parses on
 * its own as the Markdown it was part of.
 *
 * The plain-text chunker splits wherever a newline happens to fall near the limit, which is
 * fine for text and wrong for markup: a cut between a construct's halves costs the
 * construct on every channel, and on a channel with a strict parser it costs the whole
 * message's formatting — the reply still arrives, stripped, through the connector's
 * fallback, which is the quiet failure this avoids. So the cut is taken at a boundary the
 * document actually has: between two top-level blocks first, then inside the one block that
 * is itself too long (see splitBlock), and only then at characters.
 *
 * The pieces are slices of the ORIGINAL source, whitespace between blocks included, so a
 * reply that fits in one message is returned byte for byte.
 */
export function chunkMarkdown(text: string, max: number): string[] {
  const trimmed = text.trim();
  if (trimmed === "") return [];
  if (trimmed.length <= max) return [trimmed];
  const root = parseMarkdown(text);
  const out: string[] = [];
  let buf = "";
  const flush = (): void => {
    const piece = buf.trim();
    if (piece !== "") out.push(piece);
    buf = "";
  };
  const blocks = root.children;
  for (const [i, block] of blocks.entries()) {
    const span = spanOf(block);
    if (span === null) continue;
    // Up to the NEXT block's start rather than this one's end: the blank line between two
    // paragraphs is what keeps them two paragraphs, and it belongs to whichever message
    // keeps both of them.
    const to = spanOf(blocks[i + 1] ?? block)?.from ?? span.to;
    const src = text.slice(span.from, Math.max(to, span.to));
    if (src.trimEnd().length > max) {
      flush();
      for (const piece of splitBlock(text, block, max)) {
        buf = piece;
        flush();
      }
      continue;
    }
    if (buf !== "" && (buf + src).trimEnd().length > max) flush();
    buf += src;
  }
  flush();
  return out;
}
