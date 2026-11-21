/**
 * Renders a parsed Markdown reply into a Feishu interactive card.
 *
 * Feishu's plain `text` message shows exactly what it is given, so a reply reaches it as
 * `**bold**`. The rich-text component of a JSON 2.0 card is what renders instead
 * (https://open.feishu.cn/document/feishu-cards/card-json-v2-components/content-components/rich-text):
 * `{"tag": "markdown", "content": …}` inside `{"schema": "2.0", "body": {"elements": […]}}`,
 * sent as `msg_type: "interactive"` with the card JSON serialized into `content`.
 *
 * This is the widest of the three channels: headings 1–6, bold, italic, strikethrough,
 * inline code, fenced code with a language, ordered and unordered lists with nesting,
 * blockquotes, horizontal rules, links and tables all render. So the output is Markdown
 * again rather than another markup — but Feishu's Markdown, not the model's, and the two
 * differ in the three places below.
 *
 * ## Escaping
 *
 * Feishu's rule is HTML entities, not backslashes: "if the character you want to display
 * matches special markdown characters (such as `*`, `~`, `>`, `<`), you must perform HTML
 * entity escaping". Its table is `&#60; &#62; &#42; &#91; &#93; &#35; &#92;` plus `&sim;`
 * for `~`. Two deliberate departures from that table:
 *
 * - `~` is written `&#126;`, not the documented `&sim;`. `&sim;` is U+223C TILDE OPERATOR,
 *   a different character from the one the model typed; every other entry in the table is
 *   the numeric entity for its own character, and the decoder that reads those reads this.
 * - `` ` `` is added, as `&#96;`. It is not in the table, and it is live syntax here since
 *   inline code renders — an unescaped stray backtick swallows the text up to the next one,
 *   which loses content rather than merely showing it oddly.
 *
 * `&` is escaped first, and to `&amp;`, or the entities above would be escaped by each
 * other. `_` is deliberately NOT escaped: the documented emphasis marker is `*`, and this
 * product's replies are full of snake_case identifiers that five characters of entity would
 * disfigure on every line.
 *
 * ## Tables
 *
 * The component renders at most 5 data rows per table and at most 4 tables. Past either
 * limit the rows are simply not shown — a silent truncation, and the wrong failure for a
 * reply whose point is usually the numbers. An over-limit table is therefore rendered as a
 * fenced code block of its own rows instead: monospaced, complete, and aligned, which is
 * what the table was for.
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

/** The card envelope Feishu's `msg_type: "interactive"` carries, serialized into `content`. */
export interface FeishuCard {
  schema: "2.0";
  body: { elements: { tag: "markdown"; content: string }[] };
}

/** How many data rows one rich-text table may carry, and how many tables one component may hold. */
const TABLE_MAX_ROWS = 5;
const TABLE_MAX_PER_MESSAGE = 4;

/** One indent level inside a list, as the component's own documentation specifies. */
const LIST_INDENT = "    ";

const ENTITIES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&#60;",
  ">": "&#62;",
  "*": "&#42;",
  "~": "&#126;",
  "[": "&#91;",
  "]": "&#93;",
  "#": "&#35;",
  "\\": "&#92;",
  "`": "&#96;",
};

const ESCAPABLE = /[&<>*~[\]#\\`]/g;

/**
 * Entity-escapes literal text so Feishu shows the characters the model typed (see the module
 * doc).
 *
 * ONE pass, not one pass per character. A replacement per entry would feed its own output
 * back to the entries after it — `<` becomes `&#60;`, whose `#` the `#` rule then rewrites,
 * and the reader gets `&&#35;60;` where a `<` was meant.
 */
function esc(text: string): string {
  return text.replace(ESCAPABLE, (ch) => ENTITIES[ch] ?? ch);
}

/**
 * Neutralizes a block marker that a rendered line happens to START with.
 *
 * The characters escaped above are the ones that mean something anywhere; these mean
 * something only at the head of a line, so escaping them everywhere would put an entity in
 * the middle of every hyphenated word and every decimal number. A paragraph that opens with
 * one — "- 40 degrees", "1. first of all" — would otherwise be re-read as the list it
 * never was.
 */
function guardLineStarts(text: string): string {
  const entity = (ch: string): string => `&#${ch.codePointAt(0)};`;
  return text
    .split("\n")
    .map((line) =>
      line
        .replace(/^(\s*)([-+=])/, (_m, lead: string, ch: string) => lead + entity(ch))
        .replace(/^(\s*\d+)([.)])/, (_m, lead: string, ch: string) => lead + entity(ch)),
    )
    .join("\n");
}

