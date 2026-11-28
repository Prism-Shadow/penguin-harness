import { parse as parseJsDocComment } from "comment-parser";
import type { Element, ElementContent, Root, RootContent } from "hast";
import { toHtml } from "hast-util-to-html";
import { fromMarkdown } from "mdast-util-from-markdown";
import { toHast } from "mdast-util-to-hast";
import ts from "typescript";
import type { JsDocTagEntry, ParsedDoc } from "./types.js";

const JSDOC_SYM_SCHEME = "jsdocsym:";
const SAFE_URL_SCHEMES = new Set(["http:", "https:", "mailto:"]);

export const EMPTY_DOC: ParsedDoc = { markdown: "", summary: "", tags: [] };

export function slugOf(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function cleanTypeWs(src: string): string {
  return src
    .replace(/\s+/g, " ")
    .replace(/([<([]+)\s+/g, "$1")
    .replace(/\s+([>)\],;])/g, "$1")
    .trim();
}

export function groupBy<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
): { order: string[]; groups: Map<string, T[]> } {
  const order: string[] = [];
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const list = groups.get(key);
    if (list) {
      list.push(item);
    } else {
      order.push(key);
      groups.set(key, [item]);
    }
  }
  return { order, groups };
}

/* ---------- Official JSDoc Extraction via `comment-parser` ---------- */

function firstPlainSummary(markdown: string): string {
  if (!markdown.trim()) return "";
  const tree = fromMarkdown(markdown);
  const firstBlock = tree.children.find(
    (c) => c.type === "paragraph" || c.type === "list" || c.type === "blockquote",
  );
  if (!firstBlock) return "";
  const parts: string[] = [];
  const walk = (node: { type?: string; value?: string; children?: unknown[] }): void => {
    if (typeof node.value === "string") {
      parts.push(node.value);
    } else if (Array.isArray(node.children)) {
      for (const ch of node.children) {
        walk(ch as { type?: string; value?: string; children?: unknown[] });
      }
    }
  };
  walk(firstBlock as { type?: string; value?: string; children?: unknown[] });
  return parts
    .join("")
    .replace(
      /\{@link(?:code|plain)?\s+([^}\s|]+)(?:\s*\|?\s*([^}]*))?\}/g,
      (_, target: string, label?: string) => (label?.trim() || target).trim(),
    )
    .replace(/\s+/g, " ")
    .trim();
}

/** Parse a raw `/** ... *\/` JSDoc block using the official `comment-parser` library. */
export function parseRawJsDocComment(rawComment: string): ParsedDoc {
  const trimmed = rawComment.trim();
  if (!trimmed.startsWith("/**")) return EMPTY_DOC;

  // comment-parser v1.4 only recognizes backtick fences; normalize CommonMark tilde fences before parsing.
  const normalizedFences = trimmed.replace(/^([ \t]*\*?[ \t]*)~{3,}/gm, "$1```");
  const blocks = parseJsDocComment(normalizedFences, { spacing: "preserve" });
  const block = blocks[0];
  if (!block) return EMPTY_DOC;

  const markdown = block.description.trim();
  const tags: JsDocTagEntry[] = block.tags.map((spec) => {
    const isNamedTag =
      spec.tag === "param" ||
      spec.tag === "arg" ||
      spec.tag === "argument" ||
      spec.tag === "template" ||
      spec.tag === "prop" ||
      spec.tag === "property";
    if (isNamedTag) {
      return {
        tag: spec.tag,
        name: spec.name || undefined,
        markdown: spec.description.replace(/^-\s*/, "").trim(),
      };
    }
    const combined = [spec.name, spec.description].filter(Boolean).join(" ").trim();
    return { tag: spec.tag, markdown: combined };
  });

  return { markdown, summary: firstPlainSummary(markdown), tags };
}

export function extractJsDoc(node: ts.Node, sf: ts.SourceFile): ParsedDoc {
  const ranges = ts.getLeadingCommentRanges(sf.text, node.pos);
  if (!ranges) return EMPTY_DOC;
  for (let i = ranges.length - 1; i >= 0; i--) {
    const range = ranges[i];
    if (!range) continue;
    const txt = sf.text.slice(range.pos, range.end);
    if (txt.startsWith("/**")) return parseRawJsDocComment(txt);
  }
  return EMPTY_DOC;
}

