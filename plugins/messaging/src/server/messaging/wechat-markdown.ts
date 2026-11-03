/**
 * Renders a parsed Markdown reply into the subset WeChat's own client displays.
 *
 * This channel is the odd one of the four, and the difference is worth stating before the
 * code: Telegram, Feishu and QQ each take a DIFFERENT markup, so their renderers translate.
 * WeChat reads Markdown itself — the same syntax the model wrote — so this renderer's job is
 * not translation but SUBTRACTION: emit what the client renders, and strip the markers of
 * what it does not, so an unsupported construct arrives as its own text instead of as
 * literal punctuation.
 *
 * ## What renders, and what does not
 *
 * Renders: headings H1–H4, bold, strikethrough, links, ordered and unordered lists with
 * nesting, blockquotes, horizontal rules, INLINE CODE, FENCED CODE and TABLES. That last
 * trio makes this the widest of the four channels for the kind of reply this product
 * actually writes — QQ has no code and no tables, Telegram has no lists, headings or tables.
 *
 * Does not render, and is therefore stripped to its content:
 *
 *   - **H5 and H6.** The client's heading scale stops at four levels; a fifth arrives as
 *     five literal `#`. The text becomes an ordinary paragraph, which is what a heading too
 *     deep to show was already going to look like.
 *   - **Emphasis around CJK.** `*text*` needs the marker to sit against a word boundary, and
 *     CJK text has none, so `*中文*` renders as asterisks around Chinese. Latin emphasis is
 *     kept because it does render; a CJK run loses the markers and keeps the words. This is
 *     why emphasis is decided per node rather than once.
 *   - **Images.** The client has no inline image in a text message, and `![alt](url)` shows
 *     as its own characters. It becomes a LINK rather than being dropped: a link is a thing
 *     the reader can follow, and dropping the node would silently lose a URL the reply
 *     deliberately included. The reply's own pictures do not travel this way at all — they
 *     are sent as real images (see the connector's sendImage).
 *
 * ## Escaping
 *
 * Only literal TEXT is escaped, and only the characters that open a construct. Code — inline
 * or fenced — is emitted verbatim inside its own markers, because those markers are exactly
 * what makes the content literal on a channel that honours them. Escaping inside a fence
 * would put backslashes into code the reader is meant to copy, which is the whole point of
 * putting it in a chat.
 */
import { isSafeUrl, parseMarkdown } from "./markdown.js";
import type {
  BlockContent,
  DefinitionContent,
  Emphasis,
  List,
  ListItem,
  PhrasingContent,
  RootContent,
  Table,
} from "mdast";

/** One indent level inside a list. Four spaces is what the client's parser nests on. */
const LIST_INDENT = "    ";

/** The deepest heading level the client renders; below this the markers are dropped. */
const MAX_HEADING_DEPTH = 4;

/** Characters that open a construct wherever they appear. `\` leads, or it escapes the escapes. */
const INLINE_SPECIALS = /[\\`*_~[\]]/g;

/**
 * Any CJK codepoint: the Unified ideographs and their extension A, plus the kana and Hangul
 * blocks and CJK punctuation. Emphasis around any of these does not render (see the module
 * doc), and the test is on the whole run rather than its edges because the client's rule is
 * about word boundaries, which such a run has nowhere.
 */
const CJK = /[⺀-〿぀-ヿ㐀-䶿一-鿿가-힯豈-﫿＀-￯]/;

function esc(text: string): string {
  return text.replace(INLINE_SPECIALS, (ch) => `\\${ch}`);
}

/**
 * Escapes a marker a line happens to START with. These mean nothing mid-line, and escaping
 * them everywhere would put a backslash in every hyphenated word and every decimal number.
 */
function guardLineStarts(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/^(\s*)([#>\-+])/, "$1\\$2").replace(/^(\s*\d+)([.)])/, "$1\\$2"))
    .join("\n");
}

/** A link target, with the two characters that would close the `](…)` early made safe. */
function href(url: string): string {
  return url.replaceAll("(", "%28").replaceAll(")", "%29");
}

function inline(nodes: readonly PhrasingContent[]): string {
  return nodes.map(phrasing).join("");
}

/**
 * Emphasis renders only where its markers sit against a word boundary, which is why this is
 * a decision and not a template: a run containing CJK keeps its words and loses the
 * asterisks that would otherwise be shown as asterisks.
 */
function emphasis(node: Emphasis): string {
  const body = inline(node.children);
  return CJK.test(body) ? body : `*${body}*`;
}

/**
 * The longest backtick run inside a value, so an inline span can be fenced by one longer.
 * Code containing a backtick is ordinary in this product's replies, and a single-backtick
 * span would end at the first one it contains.
 */
function longestBacktickRun(value: string): number {
  let longest = 0;
  for (const run of value.matchAll(/`+/g)) longest = Math.max(longest, run[0].length);
  return longest;
}