/** The fence that safely closes a code value containing backticks of its own. */
function fenceFor(value: string): string {
  let longest = 0;
  let run = 0;
  for (const ch of value) {
    run = ch === "`" ? run + 1 : 0;
    if (run > longest) longest = run;
  }
  return "`".repeat(Math.max(3, longest + 1));
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
      return `*${inline(node.children)}*`;
    case "delete":
      return `~~${inline(node.children)}~~`;
    case "inlineCode": {
      // A code span's contents are literal, so they are NOT entity-escaped; the fence grows
      // instead, and a value that starts or ends with a backtick needs the padding spaces
      // Markdown strips back off.
      const fence = "`".repeat(Math.max(1, fenceFor(node.value).length - 2));
      const pad = node.value.startsWith("`") || node.value.endsWith("`") ? " " : "";
      return `${fence}${pad}${node.value}${pad}${fence}`;
    }
    case "link": {
      const label = inline(node.children);
      return isSafeUrl(node.url) ? `[${label}](${href(node.url)})` : label;
    }
    case "image": {
      // The rich-text component documents no image syntax; the reply's own pictures travel
      // as real Feishu images instead (see reply-files.ts), so a remote one is a link.
      const alt = node.alt ?? "";
      const label = esc(alt !== "" ? alt : node.url);
      return isSafeUrl(node.url) ? `[${label}](${href(node.url)})` : label;
    }
    case "break":
      return "\n";
    case "html":
      // The model's own angle brackets, shown rather than forwarded: the component accepts a
      // handful of tags of its own, and none of them is anything a reply should be able to emit.
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

/** Inline content as unformatted text, for the inside of a fence where no markup applies. */
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

function tableRows(node: Table): string[] {
  return node.children.map(
    (row) => `| ${row.children.map((cell) => plainText(cell.children)).join(" | ")} |`,
  );
}

/** A table small enough for the component, as the Markdown table it is. */
function renderTable(node: Table): string {
  const [header, ...body] = node.children;
  if (header === undefined) return "";
  const width = header.children.length;
  const cells = (row: (typeof node.children)[number]): string =>
    `| ${Array.from({ length: width }, (_, i) => inline(row.children[i]?.children ?? [])).join(" | ")} |`;
  return [cells(header), `| ${Array.from({ length: width }, () => "---").join(" | ")} |`]
    .concat(body.map(cells))
    .join("\n");
}

function itemMarker(list: List, index: number): string {
  return list.ordered === true ? `${(list.start ?? 1) + index}. ` : "- ";
}

/** A GFM task item's box. The component has no checkbox, so the glyph is the checkbox. */
function itemCheckbox(item: ListItem): string {
  if (item.checked === true) return "☑ ";
  if (item.checked === false) return "☐ ";
  return "";
}

function renderList(list: List, indent: string, ctx: RenderContext): string {
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
          parts.push(renderList(child, indent + LIST_INDENT, ctx));
          continue;
        }
        const rendered = block(child, indent + LIST_INDENT, ctx);
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

/** Per-message render state: only the table budget, which is counted across the whole component. */
interface RenderContext {
  tables: number;
}

function block(
  node: BlockContent | DefinitionContent | RootContent,
  indent: string,
  ctx: RenderContext,
): string {
  switch (node.type) {
    case "paragraph":
      return guardLineStarts(inline(node.children));
    case "heading":
      // Six levels, exactly as Markdown writes them.
      return `${"#".repeat(Math.min(node.depth, 6))} ${inline(node.children)}`;
    case "code": {
      const fence = fenceFor(node.value);
      const lang = typeof node.lang === "string" ? node.lang : "";
      return `${fence}${lang}\n${node.value}\n${fence}`;
    }
    case "blockquote":
      return node.children
        .map((child) => block(child, indent, ctx))
        .filter((rendered) => rendered !== "")
        .join("\n\n")
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    case "list":
      return renderList(node, indent, ctx);
    case "table": {
      ctx.tables += 1;
      const dataRows = Math.max(node.children.length - 1, 0);
      if (dataRows > TABLE_MAX_ROWS || ctx.tables > TABLE_MAX_PER_MESSAGE) {
        // Over one of the component's limits, where a real table would drop rows silently.
        const rows = tableRows(node).join("\n");
        return `${fenceFor(rows)}\n${rows}\n${fenceFor(rows)}`;
      }
      return renderTable(node);
    }
    case "thematicBreak":
      return "---";
    case "html":
      return esc(node.value);
    case "footnoteDefinition":
      return `**${esc(`[^${node.identifier}]`)}** ${node.children.map((child) => block(child, indent, ctx)).join("\n\n")}`;
    case "definition":
      return "";
    default:
      return "";
  }
}

/** One relayed message as the rich-text component's `content`. */
export function feishuMarkdownOf(markdown: string): string {
  const root = parseMarkdown(markdown);
  const ctx: RenderContext = { tables: 0 };
  return root.children
    .map((node) => block(node, "", ctx))
    .filter((rendered) => rendered !== "")
    .join("\n\n")
    .trim();
}

/**
 * One relayed message as the card the IM API sends.
 *
 * A card body is capped at 30KB, which a message chunked under the channel-neutral 4000
 * characters cannot reach except through pathological escaping (every character an entity).
 * That case is not guarded here on purpose: Feishu answers an over-size card with a refusal,
 * and the connector's plain-text fallback already turns a refusal into a delivered message.
 */
export function feishuCardOf(markdown: string): FeishuCard {
  return {
    schema: "2.0",
    body: { elements: [{ tag: "markdown", content: feishuMarkdownOf(markdown) }] },
  };
}
