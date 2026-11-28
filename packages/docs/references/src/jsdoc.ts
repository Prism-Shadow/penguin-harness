import { parse as parseJsDocComment } from "comment-parser";
import type { Element, ElementContent, Root, RootContent } from "hast";
import { toHtml } from "hast-util-to-html";
import { fromMarkdown } from "mdast-util-from-markdown";
import { toHast } from "mdast-util-to-hast";
import { toString as mdastToString } from "mdast-util-to-string";
import ts from "typescript";
import { visit } from "unist-util-visit";
import type { JsDocTagEntry, ParsedDoc } from "./types.js";

const PAGE_ORIGIN = "https://penguin-refs.invalid";
const PAGE_BASE = `${PAGE_ORIGIN}/a/b/c/`;
const SAFE_URL_SCHEMES = new Set(["http:", "https:", "mailto:"]);
const NAMED_JSDOC_TAGS = new Set([
  "param",
  "arg",
  "argument",
  "template",
  "prop",
  "property",
  "docTarget",
]);
const FENCED_AT_SENTINEL = "\uE000@";
const DISABLE_FENCE_SENTINEL = "\uE001__NO_FENCE__";
const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export const EMPTY_DOC: ParsedDoc = { markdown: "", summary: "", tags: [] };

/**
 * Validate a URL strictly using the standard WHATWG `new URL()` parser.
 * - Absolute URLs must use an allowlisted scheme (`http:`, `https:`, `mailto:`).
 * - Relative references (including empty `""`, `#anchor`, `../foo/`) must stay on the sentinel origin,
 *   which rejects protocol-relative `//host`, `/\host`, and `\\host` authority overrides identically to browsers.
 */
export function isSafeUrl(rawUrl: string): boolean {
  try {
    const abs = new URL(rawUrl);
    return SAFE_URL_SCHEMES.has(abs.protocol);
  } catch {
    try {
      const rel = new URL(rawUrl, PAGE_BASE);
      return SAFE_URL_SCHEMES.has(rel.protocol) && rel.origin === PAGE_ORIGIN;
    } catch {
      return false;
    }
  }
}

export function slugOf(name: string): string {
  const ascii = name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (ascii) return ascii;
  const codePoints = Array.from(name, (ch) => (ch.codePointAt(0) ?? 0).toString(16));
  return codePoints.length > 0 ? `u-${codePoints.join("-")}` : "item";
}

export function createAnchorAllocator(): (rawName: string) => string {
  const used = new Set<string>();
  return (rawName: string): string => {
    const base = slugOf(rawName || "member");
    let candidate = base;
    let suffix = 2;
    while (used.has(candidate)) {
      candidate = `${base}-${suffix++}`;
    }
    used.add(candidate);
    return candidate;
  };
}

export function truncateGraphemes(text: string, max: number, ellipsis = "…"): string {
  const graphemes = Array.from(GRAPHEME_SEGMENTER.segment(text), (s) => s.segment);
  return graphemes.length > max ? `${graphemes.slice(0, max).join("")}${ellipsis}` : text;
}

