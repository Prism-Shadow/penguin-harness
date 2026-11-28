import type { Element } from "hast";
import { toHtml } from "hast-util-to-html";
import ts from "typescript";
import {
  type CodeHighlighter,
  rewriteKernelRootInHast,
  stripSelfLinksInHast,
  type SymbolLinkResolver,
} from "../highlight.js";
import { isSafeUrl, renderMarkdownHtml, slugOf } from "../jsdoc.js";
import type {
  ComponentRecord,
  ExtractedData,
  HttpContribRecord,
  IfaceRecord,
  JsDocTagEntry,
  KernelExport,
  KernelExportKind,
  MemberItem,
  ModuleRecord,
  NodeBase,
  ParsedDoc,
  SlotRecord,
  VerifiedSample,
} from "../types.js";

const BADGE_TYPE_KEYS = new Set([
  "decorator",
  "function",
  "class",
  "interface",
  "type_alias",
  "ng_module",
  "directive",
  "pipe",
  "block",
]);

const PRESERVE_MODULE_SUFFIX = new Set(["PlatformModule", "WebAppModule"]);

export const ICONS = {
  overview: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/></svg>`,
  kernel: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 2 2 7l10 5 10-5-10-5z"/><path d="m2 12 10 5 10-5"/><path d="m2 17 10 5 10-5"/></svg>`,
  modules: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.3 7 12 12l8.7-5M12 22V12"/></svg>`,
  interfaces: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M16 18l6-6-6-6M8 6l-6 6 6 6M14.5 4l-5 16"/></svg>`,
  apis: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>`,
  contributions: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98"/></svg>`,
  search: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>`,
  code: `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M9.4 16.6 4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0 4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z"/></svg>`,
  up: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 19V5M5 12l7-7 7 7"/></svg>`,
} as const;

export const COPY_BTN = `<button type="button" docs-copy-source-code aria-label="Copy code" title="Copy code"><svg class="docs-copy" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg><svg class="docs-check" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M20 6 9 17l-5-5"/></svg></button>`;

export const GLOBE_SVG = `<svg class="docs-what-is-angular-svg" width="260" height="220" viewBox="0 0 260 220" fill="none" aria-hidden="true">
  <g stroke="rgba(255,255,255,0.28)" stroke-width="1.2">
    <circle cx="170" cy="110" r="92"/>
    <ellipse cx="170" cy="110" rx="92" ry="38" transform="rotate(-18 170 110)"/>
    <ellipse cx="170" cy="110" rx="92" ry="68" transform="rotate(-18 170 110)"/>
    <ellipse cx="170" cy="110" rx="38" ry="92" transform="rotate(-18 170 110)"/>
    <ellipse cx="170" cy="110" rx="68" ry="92" transform="rotate(-18 170 110)"/>
    <line x1="78" y1="110" x2="262" y2="110" transform="rotate(-18 170 110)"/>
    <line x1="170" y1="18" x2="170" y2="202" transform="rotate(-18 170 110)"/>
  </g>
</svg>`;

export function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function trimModule(name: string): string {
  if (PRESERVE_MODULE_SUFFIX.has(name) || !name.endsWith("Module")) return name;
  const stem = name.slice(0, -"Module".length);
  return stem || name;
}

export function apiLabel(typeKey: string, letter: string, fullText: string | null = null): string {
  const safeKey = BADGE_TYPE_KEYS.has(typeKey) ? typeKey : "block";
  return fullText
    ? `<span class="docs-api-item-label type-${safeKey} full">${esc(fullText)}</span>`
    : `<span class="docs-api-item-label type-${safeKey}" aria-hidden="true">${esc(letter)}</span>`;
}

export function kernelBadgeMeta(kind: KernelExportKind): {
  tKey: string;
  ch: string;
  label: string;
} {
  if (kind === "decorator") return { tKey: "decorator", ch: "@", label: "decorator" };
  if (kind === "function") return { tKey: "function", ch: "F", label: "function" };
  if (kind === "class") return { tKey: "class", ch: "C", label: "class" };
  if (kind === "interface") return { tKey: "interface", ch: "I", label: "interface" };
  return { tKey: "type_alias", ch: "T", label: "type-alias" };
}

/**
 * Remove Shiki `// [!code highlight]` / `// [!code hl]` annotation comments for clipboard copy
 * using TypeScript's real parsed comment ranges so string/template literals are never mutated.
 */
