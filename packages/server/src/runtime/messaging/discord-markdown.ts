/**
 * Renders a parsed Markdown reply into the subset Discord's client displays.
 *
 * Like WeChat, Discord reads Markdown itself — the same syntax the model wrote — so this
 * renderer subtracts rather than translates: it emits what the client renders and strips
 * the markers of what it does not, so an unsupported construct arrives as its own text
 * instead of as literal punctuation.
 *
 * ## What renders, and what does not
 *
 * Renders: headings H1–H3, bold, italic, strikethrough, links (masked `[text](url)` is
 * honoured in a bot's message), ordered and unordered lists with nesting, blockquotes,
 * inline code and fenced code with a language tag.
 *
 * Does not render, and is therefore reshaped:
 *
 *   - **H4 and deeper.** The client's heading scale stops at three levels; a fourth arrives
 *     as four literal `#`. The text becomes a bold line, which is what a chat reads as a
 *     heading.
 *   - **Tables.** No table syntax at all; the rows arrive in a code block, the one place
 *     pipe-separated columns line up.
 *   - **Horizontal rules.** `---` is shown as three characters. A short em-dash rule stands
 *     in, as on Telegram.
 *   - **Task-list boxes.** The client draws no checkbox, so the glyph is the checkbox.
 *   - **Images.** No inline image in message text; `![alt](url)` becomes a link the reader
 *     can follow, never a dropped URL. The reply's own pictures do not travel this way —
 *     they are uploaded as real attachments (see the connector's sendImage).
 *
 * ## Escaping
 *
 * Only literal TEXT is escaped, and only the characters that open a construct. Code — inline
 * or fenced — is emitted verbatim inside its own markers, because those markers are exactly
 * what makes the content literal on a channel that honours them.
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

/** One indent level inside a list: what the client nests on. */
const LIST_INDENT = "  ";

/** The deepest heading level the client renders; below this a heading becomes a bold line. */
const MAX_HEADING_DEPTH = 3;

/** What stands in for a horizontal rule, which the client does not draw. */
const RULE = "———";

/** Characters that open a construct wherever they appear. `\` leads, or it escapes the escapes. */
const INLINE_SPECIALS = /[\\`*_~[\]|]/g;

function esc(text: string): string {
  return text.replace(INLINE_SPECIALS, (ch) => `\\${ch}`);
}

/**
 * Escapes a marker a line happens to START with. These mean nothing mid-line, and escaping
 * them everywhere would put a backslash in every hyphenated word and every decimal number.
 * `-#` opens the client's subtext form, which the plain `-` escape already covers.
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

/** The longest backtick run inside a value, so a span can be fenced by one longer. */
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
      return `*${inline(node.children)}*`;
    case "delete":
      return `~~${inline(node.children)}~~`;
    case "inlineCode": {
      const fence = "`".repeat(longestBacktickRun(node.value) + 1);
      const pad = node.value.startsWith("`") || node.value.endsWith("`") ? " " : "";
      return `${fence}${pad}${node.value}${pad}${fence}`;
    }
    case "link": {
      const label = inline(node.children);
      return isSafeUrl(node.url) ? `[${label}](${href(node.url)})` : label;
    }
    case "image": {
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

/** Inline content as unformatted text, for a table cell inside a code block. */
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

/** A GFM table as pipe-separated rows, for the code block that keeps them aligned. */
function tableRows(node: Table): string[] {
  return node.children.map(
    (row) => `| ${row.children.map((cell) => plainText(cell.children)).join(" | ")} |`,
  );
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
      // Past the client's scale the markers would show as characters; a bold line is what a
      // chat reads as a heading anyway.
      return node.depth > MAX_HEADING_DEPTH ? `**${text}**` : `${"#".repeat(node.depth)} ${text}`;
    }
    case "code": {
      const fence = codeFence(node.value);
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
      return `\`\`\`\n${tableRows(node).join("\n")}\n\`\`\``;
    case "thematicBreak":
      return RULE;
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
 * One relayed message as the Markdown Discord renders. Blocks are separated by a blank
 * line throughout, so a list or a fence after ordinary text is recognized as a block.
 */
export function discordMarkdownOf(markdown: string): string {
  const root = parseMarkdown(markdown);
  return root.children
    .map((node) => block(node, ""))
    .filter((rendered) => rendered !== "")
    .join("\n\n")
    .trim();
}