export const REGEX_PRECEDING_TOKENS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.OpenParenToken,
  ts.SyntaxKind.OpenBracketToken,
  ts.SyntaxKind.OpenBraceToken,
  ts.SyntaxKind.CommaToken,
  ts.SyntaxKind.SemicolonToken,
  ts.SyntaxKind.ColonToken,
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken,
  ts.SyntaxKind.PercentEqualsToken,
  ts.SyntaxKind.PlusToken,
  ts.SyntaxKind.MinusToken,
  ts.SyntaxKind.AsteriskToken,
  ts.SyntaxKind.PercentToken,
  ts.SyntaxKind.CaretToken,
  ts.SyntaxKind.TildeToken,
  ts.SyntaxKind.LessThanToken,
  ts.SyntaxKind.GreaterThanToken,
  ts.SyntaxKind.LessThanEqualsToken,
  ts.SyntaxKind.GreaterThanEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.ExclamationToken,
  ts.SyntaxKind.QuestionToken,
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.BarToken,
  ts.SyntaxKind.AmpersandToken,
  ts.SyntaxKind.EqualsGreaterThanToken,
  ts.SyntaxKind.ReturnKeyword,
  ts.SyntaxKind.CaseKeyword,
  ts.SyntaxKind.ThrowKeyword,
  ts.SyntaxKind.TypeOfKeyword,
  ts.SyntaxKind.VoidKeyword,
  ts.SyntaxKind.DeleteKeyword,
  ts.SyntaxKind.NewKeyword,
  ts.SyntaxKind.YieldKeyword,
  ts.SyntaxKind.AwaitKeyword,
  ts.SyntaxKind.InKeyword,
  ts.SyntaxKind.OfKeyword,
  ts.SyntaxKind.InstanceOfKeyword,
  ts.SyntaxKind.ElseKeyword,
  ts.SyntaxKind.DoKeyword,
]);

/**
 * Token-aware TypeScript whitespace compactor backed by `ts.createScanner`.
 * Collapses whitespace/newline trivia only; string literals, template literals, and regexes are preserved verbatim.
 */
export function cleanTypeWs(src: string): string {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, src);
  const out: string[] = [];
  const templateBraceDepths: number[] = [];
  let prevKind: ts.SyntaxKind | null = null;
  let sawWs = false;
  let angleDepth = 0;

  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
    if (kind === ts.SyntaxKind.CloseBraceToken && templateBraceDepths.length > 0) {
      const top = templateBraceDepths[templateBraceDepths.length - 1] ?? 0;
      if (top === 0) {
        kind = scanner.reScanTemplateToken(false);
        if (kind === ts.SyntaxKind.TemplateTail) templateBraceDepths.pop();
      } else {
        templateBraceDepths[templateBraceDepths.length - 1] = top - 1;
      }
    } else if (kind === ts.SyntaxKind.TemplateHead) {
      templateBraceDepths.push(0);
    } else if (kind === ts.SyntaxKind.OpenBraceToken && templateBraceDepths.length > 0) {
      templateBraceDepths[templateBraceDepths.length - 1] =
        (templateBraceDepths[templateBraceDepths.length - 1] ?? 0) + 1;
    } else if (
      (kind === ts.SyntaxKind.SlashToken || kind === ts.SyntaxKind.SlashEqualsToken) &&
      (prevKind === null || REGEX_PRECEDING_TOKENS.has(prevKind))
    ) {
      kind = scanner.reScanSlashToken();
    }

    if (
      kind === ts.SyntaxKind.WhitespaceTrivia ||
      kind === ts.SyntaxKind.NewLineTrivia ||
      kind === ts.SyntaxKind.SingleLineCommentTrivia ||
      kind === ts.SyntaxKind.MultiLineCommentTrivia
    ) {
      sawWs = true;
      continue;
    }

    const tokenText = scanner.getTokenText();
    const opensGeneric =
      kind === ts.SyntaxKind.LessThanToken &&
      !sawWs &&
      (prevKind === ts.SyntaxKind.Identifier || prevKind === ts.SyntaxKind.GreaterThanToken);
    const closesGeneric = kind === ts.SyntaxKind.GreaterThanToken && angleDepth > 0;

    if (out.length > 0 && sawWs) {
      const noSpaceAfterPrev =
        prevKind === ts.SyntaxKind.OpenParenToken ||
        prevKind === ts.SyntaxKind.OpenBracketToken ||
        (prevKind === ts.SyntaxKind.LessThanToken && angleDepth > 0);
      const noSpaceBeforeCur =
        kind === ts.SyntaxKind.CloseParenToken ||
        kind === ts.SyntaxKind.CloseBracketToken ||
        kind === ts.SyntaxKind.CommaToken ||
        kind === ts.SyntaxKind.SemicolonToken ||
        closesGeneric;
      if (!noSpaceAfterPrev && !noSpaceBeforeCur) {
        out.push(" ");
      }
    }
    if (opensGeneric) angleDepth++;
    if (closesGeneric) angleDepth--;

    out.push(tokenText);
    prevKind = kind;
    sawWs = false;
  }
  return out.join("").trim();
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

