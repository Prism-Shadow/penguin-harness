import type { Element, ElementContent, Root, RootContent } from "hast";
import { toHtml } from "hast-util-to-html";
import { createHighlighter, type Highlighter } from "shiki";

export interface SymbolLinkResolver {
  resolveSymbol(word: string, isDecorator: boolean): string | null;
  resolveSlot(slotKey: string): string | null;
}

const IDENT_OR_QUOTED_RE = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|@[A-Za-z_]\w*|\b[A-Za-z_]\w*\b/g;

function linkifyText(text: string, resolver: SymbolLinkResolver): ElementContent[] {
  const out: ElementContent[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  IDENT_OR_QUOTED_RE.lastIndex = 0;
  while ((m = IDENT_OR_QUOTED_RE.exec(text)) !== null) {
    const tok = m[0];
    let href: string | null = null;
    if ((tok.startsWith('"') && tok.endsWith('"')) || (tok.startsWith("'") && tok.endsWith("'"))) {
      href = resolver.resolveSlot(tok.slice(1, -1));
    } else if (tok.startsWith("@")) {
      href = resolver.resolveSymbol(tok.slice(1), true);
    } else {
      href = resolver.resolveSymbol(tok, false);
    }
    if (!href) continue;
    if (m.index > last) out.push({ type: "text", value: text.slice(last, m.index) });
    out.push({
      type: "element",
      tagName: "a",
      properties: { className: ["code-link"], href },
      children: [{ type: "text", value: tok }],
    });
    last = m.index + tok.length;
  }
  if (last === 0) return [{ type: "text", value: text }];
  if (last < text.length) out.push({ type: "text", value: text.slice(last) });
  return out;
}

function walkLinkify(
  node: Root | RootContent,
  resolver: SymbolLinkResolver,
  inAnchor = false,
): void {
  if (node.type === "root") {
    for (const ch of node.children) walkLinkify(ch, resolver, false);
    return;
  }
  if (node.type !== "element") return;
  const nowInAnchor = inAnchor || node.tagName === "a";
  if (nowInAnchor) return;

  // Skip comment tokens (Shiki styles comments with muted color or italic; keep comments plain)
  const nextChildren: ElementContent[] = [];
  for (const ch of node.children) {
    if (ch.type === "text") {
      if (ch.value.trimStart().startsWith("//") || ch.value.trimStart().startsWith("/*")) {
        nextChildren.push(ch);
      } else {
        nextChildren.push(...linkifyText(ch.value, resolver));
      }
    } else {
      walkLinkify(ch, resolver, false);
      nextChildren.push(ch);
    }
  }
  node.children = nextChildren;
}

function normalizeLang(lang: string): "ts" | "json" | "bash" | "text" {
  const lower = lang.trim().toLowerCase();
  if (
    lower === "ts" ||
    lower === "tsx" ||
    lower === "typescript" ||
    lower === "js" ||
    lower === "javascript"
  ) {
    return "ts";
  }
  if (lower === "json" || lower === "jsonc") return "json";
  if (lower === "sh" || lower === "bash" || lower === "shell" || lower === "zsh") return "bash";
  return "text";
}

/**
 * Official Shiki-backed highlighter replacing hand-rolled regex syntax highlighting.
 * Caches highlighted HTML per (code, lang, contextKey) so 600+ pages build in ~1–2s.
 */
export class CodeHighlighter {
  private readonly cache = new Map<string, string>();

  private constructor(private readonly shiki: Highlighter) {}

  static async create(): Promise<CodeHighlighter> {
    const shiki = await createHighlighter({
      themes: ["github-light", "github-dark-default"],
      langs: ["ts", "json", "bash"],
    });
    return new CodeHighlighter(shiki);
  }

  dispose(): void {
    this.shiki.dispose();
  }

  highlightBlockHast(
    code: string,
    lang = "ts",
    resolver: SymbolLinkResolver | null = null,
  ): Element {
    const normLang = normalizeLang(lang);
    const hast = this.shiki.codeToHast(code, {
      lang: normLang,
      themes: { light: "github-light", dark: "github-dark-default" },
      defaultColor: false,
    });
    if (resolver) walkLinkify(hast, resolver);
    const pre = hast.children.find(
      (c): c is Element => c.type === "element" && c.tagName === "pre",
    );
    return (
      pre ?? {
        type: "element",
        tagName: "pre",
        properties: { className: ["shiki"] },
        children: [
          {
            type: "element",
            tagName: "code",
            properties: {},
            children: [{ type: "text", value: code }],
          },
        ],
      }
    );
  }

  highlightBlock(
    code: string,
    lang = "ts",
    resolver: SymbolLinkResolver | null = null,
    cacheKey = "",
  ): string {
    const normLang = normalizeLang(lang);
    const fullKey = `B|${normLang}|${cacheKey}|${code}`;
    const hit = this.cache.get(fullKey);
    if (hit !== undefined) return hit;

    const html = toHtml(this.highlightBlockHast(code, normLang, resolver));
    this.cache.set(fullKey, html);
    return html;
  }

  highlightInline(
    code: string,
    lang = "ts",
    resolver: SymbolLinkResolver | null = null,
    cacheKey = "",
  ): string {
    const normLang = normalizeLang(lang);
    const fullKey = `I|${normLang}|${cacheKey}|${code}`;
    const hit = this.cache.get(fullKey);
    if (hit !== undefined) return hit;

    const hast = this.shiki.codeToHast(code, {
      lang: normLang,
      themes: { light: "github-light", dark: "github-dark-default" },
      defaultColor: false,
      structure: "inline",
    });
    if (resolver) walkLinkify(hast, resolver);
    const html = toHtml(hast);
    this.cache.set(fullKey, html);
    return html;
  }
}

/** Strip self-referential Twoslash kernel links directly in HAST (zero regex HTML mutation). */
export function stripSelfLinksInHast(root: Root, currentSymbol: string | null): Root {
  const cloneAndRewrite = (node: Root | RootContent): Root | RootContent => {
    if (node.type === "root") {
      return {
        ...node,
        children: node.children.map((ch) => cloneAndRewrite(ch) as RootContent),
      };
    }
    if (node.type !== "element") return node;
    const isSelfLink =
      currentSymbol !== null &&
      node.tagName === "a" &&
      node.properties?.["data-k-sym"] === currentSymbol;
    const rewrittenChildren = node.children.map((c) => cloneAndRewrite(c) as ElementContent);
    if (isSelfLink) {
      if (rewrittenChildren.length === 1 && rewrittenChildren[0]) return rewrittenChildren[0];
      return { type: "element", tagName: "span", properties: {}, children: rewrittenChildren };
    }
    return { ...node, children: rewrittenChildren };
  };
  return cloneAndRewrite(root) as Root;
}

export function rewriteKernelRootInHast(root: Root, kernelRootHref: string): Root {
  const walk = (node: Root | RootContent): Root | RootContent => {
    if (node.type === "root") {
      return { ...node, children: node.children.map((c) => walk(c) as RootContent) };
    }
    if (node.type !== "element") return node;
    const props = { ...node.properties };
    if (typeof props.href === "string" && props.href.includes("__KERNEL_ROOT__")) {
      props.href = props.href.replaceAll("__KERNEL_ROOT__", kernelRootHref);
    }
    return {
      ...node,
      properties: props,
      children: node.children.map((c) => walk(c) as ElementContent),
    };
  };
  return walk(root) as Root;
}
