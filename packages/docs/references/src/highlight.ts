import type { Element, ElementContent, Root, RootContent } from "hast";
import { toHtml } from "hast-util-to-html";
import {
  bundledLanguagesInfo,
  createHighlighter,
  type BundledLanguage,
  type DecorationItem,
  type Highlighter,
} from "shiki";
import ts from "typescript";
import { visit } from "unist-util-visit";
import { REGEX_PRECEDING_TOKENS } from "./jsdoc.js";

export interface SymbolLinkResolver {
  resolveSymbol(word: string, isDecorator: boolean): string | null;
  resolveSlot(slotKey: string): string | null;
}

const PRELOADED_LANGS: BundledLanguage[] = [
  "ts",
  "tsx",
  "json",
  "bash",
  "html",
  "css",
  "yaml",
  "markdown",
];
const LANG_ALIAS_MAP = new Map<string, BundledLanguage>();
for (const info of bundledLanguagesInfo) {
  LANG_ALIAS_MAP.set(info.id.toLowerCase(), info.id as BundledLanguage);
  for (const alias of info.aliases ?? []) {
    LANG_ALIAS_MAP.set(alias.toLowerCase(), info.id as BundledLanguage);
  }
}

const TS_LIKE_LANGS = new Set(["typescript", "tsx", "javascript", "jsx", "ts", "js"]);

/**
 * Collect exact non-overlapping Shiki decoration spans using TypeScript's real parser (`ts.createSourceFile`).
 * - Comments, regex literals (`/Widget/`), and JSX text (`<div>Widget</div>`) are never AST `Identifier` nodes.
 * - Handles full statements, TSX/JSX, bare type expressions (`type __T = ...`), and bare class/interface members.
 * - String literals use `node.text` (decoding `\u002e` escapes).
 * - Decorators (`@Module`) resolve their span from the `Decorator` node's `@` start to the identifier end.
 */
function parseForDecorations(
  code: string,
  scriptKind: ts.ScriptKind,
): { sf: ts.SourceFile; offset: number; minPos: number; maxPos: number } | null {
  const candidates: Array<{ src: string; offset: number }> = [
    { src: code, offset: 0 },
    ...(scriptKind === ts.ScriptKind.TS
      ? [
          { src: `type __T = ${code};`, offset: 11 },
          { src: `interface __I { ${code} }`, offset: 16 },
        ]
      : []),
  ];
  for (const cand of candidates) {
    const sf = ts.createSourceFile("__hl.ts", cand.src, ts.ScriptTarget.Latest, true, scriptKind);
    const diags = (sf as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] })
      .parseDiagnostics;
    if ((diags?.length ?? 0) === 0) {
      return { sf, offset: cand.offset, minPos: cand.offset, maxPos: cand.offset + code.length };
    }
  }
  return null;
}