/* ---------- Official CommonMark-Aware JSDoc Extraction (`mdast` + `comment-parser`) ---------- */

/**
 * Identify 1-based line numbers inside CommonMark code blocks (`code` nodes in mdast)
 * so `comment-parser` never mistakes `@Decorator` or `@param` inside any backtick,
 * tilde, nested, or indented code block for a JSDoc tag, while preserving original fences verbatim.
 */
function findCommonMarkCodeLines(rawCommentLines: readonly string[]): Set<number> {
  const unwrapped = rawCommentLines.map((line, idx) => {
    let s = line;
    if (idx === 0) s = s.replace(/^[ \t]*\/\*\*/, "");
    if (idx === rawCommentLines.length - 1) s = s.replace(/\*\/[ \t]*$/, "");
    if (idx > 0) s = s.replace(/^[ \t]*\* ?/, "");
    return s;
  });
  const collectFromMd = (lines: readonly string[]): Set<number> => {
    const tree = fromMarkdown(lines.join("\n"));
    const codeLines = new Set<number>();
    visit(tree, "code", (node) => {
      const startLine = node.position?.start.line;
      const endLine = node.position?.end.line;
      if (startLine !== undefined && endLine !== undefined) {
        for (let ln = startLine; ln <= endLine; ln++) codeLines.add(ln);
      }
    });
    return codeLines;
  };
  // Pass 1: find all CommonMark code blocks on the full body (fences, nested fences, indented blocks)
  const codeLines = collectFromMd(unwrapped);
  // Pass 2: replace top-level `@tag` header lines outside Pass-1 code blocks with blank lines so indented
  // code blocks starting immediately after `@example` are recognized by CommonMark as code (preserving 1:1 line numbers)
  const isolatedTagBodies = unwrapped.map((line, idx) =>
    !codeLines.has(idx + 1) && /^[ \t]{0,3}@[A-Za-z_]\w*\b/.test(line) ? "" : line,
  );
  for (const ln of collectFromMd(isolatedTagBodies)) codeLines.add(ln);
  return codeLines;
}

function stripNamedTagSeparator(rawDesc: string): string {
  const trimmed = rawDesc.trim();
  // Only strip a leading JSDoc `- ` separator (horizontal whitespace after `-`) when it is NOT a Markdown list.
  if (!/^-[ \t]+/.test(trimmed)) return trimmed;
  const lines = trimmed.split(/\r\n|\r|\n/);
  if (lines.length > 1 && lines.slice(1).some((l) => /^[ \t]*-[ \t]+/.test(l))) {
    return trimmed;
  }
  return trimmed.replace(/^-[ \t]+/, "").trim();
}

/* ---------- Official TypeScript AST Parsing for Inline `{@link}` Tags ---------- */

function isEscapedOpenBrace(text: string, idx: number): boolean {
  let backslashes = 0;
  for (let i = idx - 1; i >= 0 && text[i] === "\\"; i--) backslashes++;
  return backslashes % 2 === 1;
}

function tryParseSafeExternalUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    return SAFE_URL_SCHEMES.has(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}