function phrasing(node: PhrasingContent): string {
  switch (node.type) {
    case "text":
      return esc(node.value);
    case "strong":
      return `**${inline(node.children)}**`;
    case "emphasis":
      return emphasis(node);
    case "delete":
      return `~~${inline(node.children)}~~`;
    case "inlineCode": {
      // Verbatim inside a fence long enough to contain it, and padded when the value starts
      // or ends with a backtick — both are CommonMark's own rules for the case.
      const fence = "`".repeat(longestBacktickRun(node.value) + 1);
      const pad = node.value.startsWith("`") || node.value.endsWith("`") ? " " : "";
      return `${fence}${pad}${node.value}${pad}${fence}`;
    }
    case "link": {
      const label = inline(node.children);
      return isSafeUrl(node.url) ? `[${label}](${href(node.url)})` : label;
    }
    case "image": {
      // A link rather than a dropped node — see the module doc.
      const alt = node.alt ?? "";
      const label = esc(alt !== "" ? alt : node.url);
      return isSafeUrl(node.url) ? `[${label}](${href(node.url)})` : label;
    }
    case "break":
      return "\n";
    case "html":
      return esc(node.value);
    case "footnoteReference":
      return esc(`[^${node.identifier}]`);
    case "linkReference":
    case "imageReference":
      return "children" in node ? inline(node.children) : esc(node.label ?? node.identifier);
    default:
      return "";
  }
}

/**
 * Inline content as unformatted text, for a table cell (whose content may not be a block).
 *
 * Escaped like any other literal text: a cell is still markdown to the client, so a `*` or a
 * backtick that arrived as content would open a construct inside the table rather than being
 * shown. Only `|` was escaped here before, which closed the column hazard and left that one.
 */
function plainText(nodes: readonly PhrasingContent[]): string {
  return nodes
    .map((node) => {
      if (node.type === "text" || node.type === "inlineCode" || node.type === "html") {
        return esc(node.value);
      }
      if (node.type === "break") return " ";
      if (node.type === "image") return node.alt ?? "";
      return "children" in node ? plainText(node.children) : "";
    })
    .join("");
}

/**
 * A GFM table, kept as a table. The client renders one, so the delimiter row is emitted and
 * a cell's own pipes are escaped rather than allowed to open a column that is not there.
 */
function renderTable(node: Table): string {
  const rows = node.children.map(
    (row) =>
      `| ${row.children.map((cell) => plainText(cell.children).replaceAll("|", "\\|")).join(" | ")} |`,
  );
  const header = rows[0];
  if (header === undefined) return "";
  const columns = node.children[0]?.children.length ?? 0;
  return [header, `|${" --- |".repeat(columns)}`, ...rows.slice(1)].join("\n");
}

function itemMarker(list: List, index: number): string {
  return list.ordered === true ? `${(list.start ?? 1) + index}. ` : "- ";
}

/** A GFM task item's box. The client draws no checkbox, so the glyph is the checkbox. */
function itemCheckbox(item: ListItem): string {
  if (item.checked === true) return "☑ ";
  if (item.checked === false) return "☐ ";
  return "";
}

function renderList(list: List, indent: string): string {
  return list.children
    .map((item, i) => {
      const head = `${indent}${itemMarker(list, i)}${itemCheckbox(item)}`;
      const parts: string[] = [];
      for (const [j, child] of item.children.entries()) {
        if (j === 0 && child.type === "paragraph") {
          parts.push(head + inline(child.children));
          continue;
        }
        if (child.type === "list") {
          parts.push(renderList(child, indent + LIST_INDENT));
          continue;
        }
        const rendered = block(child, indent + LIST_INDENT);
        if (rendered !== "") {
          parts.push(
            rendered
              .split("\n")
              .map((line) => indent + LIST_INDENT + line)
              .join("\n"),
          );
        }
      }
      return parts.filter((part) => part !== "").join("\n");
    })
    .filter((line) => line !== "")
    .join("\n");
}

/** A fence long enough to contain the block's own backticks (CommonMark's rule). */
function codeFence(value: string): string {
  return "`".repeat(Math.max(3, longestBacktickRun(value) + 1));
}

function block(node: BlockContent | DefinitionContent | RootContent, indent: string): string {
  switch (node.type) {
    case "paragraph":
      return guardLineStarts(inline(node.children));
    case "heading": {
      const text = inline(node.children);
      // Past the client's scale the markers would show as characters, so the heading becomes
      // the paragraph it was already going to look like.
      return node.depth > MAX_HEADING_DEPTH
        ? guardLineStarts(text)
        : `${"#".repeat(node.depth)} ${text}`;
    }
    case "code": {
      const fence = codeFence(node.value);
      // The language tag is kept: the client highlights by it, and it costs nothing where
      // the client does not.
      return `${fence}${node.lang ?? ""}\n${node.value}\n${fence}`;
    }
    case "blockquote":
      return node.children
        .map((child) => block(child, indent))
        .filter((rendered) => rendered !== "")
        .join("\n\n")
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    case "list":
      return renderList(node, indent);
    case "table":
      return renderTable(node);
    case "thematicBreak":
      return "---";
    case "html":
      return guardLineStarts(esc(node.value));
    case "footnoteDefinition":
      return `**${esc(`[^${node.identifier}]`)}** ${node.children.map((child) => block(child, indent)).join("\n\n")}`;
    case "definition":
      return "";
    default:
      return "";
  }
}

/**
 * One relayed message as the Markdown WeChat renders.
 *
 * Blocks are separated by a blank line throughout: a list or a fence that follows ordinary
 * text without one is not recognized as a block at all, which is the failure that shows a
 * reader raw `-` bullets.
 */
export function wechatMarkdownOf(markdown: string): string {
  const root = parseMarkdown(markdown);
  return root.children
    .map((node) => block(node, ""))
    .filter((rendered) => rendered !== "")
    .join("\n\n")
    .trim();
}