function collectTsLinkDecorations(
  code: string,
  resolver: SymbolLinkResolver,
  isJsx: boolean,
): DecorationItem[] {
  const scriptKind = isJsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const parsed = parseForDecorations(code, scriptKind);
  const decorations: DecorationItem[] = [];

  if (parsed) {
    const { sf, offset, minPos, maxPos } = parsed;
    const visitAst = (node: ts.Node): void => {
      if (ts.isDecorator(node)) {
        const expr = ts.isCallExpression(node.expression)
          ? node.expression.expression
          : node.expression;
        if (ts.isIdentifier(expr)) {
          const start = node.getStart(sf) - offset;
          const end = expr.getEnd() - offset;
          if (start >= 0 && end <= code.length) {
            const href = resolver.resolveSymbol(expr.text, true);
            if (href) {
              decorations.push({
                start,
                end,
                tagName: "a",
                properties: { class: "code-link", href },
              });
            }
          }
          // Visit decorator arguments (if any), skipping the already-handled callee identifier
          if (ts.isCallExpression(node.expression)) {
            for (const ta of node.expression.typeArguments ?? []) visitAst(ta);
            for (const arg of node.expression.arguments) visitAst(arg);
          }
          return;
        }
      }

      if (ts.isIdentifier(node)) {
        const rawStart = node.getStart(sf);
        const rawEnd = node.getEnd();
        if (rawStart >= minPos && rawEnd <= maxPos) {
          const href = resolver.resolveSymbol(node.text, false);
          if (href) {
            decorations.push({
              start: rawStart - offset,
              end: rawEnd - offset,
              tagName: "a",
              properties: { class: "code-link", href },
            });
          }
        }
        return;
      }

      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        const rawStart = node.getStart(sf);
        const rawEnd = node.getEnd();
        if (rawStart >= minPos && rawEnd <= maxPos) {
          const href = resolver.resolveSlot(node.text);
          if (href) {
            decorations.push({
              start: rawStart - offset,
              end: rawEnd - offset,
              tagName: "a",
              properties: { class: "code-link", href },
            });
          }
        }
        return;
      }

      ts.forEachChild(node, visitAst);
    };
    visitAst(sf);
    decorations.sort((a, b) => Number(a.start) - Number(b.start));
    return decorations;
  }

  // Fallback for incomplete/syntactically partial snippets (never called on valid TS/TSX/types/members)
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    isJsx ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard,
    code,
  );
  const templateBraceDepths: number[] = [];
  let pendingAtStart: number | null = null;
  let prevNonTriviaKind: ts.SyntaxKind | null = null;

  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
    if (kind === ts.SyntaxKind.TemplateHead) {
      templateBraceDepths.push(0);
      pendingAtStart = null;
      prevNonTriviaKind = kind;
      continue;
    }
    if (kind === ts.SyntaxKind.OpenBraceToken && templateBraceDepths.length > 0) {
      templateBraceDepths[templateBraceDepths.length - 1] =
        (templateBraceDepths[templateBraceDepths.length - 1] ?? 0) + 1;
      pendingAtStart = null;
      prevNonTriviaKind = kind;
      continue;
    }
    if (kind === ts.SyntaxKind.CloseBraceToken && templateBraceDepths.length > 0) {
      const top = templateBraceDepths[templateBraceDepths.length - 1] ?? 0;
      if (top === 0) {
        const resumed = scanner.reScanTemplateToken(false);
        if (resumed === ts.SyntaxKind.TemplateTail) templateBraceDepths.pop();
        pendingAtStart = null;
        prevNonTriviaKind = resumed;
        continue;
      }
      templateBraceDepths[templateBraceDepths.length - 1] = top - 1;
      pendingAtStart = null;
      prevNonTriviaKind = kind;
      continue;
    }
    if (
      kind === ts.SyntaxKind.WhitespaceTrivia ||
      kind === ts.SyntaxKind.NewLineTrivia ||
      kind === ts.SyntaxKind.SingleLineCommentTrivia ||
      kind === ts.SyntaxKind.MultiLineCommentTrivia
    ) {
      continue;
    }
    if (
      (kind === ts.SyntaxKind.SlashToken || kind === ts.SyntaxKind.SlashEqualsToken) &&
      (prevNonTriviaKind === null || REGEX_PRECEDING_TOKENS.has(prevNonTriviaKind))
    ) {
      kind = scanner.reScanSlashToken();
      pendingAtStart = null;
      prevNonTriviaKind = kind;
      continue;
    }

    const start = scanner.getTokenStart();
    const end = scanner.getTokenEnd();

    if (kind === ts.SyntaxKind.AtToken) {
      pendingAtStart = start;
      prevNonTriviaKind = kind;
      continue;
    }

    if (kind === ts.SyntaxKind.Identifier) {
      const word = scanner.getTokenValue();
      const isDecorator = pendingAtStart !== null;
      const spanStart = pendingAtStart ?? start;
      pendingAtStart = null;
      prevNonTriviaKind = kind;
      const href = resolver.resolveSymbol(word, isDecorator);
      if (href) {
        decorations.push({
          start: spanStart,
          end,
          tagName: "a",
          properties: { class: "code-link", href },
        });
      }
      continue;
    }

    pendingAtStart = null;
    prevNonTriviaKind = kind;

    if (
      kind === ts.SyntaxKind.StringLiteral ||
      kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral
    ) {
      const decoded = scanner.getTokenValue();
      const href = resolver.resolveSlot(decoded);
      if (href) {
        decorations.push({
          start,
          end,
          tagName: "a",
          properties: { class: "code-link", href },
        });
      }
    }
  }

  return decorations;
}