function parseLinkTargetAndLabel(
  part: ts.JSDocLink | ts.JSDocLinkCode | ts.JSDocLinkPlain,
  sf: ts.SourceFile,
): { target: string; label: string; isExternalUrl: boolean } {
  // TypeScript's JSDocLink splits `{@link https://example.com | Web}` into `name = "https"` and `text = "://example.com | Web"`.
  const hasUrlColonSplit = Boolean(part.name && part.text.startsWith(":"));
  if (part.name && !hasUrlColonSplit) {
    const sym = part.name.getText(sf).trim();
    const rawText = part.text.trim();
    const label = rawText.replace(/^\|[ \t]*/, "").trim() || sym;
    return { target: sym, label, isExternalUrl: false };
  }
  const rawText = `${part.name ? part.name.getText(sf) : ""}${part.text}`.trim();
  // External URL target (e.g. `{@link https://example.com | Website}` or `{@link https://example.com Website}`)
  const pipeIdx = rawText.indexOf("|");
  if (pipeIdx !== -1) {
    const urlCand = rawText.slice(0, pipeIdx).trim();
    const label = rawText.slice(pipeIdx + 1).trim() || urlCand;
    const ext = tryParseSafeExternalUrl(urlCand);
    if (ext) return { target: ext, label, isExternalUrl: true };
    return { target: urlCand, label, isExternalUrl: false };
  }
  const wsIdx = rawText.search(/[ \t]/);
  const firstTok = wsIdx === -1 ? rawText : rawText.slice(0, wsIdx).trim();
  const restLabel = wsIdx === -1 ? "" : rawText.slice(wsIdx).trim();
  const ext = tryParseSafeExternalUrl(firstTok);
  if (ext) return { target: ext, label: restLabel || firstTok, isExternalUrl: true };
  return { target: firstTok, label: restLabel || firstTok, isExternalUrl: false };
}