export function extractFileTopJsDoc(sf: ts.SourceFile): ParsedDoc {
  const ranges = ts.getLeadingCommentRanges(sf.text, 0);
  const first = ranges?.[0];
  if (!first) return EMPTY_DOC;
  const txt = sf.text.slice(first.pos, first.end);
  return txt.startsWith("/**") ? parseRawJsDocComment(txt) : EMPTY_DOC;
}

/* ---------- Official CommonMark (mdast → hast → html) Pipeline with URL Sanitization ---------- */

export interface MarkdownRenderOptions {
  resolveSymbolHref?: (symbol: string, preferKernelHint: boolean) => string | null;
  renderCodeBlock?: (code: string, lang: string) => Element;
  linkClass?: string;
  inlineOnly?: boolean;
}

function isSafeUrl(rawUrl: string): boolean {
  let cleaned = "";
  for (const ch of rawUrl) {
    if (ch.charCodeAt(0) > 0x20) cleaned += ch;
  }
  if (!cleaned) return false;
  if (
    cleaned.startsWith("#") ||
    cleaned.startsWith("/") ||
    cleaned.startsWith("./") ||
    cleaned.startsWith("../")
  ) {
    return !cleaned.startsWith("//");
  }
  const colonIdx = cleaned.indexOf(":");
  const slashIdx = cleaned.search(/[/?#]/);
  if (colonIdx === -1 || (slashIdx !== -1 && colonIdx > slashIdx)) {
    return true; // Scheme-less relative path
  }
  const scheme = cleaned.slice(0, colonIdx + 1).toLowerCase();
  return SAFE_URL_SCHEMES.has(scheme);
}

function textContent(node: RootContent): string {
  if (node.type === "text") return node.value;
  if (node.type === "element") return node.children.map(textContent).join("");
  return "";
}

const INLINE_LINK_RE = /\{@link(code|plain)?\s+([^}\s|]+)(?:\s*\|?\s*([^}]*))?\}/g;