/** Collect slot link decorations for JSON using TypeScript's real JSON scanner (decoded string literals only). */
function collectJsonLinkDecorations(code: string, resolver: SymbolLinkResolver): DecorationItem[] {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    code,
  );
  const decorations: DecorationItem[] = [];

  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
    if (kind === ts.SyntaxKind.StringLiteral) {
      const decoded = scanner.getTokenValue();
      const href = resolver.resolveSlot(decoded);
      if (href) {
        decorations.push({
          start: scanner.getTokenStart(),
          end: scanner.getTokenEnd(),
          tagName: "a",
          properties: { class: "code-link", href },
        });
      }
    }
  }
  return decorations;
}

/**
 * Official Shiki-backed highlighter with AST/scanner-driven Shiki `decorations`
 * (zero regex re-lexing and zero string-based comment guessing).
 */
export class CodeHighlighter {
  private readonly cache = new Map<string, string>();
  private readonly loadedLangs: Set<string>;

  private constructor(private readonly shiki: Highlighter) {
    this.loadedLangs = new Set(shiki.getLoadedLanguages().map((l) => l.toLowerCase()));
  }

  static async create(): Promise<CodeHighlighter> {
    const shiki = await createHighlighter({
      themes: ["github-light", "github-dark-default"],
      langs: PRELOADED_LANGS,
    });
    return new CodeHighlighter(shiki);
  }

  dispose(): void {
    this.shiki.dispose();
  }

  private resolveLang(lang: string): BundledLanguage | "text" {
    const key = lang.trim().toLowerCase();
    if (!key || key === "text" || key === "txt" || key === "plaintext") return "text";
    const bundled = LANG_ALIAS_MAP.get(key);
    if (!bundled) return "text";
    return this.loadedLangs.has(bundled) ? bundled : "text";
  }

  private decorationsFor(
    code: string,
    lang: BundledLanguage | "text",
    resolver: SymbolLinkResolver | null,
  ): DecorationItem[] {
    if (!resolver) return [];
    if (TS_LIKE_LANGS.has(lang)) {
      return collectTsLinkDecorations(code, resolver, lang === "tsx" || lang === "jsx");
    }
    if (lang === "json" || lang === "jsonc") return collectJsonLinkDecorations(code, resolver);
    return [];
  }

  highlightBlockHast(
    code: string,
    lang = "ts",
    resolver: SymbolLinkResolver | null = null,
  ): Element {
    const normLang = this.resolveLang(lang);
    const decorations = this.decorationsFor(code, normLang, resolver);
    const hast = this.shiki.codeToHast(code, {
      lang: normLang,
      themes: { light: "github-light", dark: "github-dark-default" },
      defaultColor: false,
      ...(decorations.length > 0 ? { decorations } : {}),
    });
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
    const normLang = this.resolveLang(lang);
    const fullKey = JSON.stringify(["B", normLang, cacheKey, code]);
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
    const normLang = this.resolveLang(lang);
    const fullKey = JSON.stringify(["I", normLang, cacheKey, code]);
    const hit = this.cache.get(fullKey);
    if (hit !== undefined) return hit;

    const decorations = this.decorationsFor(code, normLang, resolver);
    const hast = this.shiki.codeToHast(code, {
      lang: normLang,
      themes: { light: "github-light", dark: "github-dark-default" },
      defaultColor: false,
      structure: "inline",
      ...(decorations.length > 0 ? { decorations } : {}),
    });
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

/**
 * Resolve structured internal kernel link markers (`data-k-href`) using `unist-util-visit`
 * instead of string-replacing sentinel substrings across arbitrary URLs or HTML.
 */
export function rewriteKernelRootInHast(root: Root, kernelRootHref: string): Root {
  const cloned = structuredClone(root);
  visit(cloned, "element", (el) => {
    if (el.tagName !== "a" || !el.properties) return;
    const relTarget = el.properties["data-k-href"];
    if (typeof relTarget === "string") {
      el.properties.href = `${kernelRootHref}${relTarget}`;
      delete el.properties["data-k-href"];
    }
  });
  return cloned;
}
