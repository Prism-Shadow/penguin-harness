/**
 * Renders a parsed Markdown reply into Telegram's HTML parse mode.
 *
 * HTML rather than MarkdownV2, which the Bot API also offers. Two reasons, and both are
 * about what happens when the model writes something unexpected. MarkdownV2 reserves
 * eighteen characters that must be backslash-escaped ANYWHERE they appear, including inside
 * what looks like an entity, so one missed character turns the whole message into a 400;
 * HTML reserves three (`&`, `<`, `>`). And an unsupported construct in HTML degrades — an
 * unknown tag is refused, but text that merely looks like markup is text — where in
 * MarkdownV2 a stray `[` derails the parse of everything after it.
 *
 * ## What Telegram can and cannot show
 *
 * The tag set is small and CLOSED (https://core.telegram.org/bots/api#html-style): `b i u s
 * tg-spoiler a code pre blockquote`, plus the aliases and the two custom tags this does not
 * use. "Only the tags mentioned above are currently supported" — anything else is a 400,
 * not a fallback. So three constructs the model writes constantly have no tag at all and
 * need a deliberate answer:
 *
 * - **Headings** become a bold line. Telegram has no heading of any level, and depth is not
 *   recoverable from a chat bubble anyway — `<b>` is what a reader reads as "this names the
 *   section".
 * - **Lists** become their marker as literal text: `• ` for a bullet, `1. ` for a number,
 *   two spaces of indent per nesting level. The marker has to be in the text because
 *   Telegram will not draw one.
 * - **Tables** become a `<pre>` block of their own rows. A chat has no table, and pipe-
 *   separated rows in a proportional font do not line up — inside `<pre>` they do, which is
 *   the whole of what a table was for.
 *
 * ## Escaping
 *
 * Every literal `&`, `<` and `>` the model wrote is entity-escaped, `&` first so the
 * escapes cannot escape each other. That is what makes `5 < 6` arrive as `5 < 6` rather
 * than as a 400, and what keeps a `<script>` in a code block a `<script>` in a code block:
 * the bytes reach `<pre>` as `&lt;script&gt;` and Telegram renders them as text. A raw HTML
 * node in the model's own Markdown gets exactly the same treatment — it is text the model
 * typed, never markup this server passes through, since passing it through is how a closed
 * tag set becomes a 400 for the whole message.
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

/** Telegram's own rule: "All <, > and & symbols that are not a part of a tag … must be replaced". */
function esc(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** The same, plus the quote that would otherwise close an attribute. `&quot;` is one of the four named entities Telegram accepts. */
function escAttr(text: string): string {
  return esc(text).replaceAll('"', "&quot;");
}

/**
 * The `language-…` class on a `<pre><code>`. Restricted to what a language tag can be
 * because the value comes from the model: a fence's info string is free text, and it is
 * being written into an attribute.
 */
function languageClass(lang: string | null | undefined): string {
  if (typeof lang !== "string" || !/^[A-Za-z0-9+#._-]{1,20}$/.test(lang)) return "";
  return ` class="language-${lang}"`;
}

/** The horizontal rule, as text. Telegram has no `<hr>`; three em dashes read as one. */
const RULE = "———";

function inline(nodes: readonly PhrasingContent[]): string {
  return nodes.map(phrasing).join("");
}

function phrasing(node: PhrasingContent): string {
  switch (node.type) {
    case "text":
      return esc(node.value);
    case "strong":
      return `<b>${inline(node.children)}</b>`;
    case "emphasis":
      return `<i>${inline(node.children)}</i>`;
    case "delete":
      return `<s>${inline(node.children)}</s>`;
    case "inlineCode":
      // No language on a standalone `code` tag — the Bot API says so explicitly, and the
      // attribute would be refused rather than ignored.
      return `<code>${esc(node.value)}</code>`;
    case "link": {
      const label = inline(node.children);
      // An unrenderable scheme keeps its label and loses only its clickability: the reader
      // still sees everything the model wrote.
      return isSafeUrl(node.url) ? `<a href="${escAttr(node.url)}">${label}</a>` : label;
    }
    case "image": {
      // Telegram cannot place an image inside a text message, and the reply's OWN pictures
      // arrive separately (see reply-files.ts). A remote one is therefore a link, labelled
      // with its alt text where the model wrote one.
      const alt = node.alt ?? "";
      const label = esc(alt !== "" ? alt : node.url);
      return isSafeUrl(node.url) ? `<a href="${escAttr(node.url)}">${label}</a>` : label;
    }
    case "break":
      return "\n";
    case "html":
      // Text the model typed, not markup to forward — see the module doc.
      return esc(node.value);
    case "footnoteReference":
      return esc(`[^${node.identifier}]`);
    case "linkReference":
    case "imageReference":
      // A reference whose definition sits elsewhere in the reply, or nowhere. Its label is
      // the part the reader was meant to read.
      return "children" in node ? inline(node.children) : esc(node.label ?? node.identifier);
    default:
      return "";
  }
}

/** One line of a table, as its cells were written. */
function tableRows(node: Table): string[] {
  return node.children.map((row) => {
    const cells = row.children.map((cell) => plainText(cell.children));
    return `| ${cells.join(" | ")} |`;
  });
}

/**
 * Inline content flattened to unformatted text, for the places a tag cannot go: inside
 * `<pre>`, where Telegram permits no nested formatting at all.
 */
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

/** The bullet or number that opens a list item, plus the indent of its nesting level. */
function itemMarker(list: List, index: number): string {
  if (list.ordered !== true) return "• ";
  return `${(list.start ?? 1) + index}. `;
}

/** A GFM task item's box, drawn since Telegram has no checkbox of its own. */
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
        // The item's first paragraph shares the marker's line; everything after it is a
        // block of its own, indented under the marker.
        if (j === 0 && child.type === "paragraph") {
          parts.push(head + inline(child.children));
          continue;
        }
        if (child.type === "list") {
          parts.push(renderList(child, `${indent}  `));
          continue;
        }
        const rendered = block(child, `${indent}  `);
        parts.push(rendered === "" ? "" : `${indent}  ${rendered}`);
      }
      return parts.filter((part) => part !== "").join("\n");
    })
    .filter((line) => line !== "")
    .join("\n");
}

