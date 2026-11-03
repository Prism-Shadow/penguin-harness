/**
 * Renders a parsed Markdown reply into QQ's free-form Markdown message
 * (https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/type/markdown.html),
 * carried by `msg_type: 2` as `markdown.content`.
 *
 * The platform's own subset, and it is a third shape again rather than a smaller Feishu:
 * headings, bold, italic, strikethrough, links, images, ordered and unordered lists with
 * nesting, blockquotes, horizontal rules and line breaks all render — while INLINE CODE,
 * FENCED CODE and TABLES have no syntax at all here. QQ renders headings and lists that
 * Telegram cannot, and cannot render the code that both other channels can.
 *
 * ## Code, which is most of what this product writes
 *
 * There is no monospaced anything to fall back to, so the deliberate answer is: a code
 * block's lines go out as ordinary lines, escaped, with a blank line above and below to set
 * the block off from the prose around it. The alternatives were considered and rejected —
 * a fence arrives as six literal backticks, an indent spends the narrow width a phone gives
 * on nothing, and a per-line marker corrupts the copy-paste that is the whole point of
 * putting code in a chat. Inline code loses its backticks the same way and becomes its own
 * text. The language tag has nowhere to go and is dropped.
 *
 * ## Escaping
 *
 * The platform documents NO escaping rule — not entities like Feishu, not backslashes.
 * Backslash escaping is what every Markdown implementation this syntax is derived from
 * supports, so that is what this emits, and the choice is safe in the direction that
 * matters: if QQ honours it, the text is exact; if it does not, a `\` becomes visible in
 * front of a character that is already there. Escaping can only ever ADD a character.
 * Leaving code unescaped cannot — `# comment` would become a heading and `_name_` would
 * become italics, and both LOSE the characters they ate. For a channel with no documented
 * escape, never losing a character is the invariant to hold.
 *
 * The always-escaped set is what means something anywhere; `#`, `>`, the bullets and the
 * ordered markers mean something only at the head of a line and are escaped only there, so
 * ordinary hyphens and decimals stay ordinary.
 */
import { isSafeUrl, parseMarkdown } from "./markdown.js";
import type {
  BlockContent,
  DefinitionContent,
  List,
  ListItem,
  PhrasingContent,
  RootContent,
  Table,
} from "mdast";

/** One indent level inside a list, as the platform's own documentation specifies. */
const LIST_INDENT = "    ";

/** The horizontal rule QQ documents. `---` is not it. */
const RULE = "***";

/** Characters that open a construct wherever they appear. `\` leads, or it would escape the escapes. */
const INLINE_SPECIALS = /[\\`*_~[\]<]/g;

/** Backslash-escapes literal text (see the module doc for why backslashes and not entities). */
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
    .map((line) => line.replace(/^(\s*)([#>\-+=])/, "$1\\$2").replace(/^(\s*\d+)([.)])/, "$1\\$2"))
    .join("\n");
}

/** Every line of a block escaped as literal text, markers included. */
function escLines(value: string): string {
  return guardLineStarts(esc(value));
}

/** A link target, with the two characters that would close the `](…)` early made safe. */
function href(url: string): string {
  return url.replaceAll("(", "%28").replaceAll(")", "%29");
}

function inline(nodes: readonly PhrasingContent[]): string {
  return nodes.map(phrasing).join("");
}

function phrasing(node: PhrasingContent): string {
  switch (node.type) {
    case "text":
      return esc(node.value);
    case "strong":
      return `**${inline(node.children)}**`;
    case "emphasis":
      // `*text*` rather than `_text_`: both are documented, and the asterisk form cannot be
      // confused with the underscores in an identifier.
      return `*${inline(node.children)}*`;
    case "delete":
      return `~~${inline(node.children)}~~`;
    case "inlineCode":
      // No inline code on this channel — the backticks would arrive as backticks.
      return esc(node.value);
    case "link": {
      const label = inline(node.children);
      return isSafeUrl(node.url) ? `[${label}](${href(node.url)})` : label;
    }
    case "image": {
      // QQ's image syntax needs pixel dimensions and a publicly reachable URL, neither of
      // which a reply's `![alt](…)` carries — so a remote image is a link, like everywhere
      // else here. The reply's own pictures cannot travel on this channel at all (see
      // qq-connector's refuseMedia).
      const alt = node.alt ?? "";
      const label = esc(alt !== "" ? alt : node.url);
      return isSafeUrl(node.url) ? `[${label}](${href(node.url)})` : label;
    }
    case "break":
      // A newline IS a line break here: the platform's own example separates lines with one
      // and needs no blank line between them.
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

/** Inline content as unformatted text, for the rows of a table that cannot be a table. */
function plainText(nodes: readonly PhrasingContent[]): string {
  return nodes
    .map((node) => {
      if (node.type === "text" || node.type === "inlineCode" || node.type === "html") {
        return node.value;
      }
      if (node.type === "break") return " ";
      if (node.type === "image") return node.alt ?? "";
      return "children" in node ? plainText(node.children) : "";
    })
    .join("");
}

/**
 * A table's rows as lines. There is no table syntax here and no monospace to align one in,
 * so the pipes stay: they are what still says which value belongs to which column.
 */
function renderTable(node: Table): string {
  return escLines(
    node.children
      .map((row) => `| ${row.children.map((cell) => plainText(cell.children)).join(" | ")} |`)
      .join("\n"),
  );
}

function itemMarker(list: List, index: number): string {
  return list.ordered === true ? `${(list.start ?? 1) + index}. ` : "- ";
}

/** A GFM task item's box. QQ has no checkbox, so the glyph is the checkbox. */
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

function block(node: BlockContent | DefinitionContent | RootContent, indent: string): string {
  switch (node.type) {
    case "paragraph":
      return guardLineStarts(inline(node.children));
    case "heading":
      return `${"#".repeat(Math.min(node.depth, 6))} ${inline(node.children)}`;
    case "code":
      // Plain escaped lines — see the module doc. The blank lines around every block put
      // this one on its own, which is all the setting-apart the channel offers.
      return escLines(node.value);
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
      return RULE;
    case "html":
      return escLines(node.value);
    case "footnoteDefinition":
      return `**${esc(`[^${node.identifier}]`)}** ${node.children.map((child) => block(child, indent)).join("\n\n")}`;
    case "definition":
      return "";
    default:
      return "";
  }
}

/**
 * One relayed message as QQ Markdown.
 *
 * Blocks are separated by a blank line throughout, which the platform requires in the one
 * case it names — "a list preceded by ordinary text needs a blank line before it, or it is
 * not recognized" — and tolerates everywhere else.
 */
export function qqMarkdownOf(markdown: string): string {
  const root = parseMarkdown(markdown);
  return root.children
    .map((node) => block(node, ""))
    .filter((rendered) => rendered !== "")
    .join("\n\n")
    .trim();
}