function stripShikiNotationComments(code: string): string {
  const sf = ts.createSourceFile("__copy.ts", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const commentByPos = new Map<number, ts.CommentRange>();
  const addRanges = (ranges: readonly ts.CommentRange[] | undefined): void => {
    if (!ranges) return;
    for (const r of ranges) {
      if (r.kind === ts.SyntaxKind.SingleLineCommentTrivia) commentByPos.set(r.pos, r);
    }
  };
  const walk = (node: ts.Node): void => {
    addRanges(ts.getLeadingCommentRanges(code, node.pos));
    addRanges(ts.getTrailingCommentRanges(code, node.end));
    for (const ch of node.getChildren(sf)) walk(ch);
  };
  walk(sf);

  const removals: Array<[number, number]> = [];
  for (const range of [...commentByPos.values()].sort((a, b) => a.pos - b.pos)) {
    const text = code.slice(range.pos, range.end);
    if (!/^\/\/[ \t]*\[!code[ \t]+(?:highlight|hl)(?::\d+)?\][ \t]*$/.test(text)) continue;

    let start = range.pos;
    const end = range.end;
    while (start > 0 && (code[start - 1] === " " || code[start - 1] === "\t")) start--;
    const atLineStart = start === 0 || code[start - 1] === "\n" || code[start - 1] === "\r";
    if (atLineStart) {
      let lineEnd = end;
      if (code[lineEnd] === "\r" && code[lineEnd + 1] === "\n") lineEnd += 2;
      else if (code[lineEnd] === "\n" || code[lineEnd] === "\r") lineEnd += 1;
      removals.push([start, lineEnd]);
    } else {
      removals.push([start, end]);
    }
  }

  if (removals.length === 0) return code;
  const parts: string[] = [];
  let cursor = 0;
  for (const [start, end] of removals) {
    if (start > cursor) parts.push(code.slice(cursor, start));
    cursor = Math.max(cursor, end);
  }
  if (cursor < code.length) parts.push(code.slice(cursor));
  return parts.join("");
}

export interface ShellOptions {
  r: string;
  title: string;
  section: string;
  side?: string;
  toc?: string;
  body: string;
  wide?: boolean;
}

export interface CodeBlockOptions {
  file?: string;
  line?: number | null;
  lang?: string;
  r?: string | null;
  preferKernel?: boolean;
  currentSymbol?: string | null;
}

export class RenderContext {
  readonly gitSha: string;
  readonly standaloneComponents: ComponentRecord[];
  readonly ifaceByName = new Map<string, IfaceRecord>();
  readonly kernelByName = new Map<string, KernelExport>();
  readonly moduleByName = new Map<string, ModuleRecord>();
  readonly compByName = new Map<string, ComponentRecord>();
  readonly slotByKey = new Map<string, SlotRecord>();
  readonly httpByCls = new Map<string, HttpContribRecord>();
  readonly kernelReferences = new Map<string, KernelExport[]>();
  readonly kernelReferencedBy = new Map<string, KernelExport[]>();

  constructor(
    readonly data: ExtractedData,
    readonly verifiedSamples: Readonly<Record<string, VerifiedSample>>,
    readonly assetVer: string,
    readonly highlighter: CodeHighlighter,
  ) {
    this.gitSha = data.git.sha || "main";
    this.standaloneComponents = data.components.filter((c) => !c.primaryParent);

    for (const it of data.ifaces) {
      if (!this.ifaceByName.has(it.name)) this.ifaceByName.set(it.name, it);
    }
    for (const k of data.kernel.exports) {
      this.kernelByName.set(k.name, k);
      this.kernelReferences.set(k.name, []);
      this.kernelReferencedBy.set(k.name, []);
    }
    for (const m of data.modules) {
      if (!this.moduleByName.has(m.name)) this.moduleByName.set(m.name, m);
    }
    for (const c of data.components) this.compByName.set(c.name, c);
    for (const s of data.slots) this.slotByKey.set(s.key, s);
    for (const g of data.httpContribs) this.httpByCls.set(g.cls, g);

    // Build reverse cross-reference graph directly from TypeChecker-resolved `k.references`
    for (const k of data.kernel.exports) {
      for (const refName of k.references) {
        const target = this.kernelByName.get(refName);
        if (!target) continue;
        this.kernelReferences.get(k.name)?.push(target);
        this.kernelReferencedBy.get(refName)?.push(k);
      }
    }
    for (const list of this.kernelReferences.values()) {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
    for (const list of this.kernelReferencedBy.values()) {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
  }

  srcUrl(rel: string, line: number | null = null): string {
    const segments = rel.split("/").filter((s) => s.length > 0);
    if (segments.some((s) => s === "." || s === "..")) {
      throw new Error(`Invalid repository-relative source path: ${rel}`);
    }
    const encodedPath = segments.map((seg) => encodeURIComponent(seg)).join("/");
    const url = new URL(
      `/Prism-Shadow/penguin-harness/blob/${encodeURIComponent(this.gitSha)}/${encodedPath}`,
      "https://github.com",
    );
    if (line !== null && Number.isInteger(line) && line > 0) {
      url.hash = `L${line}`;
    }
    return url.href;
  }

  symbolHref(word: string, r: string | null, preferKernel = false): string | null {
    if (r === null) return null;
    const k = this.kernelByName.get(word);
    const it = this.ifaceByName.get(word);
    const mod = this.moduleByName.get(word);
    const comp = this.compByName.get(word);
    if (preferKernel && k) return `${r}kernel/${k.slug}/`;
    if (it) return `${r}interfaces/${it.slug}/`;
    if (k) return `${r}kernel/${k.slug}/`;
    if (mod) return `${r}modules/${mod.slug}/`;
    if (comp) return `${r}${comp.href}`;
    return null;
  }

  private linkResolver(
    r: string | null,
    preferKernel: boolean,
    currentSymbol: string | null,
  ): SymbolLinkResolver | null {
    if (r === null) return null;
    return {
      resolveSymbol: (word, isDecorator) => {
        if (word === currentSymbol) return null;
        if (!isDecorator && word === "type" && !preferKernel) return null;
        const href = this.symbolHref(word, r, preferKernel || isDecorator);
        return href && isSafeUrl(href) ? href : null;
      },
      resolveSlot: (slotKey) => {
        if (!this.slotByKey.has(slotKey)) return null;
        const href = `${r}contributions/index.html#${slugOf(slotKey)}`;
        return isSafeUrl(href) ? href : null;
      },
    };
  }

  /** Highlight inline TypeScript/code via official Shiki + AST-backed decorations. */
  hl(
    src: string,
    r: string | null = null,
    preferKernel = false,
    currentSymbol: string | null = null,
    lang = "ts",
  ): string {
    const resolver = this.linkResolver(r, preferKernel, currentSymbol);
    const cacheKey = JSON.stringify([r, preferKernel, currentSymbol]);
    const inner = this.highlighter.highlightInline(src, lang, resolver, cacheKey);
    return `<span class="shiki">${inner}</span>`;
  }

  codeBlock(src: string, opts: CodeBlockOptions = {}): string {
    const {
      file,
      line = null,
      lang = "ts",
      r = null,
      preferKernel = false,
      currentSymbol = null,
    } = opts;
    const resolver = this.linkResolver(r, preferKernel, currentSymbol);
    const cacheKey = JSON.stringify([r, preferKernel, currentSymbol]);
    const shikiPre = this.highlighter.highlightBlock(src, lang, resolver, cacheKey);
    const head = file
      ? `<div class="docs-code-header"><a href="${esc(this.srcUrl(file, line))}" target="_blank" rel="noopener">${esc(file)}${line ? `:${line}` : ""} ↗</a></div>`
      : "";
    return `<div class="docs-code">${head}${COPY_BTN}${shikiPre}</div>`;
  }

  renderMarkdown(
    markdown: string,
    r = "",
    preferKernel = false,
    opts: { allowSymbolLinks?: boolean; inlineOnly?: boolean } = {},
  ): string {
    if (!markdown.trim()) return "";
    const allowSymbolLinks = opts.allowSymbolLinks ?? true;
    const resolver = allowSymbolLinks ? this.linkResolver(r, preferKernel, null) : null;
    return renderMarkdownHtml(markdown, {
      inlineOnly: opts.inlineOnly,
      resolveSymbolHref: allowSymbolLinks
        ? (sym, preferHint) => {
            const direct = this.symbolHref(sym, r, preferKernel || preferHint);
            if (direct) return direct;
            const lastPart = sym.includes(".") ? sym.slice(sym.lastIndexOf(".") + 1) : null;
            return lastPart ? this.symbolHref(lastPart, r, preferKernel || preferHint) : null;
          }
        : undefined,
      renderCodeBlock: (code, lang): Element => ({
        type: "element",
        tagName: "div",
        properties: { className: ["docs-code"] },
        children: [this.highlighter.highlightBlockHast(code, lang, resolver)],
      }),
    });
  }

  renderParsedDoc(
    doc: ParsedDoc,
    r = "",
    preferKernel = false,
    visibleTags?: readonly JsDocTagEntry[],
  ): string {
    const parts: string[] = [];
    if (doc.markdown) {
      parts.push(this.renderMarkdown(doc.markdown, r, preferKernel));
    }
    const tags = visibleTags ?? doc.tags;
    for (const t of tags) {
      const tagBody = t.name
        ? `<code>${esc(t.name)}</code>${t.markdown ? ` ${this.renderMarkdown(t.markdown, r, preferKernel, { inlineOnly: true })}` : ""}`
        : this.renderMarkdown(t.markdown, r, preferKernel, { inlineOnly: true });
      parts.push(
        `<div class="docs-param-group"><span class="docs-param-keyword">@${esc(t.tag)}</span><span>${tagBody}</span></div>`,
      );
    }
    return parts.join("\n");
  }

  /** Render a type reference chip using AST-extracted `typeRefs` (or Shiki inline linking for compound types). */
  linkifyType(
    typeStr: string,
    r: string,
    preferKernel = false,
    typeRefs?: readonly string[],
  ): string {
    if (typeRefs && typeRefs.length === 1 && typeRefs[0]) {
      const href = this.symbolHref(typeRefs[0], r, preferKernel);
      if (href && isSafeUrl(href)) {
        return `<a href="${esc(href)}"><code>${esc(typeStr)}</code></a>`;
      }
    }
    const directHref = this.symbolHref(typeStr, r, preferKernel);
    if (directHref && isSafeUrl(directHref)) {
      return `<a href="${esc(directHref)}"><code>${esc(typeStr)}</code></a>`;
    }
    if (typeRefs && typeRefs.length > 1) {
      return `<code>${this.hl(typeStr, r, preferKernel)}</code>`;
    }
    return `<code>${esc(typeStr)}</code>`;
  }

  lookupVerifiedSample(ownerTypeName: string | null, memberName: string): VerifiedSample | null {
    if (!ownerTypeName || !memberName) return null;
    const direct = this.verifiedSamples[`${ownerTypeName}.${memberName}`];
    if (direct) return direct;
    if (ownerTypeName === "ComponentMeta") {
      return this.verifiedSamples[`ModuleMeta.${memberName}`] ?? null;
    }
    return null;
  }

  renderRichSampleBlock(
    sample: VerifiedSample,
    r: string,
    currentSymbol: string | null = null,
  ): string {
    const failBanner = !sample.verified
      ? `<div class="docs-sample-fail"><div class="docs-sample-fail-head"><strong>⚠ Sample failing</strong><code>${esc(sample.testFile)}:${sample.line}</code></div>${sample.error ? `<pre>${esc(sample.error)}</pre>` : ""}</div>`
      : "";

    let html = "";
    if (sample.hast) {
      const rooted = rewriteKernelRootInHast(sample.hast, `${r}kernel/`);
      const cleaned = stripSelfLinksInHast(rooted, currentSymbol);
      html = toHtml(cleaned);
    }

    if (!html) {
      return `${failBanner}${this.codeBlock(sample.code, { r, preferKernel: true, currentSymbol })}`;
    }

    const cleanCopy = stripShikiNotationComments(sample.code);
    return `${failBanner}<div class="docs-code docs-twoslash" data-copy-code="${esc(cleanCopy)}">${COPY_BTN}${html}</div>`;
  }

  memberSection(
    m: MemberItem,
    r: string,
    preferKernel = false,
    ownerTypeName: string | null = null,
    currentSymbol: string | null = null,
    anchorId?: string,
  ): string {
    const rawName = m.name || "member";
    const id = anchorId ?? slugOf(rawName);
    const sample = this.lookupVerifiedSample(ownerTypeName, rawName);

    const paramRows = m.params
      .map(
        (p) =>
          `<div class="docs-param-group"><span class="docs-param-keyword">@param</span><span class="docs-param-name">${p.rest ? "..." : ""}${esc(p.name)}${p.optional ? "?" : ""}</span><code class="docs-param-type">${this.hl(p.type, r, preferKernel, currentSymbol)}</code></div>`,
      )
      .join("");

    const retRow =
      m.kind === "method" && m.returnType
        ? `<div class="docs-return-type"><span class="docs-param-keyword">@returns</span><code>${this.hl(m.returnType, r, preferKernel, currentSymbol)}</code></div>`
        : "";

    const renderedDoc = this.renderParsedDoc(m.doc, r, preferKernel);
    const docHtml = renderedDoc
      ? `<div class="docs-function-definition">${renderedDoc}</div>`
      : sample?.doc
        ? `<div class="docs-function-definition">${this.renderMarkdown(sample.doc, r, preferKernel)}</div>`
        : "";

    const sampleHtml = sample
      ? `<div class="docs-sample-wrap">${this.renderRichSampleBlock(sample, r, currentSymbol)}</div>`
      : "";

    const hasBody = Boolean(docHtml || paramRows || retRow || sampleHtml);
    return `<div class="docs-reference-member-card" id="${esc(id)}">
  <header class="docs-reference-card-header">
    <h3><a class="docs-anchor" href="#${esc(id)}">${esc(rawName)}</a></h3>
    <div class="docs-card-sig"><code>${this.hl(m.sig, r, preferKernel, currentSymbol)}</code></div>
  </header>${
    hasBody
      ? `
  <div class="docs-reference-card-body">
    <div class="docs-reference-card-item">
      ${docHtml}
      ${paramRows}
      ${retRow}
      ${sampleHtml}
    </div>
  </div>`
      : ""
  }
</div>`;
  }

  filterToolbar(
    placeholder: string,
    types: ReadonlyArray<readonly [string, string, string, string]>,
    pkgLabel = "All Packages",
  ): string {
    return `<div class="adev-reference-list-filter">
  <div class="adev-reference-list-query-filter">
    <div class="docs-text-field-wrap">
      ${ICONS.search}
      <input type="search" class="docs-text-field" data-filter-input placeholder="${esc(placeholder)}" autocomplete="off">
    </div>
    <div class="docs-select-mock">${esc(pkgLabel)} <span>▾</span></div>
  </div>
  <p class="adev-reference-list-type-filter-label">Filter by Identifier type</p>
  <ul class="adev-reference-list-type-filter">
    <li class="adev-reference-list-type-filter-item adev-reference-list-type-filter-item-active" role="button" tabindex="0" aria-pressed="true" data-filter-type="all">${apiLabel("block", "B")}<span>All</span></li>
    ${types.map(([key, tKey, ch, label]) => `<li class="adev-reference-list-type-filter-item" role="button" tabindex="0" aria-pressed="false" data-filter-type="${esc(key)}">${apiLabel(tKey, ch)}<span class="docs-api-item-label-full">${esc(label)}</span></li>`).join("")}
  </ul>
</div>`;
  }

  nodeWiringChips(node: NodeBase, r: string): string {
    const parts: string[] = [];
    if (node.uses.length) {
      parts.push(
        `<div class="docs-param-group"><span class="docs-param-keyword">@Use</span><span class="docs-param-name">requires</span>${node.uses.map((u) => this.linkifyType(u.type, r, false, u.typeRefs)).join(" ")}</div>`,
      );
    }
    if (node.provides.length) {
      parts.push(
        `<div class="docs-param-group"><span class="docs-param-keyword">@Provide</span><span class="docs-param-name">provides</span>${node.provides.map((p) => this.linkifyType(p.type, r, false, p.typeRefs)).join(" ")}</div>`,
      );
    }
    if (node.binds.length) {
      parts.push(
        `<div class="docs-param-group"><span class="docs-param-keyword">@Bind</span><span class="docs-param-name">slot</span>${node.binds.map((b) => `<code>${esc(b.id)}</code>`).join(" ")}</div>`,
      );
    }
    const slotKeys = Object.keys(node.contributes);
    if (slotKeys.length) {
      parts.push(
        `<div class="docs-param-group"><span class="docs-param-keyword">@contributes</span><span class="docs-param-name">slots</span>${slotKeys.map((sk) => `<a href="${esc(`${r}contributions/index.html#${slugOf(sk)}`)}"><code>${esc(sk)}</code></a>`).join(" ")}</div>`,
      );
    }
    return parts.join("");
  }

  nodeWiringBlocks(node: NodeBase, r: string): string {
    const rows: string[] = [];
    if (node.implements.length) {
      rows.push(
        `<div class="docs-wiring-row"><span class="docs-param-keyword">implements</span><span class="docs-wiring-role">interfaces</span><div class="docs-wiring-chips">${node.implements.map((x) => this.linkifyType(x, r)).join(" ")}</div></div>`,
      );
    }
    if (node.uses.length) {
      rows.push(
        `<div class="docs-wiring-row"><span class="docs-param-keyword">@Use</span><span class="docs-wiring-role">requires (${node.uses.length})</span><div class="docs-wiring-chips">${node.uses.map((u) => `<code>${esc(u.field)}</code>: ${this.linkifyType(u.type, r, false, u.typeRefs)}${u.from ? ` <span class="muted">from ${this.linkifyType(u.from, r)}</span>` : ""}`).join(" · ")}</div></div>`,
      );
    }
    if (node.provides.length) {
      rows.push(
        `<div class="docs-wiring-row"><span class="docs-param-keyword">@Provide</span><span class="docs-wiring-role">provides (${node.provides.length})</span><div class="docs-wiring-chips">${node.provides.map((p) => `<code>${esc(p.field)}</code>: ${this.linkifyType(p.type, r, false, p.typeRefs)}`).join(" · ")}</div></div>`,
      );
    }
    if (node.binds.length) {
      rows.push(
        `<div class="docs-wiring-row"><span class="docs-param-keyword">@Bind</span><span class="docs-wiring-role">binds (${node.binds.length})</span><div class="docs-wiring-chips">${node.binds.map((b) => `<code>${esc(b.field)}</code> → <code>${esc(b.id)}</code>: ${this.linkifyType(b.type, r, false, b.typeRefs)}`).join(" · ")}</div></div>`,
      );
    }
    if (!rows.length) return "";
    return `<section class="docs-wiring-box" id="wiring">
  <div class="docs-wiring-head">
    <h2 class="docs-reference-section-heading"><a class="docs-anchor" href="#wiring">Dependencies &amp; Wiring</a></h2>
    <span class="docs-wiring-sub">Extracted from class decorators</span>
  </div>
  <div class="docs-wiring-grid">${rows.join("")}</div>
</section>`;
  }

  ifaceWiringSection(ifaceName: string, r: string): string {
    const exportedBy = this.data.modules.filter((m) => m.exports.includes(ifaceName));
    const providedBy: Array<{ name: string; href: string }> = [];
    const consumedBy: Array<{ name: string; href: string }> = [];

    for (const node of [...this.data.modules, ...this.data.components]) {
      const href = node.kind === "module" ? `${r}modules/${node.slug}/` : `${r}${node.href}`;
      const providesMatch =
        node.provides.some((p) => p.typeRefs.includes(ifaceName)) ||
        node.implements.includes(ifaceName);
      if (providesMatch) providedBy.push({ name: node.name, href });
      if (node.uses.some((u) => u.typeRefs.includes(ifaceName))) {
        consumedBy.push({ name: node.name, href });
      }
    }

    if (!exportedBy.length && !providedBy.length && !consumedBy.length) return "";
    const chips = (list: ReadonlyArray<{ name: string; href: string }>) =>
      list
        .map((x) => `<a class="docs-wiring-chip" href="${esc(x.href)}">${esc(x.name)}</a>`)
        .join("");

    return `<section class="docs-wiring-box" id="wiring">
  <div class="docs-wiring-head">
    <h2 class="docs-reference-section-heading"><a class="docs-anchor" href="#wiring">Contract Topology</a></h2>
    <span class="docs-wiring-sub">Static AST wiring across @Module / @Provide / @Use</span>
  </div>
  <div class="docs-wiring-grid">
    ${exportedBy.length ? `<div class="docs-wiring-row"><span class="docs-param-keyword">@Module</span><span class="docs-wiring-role">exported by</span><div class="docs-wiring-chips">${exportedBy.map((m) => `<a class="docs-wiring-chip" href="${esc(`${r}modules/${m.slug}/`)}">${esc(m.name)}</a>`).join("")}</div></div>` : ""}
    ${providedBy.length ? `<div class="docs-wiring-row"><span class="docs-param-keyword">@Provide</span><span class="docs-wiring-role">provided by</span><div class="docs-wiring-chips">${chips(providedBy)}</div></div>` : ""}
    ${consumedBy.length ? `<div class="docs-wiring-row"><span class="docs-param-keyword">@Use</span><span class="docs-wiring-role">consumed by (${consumedBy.length})</span><div class="docs-wiring-chips">${chips(consumedBy)}</div></div>` : ""}
  </div>
</section>`;
  }

  overviewSidebar(r: string): string {
    const pmSlug = this.moduleByName.get("PlatformModule")?.slug ?? "platform";
    const webSlug = this.moduleByName.get("WebAppModule")?.slug ?? "web-app";
    const cliSlug = this.moduleByName.get("CliCommandsModule")?.slug ?? "cli-commands";
    return `<div class="docs-secondary-nav-header">Introduction</div>
<ul class="docs-navigation-list docs-faceted-list">
  <li class="docs-faceted-list-item"><a class="docs-faceted-list-item-active" href="${r}index.html"><span class="docs-faceted-list-item-text">Architecture Overview</span></a></li>
  <li class="docs-faceted-list-item"><a href="${r}kernel/index.html"><span class="docs-faceted-list-item-text">Kernel API Reference</span><span class="tag docs-new-item">Showcase</span></a></li>
  <li class="docs-faceted-list-item"><a href="${r}modules/${pmSlug}/"><span class="docs-faceted-list-item-text">PlatformModule</span><span class="tag docs-updated-item">Root</span></a></li>
  <li class="docs-faceted-list-item"><a href="${r}modules/${webSlug}/"><span class="docs-faceted-list-item-text">WebAppModule</span><span class="tag">Web</span></a></li>
  <li class="docs-faceted-list-item"><a href="${r}modules/${cliSlug}/"><span class="docs-faceted-list-item-text">CliCommandsModule</span><span class="tag">CLI</span></a></li>
</ul>
<div class="docs-secondary-nav-header">Reference Surfaces</div>
<ul class="docs-navigation-list docs-faceted-list">
  <li class="docs-faceted-list-item"><a href="${r}kernel/index.html"><span class="docs-faceted-list-item-text">Kernel API</span><span class="tag docs-new-item">${this.data.kernel.exports.length}</span></a></li>
  <li class="docs-faceted-list-item"><a href="${r}modules/index.html"><span class="docs-faceted-list-item-text">Modules</span><span class="tag">${this.data.modules.length}</span></a></li>
  <li class="docs-faceted-list-item"><a href="${r}interfaces/index.html"><span class="docs-faceted-list-item-text">Interfaces</span><span class="tag docs-updated-item">${this.data.ifaces.length}</span></a></li>
  <li class="docs-faceted-list-item"><a href="${r}apis/index.html"><span class="docs-faceted-list-item-text">APIs</span><span class="tag">${this.data.httpContribs.length + this.data.cliCommands.length}</span></a></li>
  <li class="docs-faceted-list-item"><a href="${r}contributions/index.html"><span class="docs-faceted-list-item-text">Contribution Slots</span><span class="tag">${this.data.slots.length}</span></a></li>
</ul>`;
  }

  shell({ r, title, section, side, toc, body, wide = false }: ShellOptions): string {
    const defaultCtx = { key: "", title: "Overview", href: `${r}index.html`, icon: ICONS.overview };
    const contexts = [
      defaultCtx,
      { key: "kernel", title: "Kernel API", href: `${r}kernel/index.html`, icon: ICONS.kernel },
      { key: "modules", title: "Modules", href: `${r}modules/index.html`, icon: ICONS.modules },
      {
        key: "interfaces",
        title: "Interfaces",
        href: `${r}interfaces/index.html`,
        icon: ICONS.interfaces,
      },
      { key: "apis", title: "APIs", href: `${r}apis/index.html`, icon: ICONS.apis },
      {
        key: "contributions",
        title: "Contribution Slots",
        href: `${r}contributions/index.html`,
        icon: ICONS.contributions,
      },
    ];
    const curCtx = contexts.find((c) => c.key === section) ?? defaultCtx;
    const secondaryContent = side || this.overviewSidebar(r);

    return `<!doctype html>
<html lang="en" class="docs-light-mode" data-brand="frost" data-refs-root="${esc(r)}">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<script>(function(){try{var d=document.documentElement,u=new URLSearchParams(location.search),t=u.get("theme")||localStorage.getItem("refs-theme")||(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"),b=u.get("brand")||localStorage.getItem("refs-brand-v2")||"frost";d.classList.remove("docs-light-mode","docs-dark-mode");d.classList.add(t==="dark"?"docs-dark-mode":"docs-light-mode");d.dataset.theme=t;if(b==="adev")delete d.dataset.brand;else d.dataset.brand=b;if(localStorage.getItem("refs-sidebar-collapsed")==="1")d.classList.add("sidebar-collapsed");var w=localStorage.getItem("refs-sidebar-width");if(w){var s=w.endsWith("px")?w.slice(0,-2):w,n=Number(s);if(s&&Number.isInteger(n)&&n>=180&&n<=520)d.style.setProperty("--secondary-nav-width",n+"px");}}catch(e){}})();</script>
<title>${esc(title)} • PenguinHarness Docs</title>
<link rel="icon" type="image/svg+xml" href="${r}assets/penguin-logo.svg">
<link rel="stylesheet" href="${r}assets/style.css?v=${this.assetVer}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=DM+Mono:ital,wght@0,400;0,500;1,400&family=IBM+Plex+Sans:wght@400;500;600;700&family=Inter+Tight:wght@500;600&family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
</head>
<body>
<div class="adev-top-accent" aria-hidden="true"></div>
<div class="adev-shell">
  <aside class="adev-secondary-nav-mask sb-sidebar-shell" id="secondary-sidebar" aria-label="Documentation Sidebar">
    <div class="adev-secondary-resizer" id="sidebar-resizer" title="Drag to resize sidebar (double-click to reset)"></div>
    <div class="sb-sidebar-header">
      <div class="sb-top-bar">
        <a class="sb-brand-link" href="${r}index.html" title="PenguinHarness References (${esc(this.gitSha)})">
          <img src="${r}assets/penguin-logo.svg" alt="" width="22" height="22" class="penguin-logo-img">
          <span class="sb-brand-name">PenguinHarness</span>
        </a>
        <div class="docs-sidebar-toolbar-btns">
          <button type="button" class="docs-sidebar-icon-btn" id="sidebar-fold-all" title="Fold / expand all groups">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m7 20 5-5 5 5M7 4l5 5 5-5"/></svg>
          </button>
          <button type="button" class="docs-sidebar-icon-btn" id="sidebar-collapse-btn" title="Collapse sidebar (shortcut [ )">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 6l-6 6 6 6M4 4v16"/></svg>
          </button>
        </div>
      </div>
      <div class="sb-context-wrap">
        <button type="button" class="sb-context-btn" id="ctx-switcher-btn" aria-expanded="false" aria-haspopup="true">
          <span class="sb-ctx-icon">${curCtx.icon}</span>
          <span class="sb-ctx-title">${esc(curCtx.title)}</span>
          <svg class="sb-ctx-caret" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m7 15 5 5 5-5M7 9l5-5 5 5"/></svg>
        </button>
        <div class="sb-context-menu" id="ctx-switcher-menu" role="menu">
          ${contexts
            .map(
              (
                c,
              ) => `<a class="sb-ctx-option${c.key === curCtx.key ? " active" : ""}" href="${c.href}" role="menuitem">
            <span class="sb-ctx-opt-icon">${c.icon}</span>
            <span class="sb-ctx-title">${esc(c.title)}</span>
            ${c.key === curCtx.key ? `<svg class="sb-ctx-check" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M20 6 9 17l-5-5"/></svg>` : ""}
          </a>`,
            )
            .join("")}
        </div>
      </div>
      <button type="button" class="sb-search-pill" id="search-trigger" title="Search docs (Ctrl+K or /)">
        <span class="sb-search-label">${ICONS.search}<span>Quick search...</span></span>
        <span class="adev-kbd-row"><kbd>Ctrl</kbd><kbd>K</kbd></span>
      </button>
    </div>
    <div class="sb-sidebar-scroll" id="sidebar-scroll-area">
      <div class="docs-nav-secondary">${secondaryContent}</div>
    </div>
    <div class="sb-sidebar-footer">
      <a class="sb-home-link" href="https://penguin.ooo/" target="_blank" rel="noopener" title="PenguinHarness Home (penguin.ooo)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
        <span>Home</span>
        <span class="sb-ext-arr">↗</span>
      </a>
      <div class="sb-footer-right">
        <div class="sb-brand-seg" role="group" aria-label="UI Style">
          <button type="button" class="sb-seg-btn" data-set-brand="frost" title="Frost style">Frost</button>
          <button type="button" class="sb-seg-btn" data-set-brand="console" title="Console style">Console</button>
        </div>
        <button type="button" class="docs-sidebar-icon-btn" id="theme-toggle" title="Toggle light/dark theme" aria-label="Toggle light/dark theme">
          <svg class="icon-sun" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2m-7.07-14.93 1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2m-14.93 7.07 1.41-1.41m11.32-11.32 1.41-1.41"/></svg>
          <svg class="icon-moon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
        </button>
      </div>
    </div>
  </aside>
  <div class="docs-app-main-content">
    <button type="button" class="docs-sidebar-unfold-pill" id="sidebar-unfold-btn" title="Expand sidebar (shortcut [ )">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6M20 4v16"/></svg>
      <span>Sidebar · ${esc(curCtx.title)}</span>
    </button>
    <div class="docs-content-layout${wide || !toc ? " docs-content-wide" : ""}">
      <main class="docs-viewer">${body}</main>
      ${
        toc
          ? `<aside class="docs-toc" aria-label="Table of contents">
        <nav>
          <header><h2 class="docs-title">On this page</h2></header>
          <ul class="docs-faceted-list" id="toc-list">${toc}</ul>
        </nav>
        <button type="button" class="docs-back-top" id="back-to-top">${ICONS.up} Back to the top</button>
      </aside>`
          : ""
      }
    </div>
    <footer class="adev-footer-container">
      <div class="adev-footer-columns">
        <div><h2>Overview</h2><ul><li><a href="${r}index.html">Architecture Overview</a></li><li><a href="${r}kernel/index.html">@prismshadow/penguin-core/kernel</a></li><li><a href="https://penguin.ooo/" target="_blank" rel="noopener">Home Page ↗</a></li><li><a href="https://github.com/Prism-Shadow/penguin-harness/tree/${encodeURIComponent(this.gitSha)}" target="_blank" rel="noopener">Source (${esc(this.gitSha)}) ↗</a></li></ul></div>
        <div><h2>Modules</h2><ul><li><a href="${r}modules/${this.moduleByName.get("PlatformModule")?.slug ?? "platform"}/">PlatformModule</a></li><li><a href="${r}modules/${this.moduleByName.get("WebAppModule")?.slug ?? "web-app"}/">WebAppModule</a></li><li><a href="${r}modules/${this.moduleByName.get("CliCommandsModule")?.slug ?? "cli-commands"}/">CliCommandsModule</a></li><li><a href="${r}modules/index.html">All Modules (${this.data.modules.length})</a></li></ul></div>
        <div><h2>Kernel &amp; Interfaces</h2><ul><li><a href="${r}kernel/${this.kernelByName.get("Module")?.slug ?? "Module"}/">@Module</a></li><li><a href="${r}kernel/${this.kernelByName.get("Component")?.slug ?? "Component"}/">@Component</a></li><li><a href="${r}kernel/${this.kernelByName.get("Use")?.slug ?? "Use"}/">@Use &amp; @Provide</a></li><li><a href="${r}interfaces/index.html">All Interfaces (${this.data.ifaces.length})</a></li></ul></div>
        <div><h2>APIs &amp; Contribution Slots</h2><ul><li><a href="${r}apis/index.html#http">HTTP Route Groups (${this.data.httpContribs.length})</a></li><li><a href="${r}apis/index.html#cli">CLI Commands (${this.data.cliCommands.length})</a></li><li><a href="${r}contributions/index.html">Contribution Slots (${this.data.slots.length})</a></li></ul></div>
      </div>
      <p class="docs-license">Generated directly from TypeScript AST · commit ${esc(this.gitSha)} (${esc(this.data.git.shortDate)})</p>
    </footer>
  </div>
</div>
<dialog class="adev-search-dialog" id="search-dialog">
  <div class="adev-search-box">
    <div class="adev-search-head">
      ${ICONS.search}
      <input type="search" id="search-input" placeholder="Search kernel APIs, modules, components, interfaces, HTTP routes, CLI commands, slots…" autocomplete="off">
      <kbd class="adev-esc-kbd" id="search-close">ESC</kbd>
    </div>
    <div class="adev-search-results" id="search-results"></div>
  </div>
</dialog>
<script src="${r}assets/app.js?v=${this.assetVer}" defer></script>
</body></html>`;
  }
}