function block(node: BlockContent | DefinitionContent | RootContent, indent: string): string {
  switch (node.type) {
    case "paragraph":
      return inline(node.children);
    case "heading":
      // No heading tag exists; a bold line is what a chat reads as one.
      return `<b>${inline(node.children)}</b>`;
    case "code": {
      // The two forms the Bot API documents and no third: a bare `pre` with no language, and
      // a `pre` wrapping a `code` that carries one. The nested pair exists only to name the
      // language ("Use nested pre and code tags, to define programming language").
      const cls = languageClass(node.lang);
      const body = esc(node.value);
      return cls === "" ? `<pre>${body}</pre>` : `<pre><code${cls}>${body}</code></pre>`;
    }
    case "blockquote":
      // Telegram's blockquote does not nest: a quote inside a quote renders its contents
      // once, at the outer level, rather than risking a refused tag pair.
      return `<blockquote>${node.children.map((child) => (child.type === "blockquote" ? child.children.map((inner) => block(inner, indent)).join("\n\n") : block(child, indent))).join("\n\n")}</blockquote>`;
    case "list":
      return renderList(node, indent);
    case "table":
      // A monospaced block is the only place pipe-separated rows line up.
      return `<pre>${esc(tableRows(node).join("\n"))}</pre>`;
    case "thematicBreak":
      return RULE;
    case "html":
      return esc(node.value);
    case "footnoteDefinition":
      return `<b>${esc(`[^${node.identifier}]`)}</b> ${node.children.map((child) => block(child, indent)).join("\n\n")}`;
    case "definition":
      // A link definition is invisible in the source and stays invisible here.
      return "";
    default:
      return "";
  }
}

/**
 * One relayed message as Telegram HTML.
 *
 * The result is what `sendMessage` carries under `parse_mode: "HTML"`. It can still be
 * refused — a construct combination Telegram dislikes answers 400 `can't parse entities` —
 * which is why the connector sends the plain text behind it rather than trusting this
 * (see telegram-connector's sendFormatted). A reply is never worth a formatting bug.
 */
export function telegramHtmlOf(markdown: string): string {
  const root = parseMarkdown(markdown);
  return root.children
    .map((node) => block(node, ""))
    .filter((rendered) => rendered !== "")
    .join("\n\n")
    .trim();
}