/** Expand `{@link Target | label}` inline tags only inside HAST prose text nodes (never inside `<code>` or `<pre>`). */
function expandJsDocLinksInText(
  text: string,
  opts: MarkdownRenderOptions,
  inAnchor: boolean,
): ElementContent[] {
  if (!text.includes("{@link")) return [{ type: "text", value: text }];
  const out: ElementContent[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  INLINE_LINK_RE.lastIndex = 0;
  while ((m = INLINE_LINK_RE.exec(text)) !== null) {
    if (m.index > last) out.push({ type: "text", value: text.slice(last, m.index) });
    const variant = m[1] ?? "";
    const rawTarget = m[2] ?? "";
    const label = (m[3]?.trim() || rawTarget).trim();
    const cleanSym = rawTarget.replace(/^@/, "").replace(/\(\)$/, "");
    const resolved =
      !inAnchor && opts.resolveSymbolHref
        ? opts.resolveSymbolHref(cleanSym, rawTarget.startsWith("@"))
        : null;
    const innerNode: ElementContent =
      variant === "plain"
        ? { type: "text", value: label }
        : {
            type: "element",
            tagName: "code",
            properties: {},
            children: [{ type: "text", value: label }],
          };

    if (resolved && isSafeUrl(resolved)) {
      out.push({
        type: "element",
        tagName: "a",
        properties: {
          ...(opts.linkClass ? { class: opts.linkClass } : {}),
          href: resolved,
        },
        children: [innerNode],
      });
    } else {
      out.push(innerNode);
    }
    last = INLINE_LINK_RE.lastIndex;
  }
  if (last === 0) return [{ type: "text", value: text }];
  if (last < text.length) out.push({ type: "text", value: text.slice(last) });
  return out;
}

function transformHastNode(
  node: Root | RootContent,
  opts: MarkdownRenderOptions,
  inAnchor = false,
): Root | RootContent {
  if (node.type === "root") {
    return {
      ...node,
      children: node.children.map((ch) => transformHastNode(ch, opts, false) as RootContent),
    };
  }
  if (node.type !== "element") return node;

  // Fenced / indented code blocks: <pre><code class="language-ts">...</code></pre>
  if (node.tagName === "pre" && opts.renderCodeBlock) {
    const codeChild = node.children.find(
      (c): c is Element => c.type === "element" && c.tagName === "code",
    );
    if (codeChild) {
      const cls = codeChild.properties?.className;
      const langClass = Array.isArray(cls)
        ? cls.find((x): x is string => typeof x === "string" && x.startsWith("language-"))
        : undefined;
      const lang = langClass ? langClass.slice("language-".length) : "ts";
      const code = textContent(codeChild).replace(/\n$/, "");
      return opts.renderCodeBlock(code, lang);
    }
  }

  // Sanitize <img> src URL scheme
  if (node.tagName === "img") {
    const src = typeof node.properties?.src === "string" ? node.properties.src : "";
    if (!isSafeUrl(src)) {
      const alt = typeof node.properties?.alt === "string" ? node.properties.alt : "";
      return { type: "text", value: alt };
    }
    return node;
  }

  // Sanitize <a> href URL scheme (blocks javascript:, data:, vbscript:, etc.) and resolve jsdocsym:
  if (node.tagName === "a") {
    const href = typeof node.properties?.href === "string" ? node.properties.href : "";
    const children = transformChildren(node.children, opts, true);
    if (href.startsWith(JSDOC_SYM_SCHEME)) {
      let rawTarget = "";
      try {
        rawTarget = decodeURIComponent(href.slice(JSDOC_SYM_SCHEME.length));
      } catch {
        return unwrapChildren(children);
      }
      const cleanSym = rawTarget.replace(/^@/, "").replace(/\(\)$/, "");
      const resolved = opts.resolveSymbolHref?.(cleanSym, rawTarget.startsWith("@")) ?? null;
      if (resolved && !inAnchor && isSafeUrl(resolved)) {
        return {
          type: "element",
          tagName: "a",
          properties: {
            ...(opts.linkClass ? { class: opts.linkClass } : {}),
            href: resolved,
          },
          children,
        };
      }
      return unwrapChildren(children);
    }
    if (!isSafeUrl(href)) {
      return unwrapChildren(children);
    }
    return {
      ...node,
      properties: { ...node.properties, href },
      children,
    };
  }

  // Auto-link simple identifier `code` spans when not already inside an anchor (never expand {@link} inside <code>)
  if (node.tagName === "code") {
    if (!inAnchor && opts.resolveSymbolHref) {
      const raw = textContent(node).trim();
      if (/^@?[A-Za-z_]\w*(\(\))?$/.test(raw)) {
        const cleanSym = raw.replace(/^@/, "").replace(/\(\)$/, "");
        const href = opts.resolveSymbolHref(cleanSym, raw.startsWith("@"));
        if (href && isSafeUrl(href)) {
          return {
            type: "element",
            tagName: "a",
            properties: {
              ...(opts.linkClass ? { class: opts.linkClass } : {}),
              href,
            },
            children: [node],
          };
        }
      }
    }
    return node;
  }

  const props =
    node.tagName === "ul" ? { ...node.properties, className: ["docs-doc-list"] } : node.properties;

  return {
    ...node,
    properties: props,
    children: transformChildren(node.children, opts, inAnchor),
  };
}

function unwrapChildren(children: ElementContent[]): ElementContent {
  if (children.length === 1 && children[0]) return children[0];
  return { type: "element", tagName: "span", properties: {}, children };
}

function transformChildren(
  children: readonly ElementContent[],
  opts: MarkdownRenderOptions,
  inAnchor: boolean,
): ElementContent[] {
  const out: ElementContent[] = [];
  for (const ch of children) {
    if (ch.type === "text") {
      out.push(...expandJsDocLinksInText(ch.value, opts, inAnchor));
    } else {
      out.push(transformHastNode(ch, opts, inAnchor) as ElementContent);
    }
  }
  return out;
}

export function markdownToHast(markdown: string, opts: MarkdownRenderOptions = {}): Root {
  const mdast = fromMarkdown(markdown);
  const rawHast = toHast(mdast, { allowDangerousHtml: false }) as Root;
  return transformHastNode(rawHast, opts) as Root;
}

export function renderMarkdownHtml(markdown: string, opts: MarkdownRenderOptions = {}): string {
  if (!markdown.trim()) return "";
  const hast = markdownToHast(markdown, opts);
  if (
    opts.inlineOnly &&
    hast.children.length === 1 &&
    hast.children[0]?.type === "element" &&
    hast.children[0].tagName === "p"
  ) {
    return toHtml({ type: "root", children: hast.children[0].children });
  }
  return toHtml(hast);
}