function formatMdCodeSpan(text: string): string {
  const runs = text.match(/`+/g) ?? [];
  const maxRun = runs.reduce((m, r) => Math.max(m, r.length), 0);
  const fence = "`".repeat(maxRun + 1);
  const pad =
    text.startsWith("`") || text.endsWith("`") || (text.startsWith(" ") && text.endsWith(" "))
      ? " "
      : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

function hasMarkdownFormatting(text: string): boolean {
  const tree = fromMarkdown(text);
  const first = tree.children[0];
  if (!first || first.type !== "paragraph") return true;
  return first.children.some((c) => c.type !== "text");
}

function expandJsDocLinksInProseSegment(
  segment: string,
  resolveSymbolHref?: (symbol: string, preferKernelHint: boolean) => string | null,
): string {
  if (!segment.includes("{@link")) return segment;

  // Preserve exact leading/trailing whitespace so adjacent Markdown/code spans never lose spaces
  const leadWs = segment.match(/^[ \t\r\n]*/)?.[0] ?? "";
  const trailWs = segment.match(/[ \t\r\n]*$/)?.[0] ?? "";
  const core = segment.slice(leadWs.length, segment.length - trailWs.length);
  if (!core.includes("{@link")) return segment;

  // Preserve CommonMark-escaped `\{@link` by temporarily replacing escaped `{` before TS JSDoc parsing.
  const ESC_BRACE = "\uE002";
  let masked = "";
  for (let i = 0; i < core.length; i++) {
    if (core[i] === "{" && isEscapedOpenBrace(core, i)) {
      masked += ESC_BRACE;
    } else {
      masked += core[i];
    }
  }
  const CLOSE_COMMENT = "\uE003";
  const commentSafe = masked.replaceAll("*/", CLOSE_COMMENT);
  const synthetic = `/** ${commentSafe} */\nlet _;\n`;
  const sf = ts.createSourceFile(
    "__jsdoc_inline.ts",
    synthetic,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const stmt = sf.statements[0];
  if (!stmt) return segment;

  const docs = ts.getJSDocCommentsAndTags(stmt);
  const jsdoc = docs.find((d): d is ts.JSDoc => ts.isJSDoc(d));
  if (!jsdoc || !Array.isArray(jsdoc.comment)) return segment;

  const out: string[] = [];
  for (const part of jsdoc.comment) {
    if (part.kind === ts.SyntaxKind.JSDocText) {
      out.push(part.text);
      continue;
    }
    if (
      part.kind === ts.SyntaxKind.JSDocLink ||
      part.kind === ts.SyntaxKind.JSDocLinkCode ||
      part.kind === ts.SyntaxKind.JSDocLinkPlain
    ) {
      const { target, label, isExternalUrl } = parseLinkTargetAndLabel(part, sf);
      const isPlain = part.kind === ts.SyntaxKind.JSDocLinkPlain;
      const isCode = part.kind === ts.SyntaxKind.JSDocLinkCode;
      let href: string | null = null;
      if (isExternalUrl) {
        href = isSafeUrl(target) ? target : null;
      } else if (resolveSymbolHref) {
        const cleanSym = target.replace(/^@/, "").replace(/\(\)$/, "");
        const resolved = resolveSymbolHref(cleanSym, target.startsWith("@"));
        href = resolved && isSafeUrl(resolved) ? resolved : null;
      }

      const displayLabel =
        isPlain || (!isCode && (isExternalUrl || hasMarkdownFormatting(label)))
          ? label
          : formatMdCodeSpan(label);

      if (href) {
        out.push(`[${displayLabel}](<${href}>)`);
      } else {
        out.push(displayLabel);
      }
    }
  }

  return `${leadWs}${out
    .join("")
    .replaceAll(CLOSE_COMMENT, "*/")
    .replaceAll(ESC_BRACE, "{")}${trailWs}`;
}

function hasUnclosedJsDocLinkBefore(text: string, offset: number): boolean {
  let idx = text.lastIndexOf("{@link", offset);
  while (idx !== -1) {
    if (!isEscapedOpenBrace(text, idx)) {
      const closeIdx = text.indexOf("}", idx + 6);
      if (closeIdx === -1 || closeIdx > offset) return true;
      return false;
    }
    idx = idx > 0 ? text.lastIndexOf("{@link", idx - 1) : -1;
  }
  return false;
}

/** Expand `{@link}` / `{@linkcode}` / `{@linkplain}` only outside CommonMark `code` & standalone `inlineCode` spans. */
function preprocessJsDocLinks(
  markdown: string,
  resolveSymbolHref?: (symbol: string, preferKernelHint: boolean) => string | null,
): string {
  if (!markdown.includes("{@link")) return markdown;
  const tree = fromMarkdown(markdown);
  const protectedRanges: Array<[number, number]> = [];
  visit(tree, (node) => {
    if (node.type === "code" || node.type === "inlineCode") {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start !== undefined && end !== undefined) {
        // Do not split an inlineCode span that is part of a `{@link Target | `label`}` label
        if (node.type === "inlineCode" && hasUnclosedJsDocLinkBefore(markdown, start)) {
          return;
        }
        protectedRanges.push([start, end]);
      }
    }
  });
  protectedRanges.sort((a, b) => a[0] - b[0]);

  const out: string[] = [];
  let cursor = 0;
  for (const [start, end] of protectedRanges) {
    if (start > cursor) {
      out.push(expandJsDocLinksInProseSegment(markdown.slice(cursor, start), resolveSymbolHref));
    }
    if (end > cursor) {
      out.push(markdown.slice(Math.max(cursor, start), end));
      cursor = end;
    }
  }
  if (cursor < markdown.length) {
    out.push(expandJsDocLinksInProseSegment(markdown.slice(cursor), resolveSymbolHref));
  }
  return out.join("");
}

/** Extract a concise plain-text summary using official `mdast-util-to-string` (preserving image alt & inline code). */
function firstPlainSummary(markdown: string): string {
  if (!markdown.trim()) return "";
  const expanded = preprocessJsDocLinks(markdown);
  const tree = fromMarkdown(expanded);
  const firstBlock = tree.children.find(
    (c) => c.type === "paragraph" || c.type === "list" || c.type === "blockquote",
  );
  if (!firstBlock) return "";
  const raw =
    firstBlock.type === "list"
      ? firstBlock.children
          .map((item) => mdastToString(item, { includeImageAlt: true }).trim())
          .filter(Boolean)
          .join(" ")
      : mdastToString(firstBlock, { includeImageAlt: true });
  return raw.replace(/\s+/g, " ").trim();
}

/** Parse a raw `/** ... *\/` JSDoc block using `mdast` code-fence detection + `comment-parser`. */
export function parseRawJsDocComment(rawComment: string): ParsedDoc {
  const trimmed = rawComment.trim();
  if (!trimmed.startsWith("/**")) return EMPTY_DOC;

  const rawLines = trimmed.split(/\r\n|\r|\n/);
  const codeLines = findCommonMarkCodeLines(rawLines);
  const masked = rawLines
    .map((line, idx) =>
      codeLines.has(idx + 1)
        ? line.replace(/^([ \t]*\*?[ \t]*)@/, `$1${FENCED_AT_SENTINEL}`)
        : line,
    )
    .join("\n");

  const blocks = parseJsDocComment(masked, {
    spacing: "preserve",
    fence: DISABLE_FENCE_SENTINEL,
  });
  const block = blocks[0];
  if (!block) return EMPTY_DOC;

  const restore = (s: string): string => s.replaceAll(FENCED_AT_SENTINEL, "@");
  const markdown = restore(block.description).trim();
  const tags: JsDocTagEntry[] = block.tags.map((spec) => {
    const tag = restore(spec.tag);
    const name = restore(spec.name);
    const desc = restore(spec.description);
    if (NAMED_JSDOC_TAGS.has(tag)) {
      return {
        tag,
        name: name || undefined,
        markdown: stripNamedTagSeparator(desc),
      };
    }
    // Reconstruct raw block-tag body from `spec.source` lines so leading code indentation
    // (e.g. `@example\n *     @Decorator()`) is never stripped by `comment-parser`'s name tokenizer.
    const bodyLines = spec.source.map((line, lineIdx) => {
      const t = line.tokens;
      if (lineIdx === 0) {
        return restore(`${t.type}${t.postType}${t.name}${t.postName}${t.description}`);
      }
      const indent = t.postDelimiter.startsWith(" ") ? t.postDelimiter.slice(1) : t.postDelimiter;
      return restore(
        `${indent}${t.tag}${t.postTag}${t.type}${t.postType}${t.name}${t.postName}${t.description}`,
      );
    });
    const combined = bodyLines
      .join("\n")
      .replace(/^(?:[ \t]*\r?\n)+/, "")
      .trimEnd();
    return { tag, markdown: combined };
  });

  return { markdown, summary: firstPlainSummary(markdown), tags };
}

function mergeParsedDocs(docs: readonly ParsedDoc[]): ParsedDoc {
  if (docs.length === 0) return EMPTY_DOC;
  if (docs.length === 1) return docs[0] ?? EMPTY_DOC;
  const markdown = docs
    .map((d) => d.markdown)
    .filter(Boolean)
    .join("\n\n");
  const tags = docs.flatMap((d) => d.tags);
  return { markdown, summary: firstPlainSummary(markdown), tags };
}

/** Extract and merge all leading `/** ... *\/` JSDoc blocks attached to a declaration. */
export function extractJsDoc(node: ts.Node, sf: ts.SourceFile): ParsedDoc {
  const ranges = ts.getLeadingCommentRanges(sf.text, node.pos);
  if (!ranges) return EMPTY_DOC;
  const parsed: ParsedDoc[] = [];
  for (const range of ranges) {
    const txt = sf.text.slice(range.pos, range.end);
    if (txt.startsWith("/**")) {
      parsed.push(parseRawJsDocComment(txt));
    }
  }
  return mergeParsedDocs(parsed);
}

/** Extract the first file-top `/** ... *\/` JSDoc block (skipping shebangs or `//` license headers). */
export function extractFileTopJsDoc(sf: ts.SourceFile): ParsedDoc {
  const ranges = ts.getLeadingCommentRanges(sf.text, 0);
  if (!ranges) return EMPTY_DOC;
  for (const range of ranges) {
    const txt = sf.text.slice(range.pos, range.end);
    if (txt.startsWith("/**")) return parseRawJsDocComment(txt);
  }
  return EMPTY_DOC;
}

/* ---------- Official CommonMark (mdast → hast → html) Pipeline with WHATWG URL Sanitization ---------- */

export interface MarkdownRenderOptions {
  resolveSymbolHref?: (symbol: string, preferKernelHint: boolean) => string | null;
  renderCodeBlock?: (code: string, lang: string) => Element;
  linkClass?: string;
  inlineOnly?: boolean;
}

function textContent(node: RootContent): string {
  if (node.type === "text") return node.value;
  if (node.type === "element") return node.children.map(textContent).join("");
  return "";
}

/**
 * Parse an inline code span with TypeScript's real parser to accept valid identifiers
 * (`Widget`, `$schema`, `配置`), qualified names (`Kernel.Widget`), or zero-arg calls (`bootModules()`),
 * with optional leading `@` decorator hint.
 */
function parseCodeSpanSymbol(raw: string): { symbol: string; preferKernelHint: boolean } | null {
  const trimmed = raw.trim();
  if (!trimmed || /[\r\n;]/.test(trimmed)) return null;
  const preferKernelHint = trimmed.startsWith("@");
  const body = preferKernelHint ? trimmed.slice(1) : trimmed;
  if (!body) return null;

  const sf = ts.createSourceFile(
    "__span.ts",
    body,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TS,
  );
  const parseDiagnostics = (sf as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] })
    .parseDiagnostics;
  if ((parseDiagnostics?.length ?? 0) > 0 || sf.statements.length !== 1) return null;
  const stmt = sf.statements[0];
  if (!stmt || !ts.isExpressionStatement(stmt)) return null;
  if (stmt.getStart(sf) !== 0 || stmt.getEnd() !== body.length) return null;

  let expr: ts.Expression = stmt.expression;
  if (ts.isCallExpression(expr)) {
    if (expr.arguments.length > 0 || (expr.typeArguments?.length ?? 0) > 0) return null;
    expr = expr.expression;
  }

  const parts: string[] = [];
  let cur: ts.Expression = expr;
  while (ts.isPropertyAccessExpression(cur)) {
    parts.unshift(cur.name.text);
    cur = cur.expression;
  }
  if (!ts.isIdentifier(cur)) return null;
  parts.unshift(cur.text);
  return { symbol: parts.join("."), preferKernelHint };
}

function unwrapChildren(children: ElementContent[]): ElementContent {
  if (children.length === 1 && children[0]) return children[0];
  return { type: "element", tagName: "span", properties: {}, children };
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

  // Fenced / indented code blocks: <pre><code class="language-...">...</code></pre>
  if (node.tagName === "pre" && opts.renderCodeBlock) {
    const codeChild = node.children.find(
      (c): c is Element => c.type === "element" && c.tagName === "code",
    );
    if (codeChild) {
      const cls = codeChild.properties?.className;
      const langClass = Array.isArray(cls)
        ? cls.find((x): x is string => typeof x === "string" && x.startsWith("language-"))
        : undefined;
      const lang = langClass ? langClass.slice("language-".length) : "text";
      const code = textContent(codeChild).replace(/\n$/, "");
      return opts.renderCodeBlock(code, lang);
    }
  }

  // Sanitize <img> src URL via WHATWG `new URL()`
  if (node.tagName === "img") {
    const src = typeof node.properties?.src === "string" ? node.properties.src : "";
    if (!isSafeUrl(src)) {
      const alt = typeof node.properties?.alt === "string" ? node.properties.alt : "";
      return { type: "text", value: alt };
    }
    return node;
  }

  // Sanitize <a> href URL via WHATWG `new URL()`
  if (node.tagName === "a") {
    const href = typeof node.properties?.href === "string" ? node.properties.href : "";
    const children = node.children.map((ch) => transformHastNode(ch, opts, true) as ElementContent);
    if (inAnchor || !isSafeUrl(href)) {
      return unwrapChildren(children);
    }
    return {
      ...node,
      properties: {
        ...node.properties,
        ...(opts.linkClass && !node.properties?.className && !node.properties?.class
          ? { className: [opts.linkClass] }
          : {}),
        href,
      },
      children,
    };
  }

  // Auto-link valid TypeScript identifier/call `code` spans when not already inside an anchor
  if (node.tagName === "code") {
    if (!inAnchor && opts.resolveSymbolHref) {
      const parsed = parseCodeSpanSymbol(textContent(node));
      if (parsed) {
        const href = opts.resolveSymbolHref(parsed.symbol, parsed.preferKernelHint);
        if (href && isSafeUrl(href)) {
          return {
            type: "element",
            tagName: "a",
            properties: {
              ...(opts.linkClass ? { className: [opts.linkClass] } : {}),
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
    children: node.children.map((ch) => transformHastNode(ch, opts, inAnchor) as ElementContent),
  };
}

export function markdownToHast(markdown: string, opts: MarkdownRenderOptions = {}): Root {
  const expanded = preprocessJsDocLinks(markdown, opts.resolveSymbolHref);
  const mdast = fromMarkdown(expanded);
  const rawHast = toHast(mdast, { allowDangerousHtml: false }) as Root;
  return transformHastNode(rawHast, opts) as Root;
}

/** Extract the first top-level paragraph (or first block) of Markdown as HAST nodes while preserving reference link definitions. */
export function markdownFirstBlockToHast(markdown: string, opts: MarkdownRenderOptions = {}): Root {
  const expanded = preprocessJsDocLinks(markdown, opts.resolveSymbolHref);
  const mdast = fromMarkdown(expanded);
  const chosen = mdast.children.find((c) => c.type === "paragraph") ?? mdast.children[0];
  if (!chosen) return { type: "root", children: [] };
  const definitions: typeof mdast.children = [];
  visit(mdast, "definition", (def) => {
    definitions.push(def);
  });
  const rawHast = toHast(
    { type: "root", children: [chosen, ...definitions] },
    { allowDangerousHtml: false },
  ) as Root;
  return transformHastNode(rawHast, opts) as Root;
}

const PHRASING_TAGS = new Set([
  "a",
  "abbr",
  "b",
  "br",
  "code",
  "del",
  "em",
  "i",
  "img",
  "kbd",
  "mark",
  "s",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "u",
]);

function flattenToInlineHast(nodes: readonly RootContent[]): ElementContent[] {
  const out: ElementContent[] = [];
  for (const n of nodes) {
    if (n.type === "text") {
      out.push(n);
    } else if (n.type === "element") {
      if (PHRASING_TAGS.has(n.tagName)) {
        out.push({ ...n, children: flattenToInlineHast(n.children) });
      } else if (n.tagName === "pre") {
        if (out.length > 0)
          out.push({ type: "element", tagName: "br", properties: {}, children: [] });
        out.push({
          type: "element",
          tagName: "code",
          properties: {},
          children: [{ type: "text", value: textContent(n).trim() }],
        });
      } else if (
        n.tagName === "ul" ||
        n.tagName === "ol" ||
        n.tagName === "table" ||
        n.tagName === "thead" ||
        n.tagName === "tbody"
      ) {
        out.push(...flattenToInlineHast(n.children));
      } else {
        const inner = flattenToInlineHast(n.children);
        if (inner.length > 0) {
          if (out.length > 0)
            out.push({ type: "element", tagName: "br", properties: {}, children: [] });
          out.push(...inner);
        }
      }
    }
  }
  return out;
}

export function renderMarkdownHtml(markdown: string, opts: MarkdownRenderOptions = {}): string {
  if (!markdown.trim()) return "";
  const hast = markdownToHast(markdown, opts);
  if (opts.inlineOnly) {
    return toHtml({ type: "root", children: flattenToInlineHast(hast.children) });
  }
  return toHtml(hast);
}
