#!/usr/bin/env node
/**
 * PenguinHarness Architecture & API Reference Generator (100% real AST data).
 *
 * Reads live TypeScript source files from the target PenguinHarness checkout
 * via TypeScript Compiler AST (`extract-real-data.mjs`). Includes a gold-standard
 * showcase reference for `@prismshadow/penguin-core/kernel` (all 91 exports).
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { extractAll, slugOf } from "./extract-real-data.mjs";
import { CSS as BASE_CSS } from "./theme-assets.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = process.env.PENGUIN_REFS_REPO || join(HERE, "..", "worktrees", "refs-main");
const OUT = join(HERE, "dist");
const ASSET_VER = "20261128v27";

let TWOSLASH_CSS = "";
const TWOSLASH_CSS_PATH = join(HERE, "node_modules", "@shikijs", "twoslash", "style-rich.css");
if (existsSync(TWOSLASH_CSS_PATH)) {
  TWOSLASH_CSS = readFileSync(TWOSLASH_CSS_PATH, "utf8");
}

let VERIFIED_SAMPLES = {};
const VERIFIED_PATH = join(HERE, "doc-samples", "verified-samples.json");
if (existsSync(VERIFIED_PATH)) {
  try {
    VERIFIED_SAMPLES = JSON.parse(readFileSync(VERIFIED_PATH, "utf8")).samples || {};
  } catch {}
}

const DATA = extractAll(REPO);
const GIT_SHA = DATA.git.sha || "main";
const SRC_URL = (rel, line = null) =>
  `https://github.com/Prism-Shadow/penguin-harness/blob/${GIT_SHA}/${rel}${line ? `#L${line}` : ""}`;

mkdirSync(OUT, { recursive: true });
rmSync(join(OUT, "references"), { recursive: true, force: true });
mkdirSync(join(OUT, "references", "assets"), { recursive: true });
try {
  const logoSvg = readFileSync(join(REPO, "packages/web/public/penguin-logo.svg"), "utf8");
  writeFileSync(join(OUT, "references", "assets", "penguin-logo.svg"), logoSvg);
} catch {}

const MODULES = DATA.modules;
const COMPONENTS = DATA.components;
const STANDALONE_COMPONENTS = COMPONENTS.filter((c) => !c.primaryParent);
const IFACES = DATA.ifaces;
const KERNEL = DATA.kernel;
const KERNEL_EXPORTS = KERNEL.exports;
const KERNEL_FILES = KERNEL.files;
const KERNEL_SUBSYSTEMS = KERNEL.subsystems;
const SLOTS = DATA.slots;
const HTTP_CONTRIBS = DATA.httpContribs;
const CLI_COMMANDS = DATA.cliCommands;

const trimModule = (name) =>
  name === "PlatformModule" || name === "WebAppModule" ? name : name.replace(/Module$/, "") || name;

/* ---------- Symbol Lookup Maps ---------- */

const IFACE_BY_NAME = new Map();
for (const it of IFACES) {
  if (!IFACE_BY_NAME.has(it.name)) IFACE_BY_NAME.set(it.name, it);
}
const KERNEL_BY_NAME = new Map(KERNEL_EXPORTS.map((k) => [k.name, k]));
const KERNEL_REFERENCES = new Map();
const KERNEL_REFERENCED_BY = new Map();
for (const k of KERNEL_EXPORTS) {
  KERNEL_REFERENCES.set(k.name, []);
  KERNEL_REFERENCED_BY.set(k.name, []);
}
for (const k of KERNEL_EXPORTS) {
  const seen = new Set();
  // Strip comments and string literals so prose words like "/** Module name */" never create false type references
  const codeOnly = String(k.sig || "")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g, " ");
  const tok = /\b[A-Za-z_]\w*\b/g;
  let m;
  while ((m = tok.exec(codeOnly))) {
    const w = m[0];
    if (w === k.name || !KERNEL_BY_NAME.has(w) || seen.has(w)) continue;
    // Ignore object/interface property names (e.g. `foo:` or `readonly foo?:`)
    const after = codeOnly.slice(tok.lastIndex);
    if (/^\s*\??\s*:/.test(after)) continue;
    seen.add(w);
    KERNEL_REFERENCES.get(k.name).push(KERNEL_BY_NAME.get(w));
    KERNEL_REFERENCED_BY.get(w).push(k);
  }
}
for (const list of KERNEL_REFERENCES.values()) list.sort((a, b) => a.name.localeCompare(b.name));
for (const list of KERNEL_REFERENCED_BY.values()) list.sort((a, b) => a.name.localeCompare(b.name));

/* Declarative logical groups for @prismshadow/penguin-core/kernel (zero source code movement).
 * Source JSDoc @category / @group / @internal tags take precedence when present. */
const KERNEL_GROUPS = [
  {
    id: "authoring",
    title: "Authoring",
    tier: "public",
    symbols: new Set([
      "Module", "Component", "Interface", "Use", "Provide", "Bind",
      "Slot", "Opaque", "ClassCtx", "Contributed", "Resources",
    ]),
  },
  {
    id: "assembly",
    title: "Assembly & Boot",
    tier: "public",
    symbols: new Set([
      "moduleDefOf", "bootModules", "wire", "moduleMetaOf",
      "ModuleDef", "ModuleTree", "ModuleInstance", "ModuleCtx",
      "BootModulesOptions", "ModuleBootError", "ModuleClass", "IfaceClass",
      "ModuleMeta", "ComponentMeta", "ManifestTable", "IfaceTable",
    ]),
  },
  {
    id: "low-level",
    title: "Low-level Kernel & Upgrade",
    tier: "low-level",
    files: new Set(["boot.ts", "upgrade.ts", "iface.ts", "schema.ts", "json.ts", "module.ts", "decorators.ts", "markers.ts"]),
  },
  {
    id: "verification",
    title: "Manifest & Static Verification",
    tier: "low-level",
    files: new Set(["manifest.ts", "check.ts", "sig.ts", "data.ts"]),
  },
];

function groupOfKernelExport(k) {
  const catTag = (k.docBlocks || []).find((b) => b.kind === "tag" && (b.tag === "category" || b.tag === "group"));
  if (catTag && catTag.text) {
    const match = KERNEL_GROUPS.find((g) => g.title.toLowerCase() === catTag.text.toLowerCase() || g.id === slugOf(catTag.text));
    if (match) return match;
  }
  const hasInternal = (k.docBlocks || []).some((b) => b.kind === "tag" && b.tag === "internal");
  if (!hasInternal) {
    for (const g of KERNEL_GROUPS) {
      if (g.symbols && g.symbols.has(k.name)) return g;
    }
  }
  for (const g of KERNEL_GROUPS) {
    if (g.files && g.files.has(k.sourceFile)) return g;
  }
  return KERNEL_GROUPS[2];
}

const KERNEL_GROUP_BY_NAME = new Map();
const KERNEL_BY_GROUP = new Map(KERNEL_GROUPS.map((g) => [g.id, []]));
for (const k of KERNEL_EXPORTS) {
  const g = groupOfKernelExport(k);
  KERNEL_GROUP_BY_NAME.set(k.name, g);
  KERNEL_BY_GROUP.get(g.id).push(k);
}
// Preserve explicit order inside symbol-listed groups; sort alphabetically in file-backed groups
for (const g of KERNEL_GROUPS) {
  const list = KERNEL_BY_GROUP.get(g.id);
  if (g.symbols) {
    const order = [...g.symbols];
    list.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
  } else {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }
}

function resolveTypeMembers(typeExpr) {
  const clean = String(typeExpr || "").trim().replace(/\s+/g, " ");
  // Direct interface/class lookup
  const directName = clean.replace(/<.*$/, "").replace(/\[\]$/, "").trim();
  const direct = KERNEL_BY_NAME.get(directName);
  if (direct && direct.members?.length) {
    return { typeName: direct.name, typeSlug: direct.slug, members: direct.members };
  }
  // Type alias wrapping Omit<Base, Keys> / Pick<Base, Keys> / Partial<Base> / Readonly<Base>
  const aliasSig = direct && direct.kind === "type_alias" ? direct.sig : clean;
  const omitMatch = aliasSig.match(/\bOmit\s*<\s*([A-Za-z_]\w*)\s*,\s*([^>]+)>/);
  if (omitMatch) {
    const base = KERNEL_BY_NAME.get(omitMatch[1]);
    if (base && base.members?.length) {
      const omitted = new Set([...omitMatch[2].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]));
      return {
        typeName: direct ? direct.name : omitMatch[1],
        typeSlug: direct ? direct.slug : base.slug,
        members: base.members.filter((mb) => !omitted.has(mb.name)),
      };
    }
  }
  const pickMatch = aliasSig.match(/\bPick\s*<\s*([A-Za-z_]\w*)\s*,\s*([^>]+)>/);
  if (pickMatch) {
    const base = KERNEL_BY_NAME.get(pickMatch[1]);
    if (base && base.members?.length) {
      const picked = new Set([...pickMatch[2].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]));
      return {
        typeName: direct ? direct.name : pickMatch[1],
        typeSlug: direct ? direct.slug : base.slug,
        members: base.members.filter((mb) => picked.has(mb.name)),
      };
    }
  }
  const wrapMatch = aliasSig.match(/\b(?:Partial|Readonly|Required)\s*<\s*([A-Za-z_]\w*)\s*>/);
  if (wrapMatch) {
    const base = KERNEL_BY_NAME.get(wrapMatch[1]);
    if (base && base.members?.length) {
      return {
        typeName: direct ? direct.name : base.name,
        typeSlug: direct ? direct.slug : base.slug,
        members: base.members,
      };
    }
  }
  return null;
}

function compactSig(sig) {
  const first = String(sig || "")
    .replace(/^export\s+(?:declare\s+)?/, "")
    .replace(/\s+/g, " ")
    .trim();
  return first.length > 110 ? first.slice(0, 109) + "…" : first;
}
const MODULE_BY_NAME = new Map();
for (const m of MODULES) {
  if (!MODULE_BY_NAME.has(m.name)) MODULE_BY_NAME.set(m.name, m);
}
const COMP_BY_NAME = new Map(COMPONENTS.map((c) => [c.name, c]));
const SLOT_BY_KEY = new Map(SLOTS.map((s) => [s.key, s]));
const HTTP_BY_CLS = new Map(HTTP_CONTRIBS.map((g) => [g.cls, g]));

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const KW = new Set([
  "abstract", "class", "export", "interface", "readonly", "new", "extends",
  "implements", "const", "let", "var", "function", "return", "type", "import",
  "from", "default", "async", "await", "this", "null", "undefined", "true",
  "false", "void", "never", "unknown", "any", "string", "number", "boolean",
  "object", "of", "in", "satisfies", "private", "protected", "public", "get", "set",
]);

function symbolHref(word, r, preferKernel = false) {
  if (r === null || r === undefined) return null;
  if (preferKernel && KERNEL_BY_NAME.has(word)) return `${r}kernel/${KERNEL_BY_NAME.get(word).slug}/`;
  if (IFACE_BY_NAME.has(word)) return `${r}interfaces/${IFACE_BY_NAME.get(word).slug}/`;
  if (KERNEL_BY_NAME.has(word)) return `${r}kernel/${KERNEL_BY_NAME.get(word).slug}/`;
  if (MODULE_BY_NAME.has(word)) return `${r}modules/${MODULE_BY_NAME.get(word).slug}/`;
  if (COMP_BY_NAME.has(word)) return `${r}${COMP_BY_NAME.get(word).href}`;
  return null;
}

function hl(src, r = null, preferKernel = false, currentSymbol = null) {
  const tok = /\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|@[A-Za-z_]\w*|\b[A-Za-z_]\w*\b/g;
  let out = "", last = 0, m;
  while ((m = tok.exec(src))) {
    out += esc(src.slice(last, m.index));
    const s = m[0];
    if (s.startsWith("//") || s.startsWith("/*")) {
      out += `<span class="tk-c">${esc(s)}</span>`;
    } else if (s[0] === '"' || s[0] === "'" || s[0] === "`") {
      const inner = s.slice(1, -1);
      if (r !== null && SLOT_BY_KEY.has(inner)) {
        out += `<a class="code-link" href="${r}contributions/index.html#${slugOf(inner)}"><span class="tk-s">${esc(s)}</span></a>`;
      } else {
        out += `<span class="tk-s">${esc(s)}</span>`;
      }
    } else if (s[0] === "@") {
      const base = s.slice(1);
      const href = base === currentSymbol ? null : symbolHref(base, r, true);
      out += href
        ? `<a class="code-link" href="${href}"><span class="tk-d">${esc(s)}</span></a>`
        : `<span class="tk-d">${esc(s)}</span>`;
    } else if (KW.has(s)) {
      out += `<span class="tk-k">${esc(s)}</span>`;
    } else if (/^[A-Z]/.test(s) || (preferKernel && KERNEL_BY_NAME.has(s))) {
      const href = s === currentSymbol ? null : symbolHref(s, r, preferKernel);
      out += href
        ? `<a class="code-link" href="${href}"><span class="tk-t">${esc(s)}</span></a>`
        : `<span class="tk-t">${esc(s)}</span>`;
    } else {
      out += esc(s);
    }
    last = tok.lastIndex;
  }
  return out + esc(src.slice(last));
}

const COPY_BTN = `<button type="button" docs-copy-source-code aria-label="Copy code" title="Copy code"><svg class="docs-copy" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg><svg class="docs-check" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M20 6 9 17l-5-5"/></svg></button>`;

function codeBlock(src, { file, line = null, r = null, preferKernel = false, currentSymbol = null } = {}) {
  const lines = src.split("\n").map((l) => `<span class="line">${hl(l, r, preferKernel, currentSymbol) || " "}</span>`).join("");
  const head = file
    ? `<div class="docs-code-header"><a href="${SRC_URL(file, line)}" target="_blank" rel="noopener">${esc(file)}${line ? `:${line}` : ""} ↗</a></div>`
    : "";
  return `<div class="docs-code">${head}${COPY_BTN}<pre><code>${lines}</code></pre></div>`;
}

function renderInlineDoc(text, r = "", preferKernel = false) {
  const escaped = esc(text);
  return escaped
    .replace(/\{@link\s+([^}\s]+)(?:\s+([^}]+))?\}/g, (_, sym, label) => {
      const cleanSym = sym.replace(/\(\)$/, "");
      const href = symbolHref(cleanSym, r, preferKernel);
      const shown = label || sym;
      return href ? `<a href="${href}"><code>${shown}</code></a>` : `<code>${shown}</code>`;
    })
    .replace(/`([^`]+)`/g, (_, code) => {
      const cleanSym = code.replace(/^@/, "").replace(/\(\)$/, "");
      const isSimple = /^@?[A-Za-z_][A-Za-z0-9_]*(\(\))?$/.test(code);
      const href = isSimple ? symbolHref(cleanSym, r, preferKernel || code.startsWith("@")) : null;
      return href ? `<a href="${href}"><code>${code}</code></a>` : `<code>${code}</code>`;
    });
}

function renderDocBlocks(blocks, r = "", preferKernel = false) {
  if (!blocks || !blocks.length) return "";
  return blocks
    .map((b) => {
      if (b.kind === "p") return `<p>${renderInlineDoc(b.text, r, preferKernel)}</p>`;
      if (b.kind === "ul") {
        return `<ul class="docs-doc-list">${b.items.map((it) => `<li>${renderInlineDoc(it, r, preferKernel)}</li>`).join("")}</ul>`;
      }
      if (b.kind === "code") return codeBlock(b.code, { r, preferKernel });
      if (b.kind === "tag") {
        return `<div class="docs-param-group"><span class="docs-param-keyword">@${esc(b.tag)}</span><span>${renderInlineDoc(b.text, r, preferKernel)}</span></div>`;
      }
      return "";
    })
    .join("\n");
}

const para = (lines, r = "", preferKernel = false) =>
  lines.map((l) => `<p>${renderInlineDoc(l, r, preferKernel)}</p>`).join("\n");

function linkifyType(typeStr, r, preferKernel = false) {
  const base = String(typeStr).replace(/[<[\s|&?].*$/, "");
  const href = symbolHref(base, r, preferKernel);
  return href ? `<a href="${href}"><code>${esc(typeStr)}</code></a>` : `<code>${esc(typeStr)}</code>`;
}

function apiLabel(typeKey, letter, fullText = null) {
  return fullText
    ? `<span class="docs-api-item-label type-${typeKey} full">${esc(fullText)}</span>`
    : `<span class="docs-api-item-label type-${typeKey}" aria-hidden="true">${esc(letter)}</span>`;
}

function kernelBadgeMeta(kind) {
  if (kind === "decorator") return { tKey: "decorator", ch: "@", label: "decorator" };
  if (kind === "function") return { tKey: "function", ch: "F", label: "function" };
  if (kind === "class") return { tKey: "class", ch: "C", label: "class" };
  if (kind === "interface") return { tKey: "interface", ch: "I", label: "interface" };
  return { tKey: "type_alias", ch: "T", label: "type-alias" };
}

/* ---------- Real Contract Topology & Node Wiring ---------- */

function ifaceWiringSection(ifaceName, r) {
  const exportedBy = MODULES.filter((m) => m.exports.includes(ifaceName));
  const providedBy = [];
  const consumedBy = [];

  for (const node of [...MODULES, ...COMPONENTS]) {
    const href = node.kind === "module" ? `${r}modules/${node.slug}/` : `${r}${node.href}`;
    const providesMatch =
      node.provides.some((p) => p.type.replace(/[<[\s|&?].*$/, "") === ifaceName) ||
      (node.implements || []).includes(ifaceName);
    if (providesMatch) providedBy.push({ name: node.name, href });
    const usesMatch = node.uses.some((u) => u.type.replace(/[<[\s|&?].*$/, "") === ifaceName);
    if (usesMatch) consumedBy.push({ name: node.name, href });
  }

  if (!exportedBy.length && !providedBy.length && !consumedBy.length) return "";
  const linkList = (list) =>
    list.map((x) => `<a class="docs-wiring-chip" href="${x.href}">${esc(x.name)}</a>`).join("");

  return `<section class="docs-wiring-box" id="wiring">
  <div class="docs-wiring-head">
    <h2 class="docs-reference-section-heading"><a class="docs-anchor" href="#wiring">Contract Topology</a></h2>
    <span class="docs-wiring-sub">Static AST wiring across @Module / @Provide / @Use</span>
  </div>
  <div class="docs-wiring-grid">
    ${exportedBy.length ? `<div class="docs-wiring-row"><span class="docs-param-keyword">@Module</span><span class="docs-wiring-role">exported by</span><div class="docs-wiring-chips">${exportedBy.map((m) => `<a class="docs-wiring-chip" href="${r}modules/${m.slug}/">${esc(m.name)}</a>`).join("")}</div></div>` : ""}
    ${providedBy.length ? `<div class="docs-wiring-row"><span class="docs-param-keyword">@Provide</span><span class="docs-wiring-role">provided by</span><div class="docs-wiring-chips">${linkList(providedBy)}</div></div>` : ""}
    ${consumedBy.length ? `<div class="docs-wiring-row"><span class="docs-param-keyword">@Use</span><span class="docs-wiring-role">consumed by (${consumedBy.length})</span><div class="docs-wiring-chips">${linkList(consumedBy)}</div></div>` : ""}
  </div>
</section>`;
}

function nodeWiringChips(node, r) {
  const parts = [];
  if (node.uses.length) {
    parts.push(`<div class="docs-param-group"><span class="docs-param-keyword">@Use</span><span class="docs-param-name">requires</span>${node.uses.map((u) => linkifyType(u.type, r)).join(" ")}</div>`);
  }
  if (node.provides.length) {
    parts.push(`<div class="docs-param-group"><span class="docs-param-keyword">@Provide</span><span class="docs-param-name">provides</span>${node.provides.map((p) => linkifyType(p.type, r)).join(" ")}</div>`);
  }
  if (node.binds.length) {
    parts.push(`<div class="docs-param-group"><span class="docs-param-keyword">@Bind</span><span class="docs-param-name">slot</span>${node.binds.map((b) => `<code>${esc(b.id)}</code>`).join(" ")}</div>`);
  }
  const slotKeys = Object.keys(node.contributes || {});
  if (slotKeys.length) {
    parts.push(`<div class="docs-param-group"><span class="docs-param-keyword">@contributes</span><span class="docs-param-name">slots</span>${slotKeys.map((sk) => `<a href="${r}contributions/index.html#${slugOf(sk)}"><code>${esc(sk)}</code></a>`).join(" ")}</div>`);
  }
  return parts.join("");
}

function nodeWiringBlocks(node, r) {
  const rows = [];
  if (node.implements?.length) {
    rows.push(`<div class="docs-wiring-row"><span class="docs-param-keyword">implements</span><span class="docs-wiring-role">interfaces</span><div class="docs-wiring-chips">${node.implements.map((x) => linkifyType(x, r)).join(" ")}</div></div>`);
  }
  if (node.uses.length) {
    rows.push(`<div class="docs-wiring-row"><span class="docs-param-keyword">@Use</span><span class="docs-wiring-role">requires (${node.uses.length})</span><div class="docs-wiring-chips">${node.uses.map((u) => `<code>${esc(u.field)}</code>: ${linkifyType(u.type, r)}${u.from ? ` <span class="muted">from ${linkifyType(u.from, r)}</span>` : ""}`).join(" · ")}</div></div>`);
  }
  if (node.provides.length) {
    rows.push(`<div class="docs-wiring-row"><span class="docs-param-keyword">@Provide</span><span class="docs-wiring-role">provides (${node.provides.length})</span><div class="docs-wiring-chips">${node.provides.map((p) => `<code>${esc(p.field)}</code>: ${linkifyType(p.type, r)}`).join(" · ")}</div></div>`);
  }
  if (node.binds.length) {
    rows.push(`<div class="docs-wiring-row"><span class="docs-param-keyword">@Bind</span><span class="docs-wiring-role">binds (${node.binds.length})</span><div class="docs-wiring-chips">${node.binds.map((b) => `<code>${esc(b.field)}</code> → <code>${esc(b.id)}</code>: ${linkifyType(b.type, r)}`).join(" · ")}</div></div>`);
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

/* ---------- Icons ---------- */

const ICONS = {
  overview: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h5v-6h4v6h5V9.5"/></svg>`,
  kernel: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polygon points="12 2 21 7 21 17 12 22 3 17 3 7 12 2"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>`,
  modules: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>`,
  interfaces: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 5H5v14h3M16 5h3v14h-3M10 9l-2 3 2 3M14 9l2 3-2 3"/></svg>`,
  apis: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 17l6-5-6-5M12 19h8"/></svg>`,
  contributions: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="12" cy="18" r="3"/><path d="M8.5 7.5 11 15.5M15.5 7.5 13 15.5"/></svg>`,
  search: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>`,
  code: `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M9.4 16.6 4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0 4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z"/></svg>`,
  up: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8-8 8z"/></svg>`,
};

/* ---------- Shell ---------- */

function overviewSidebar(r) {
  const pmSlug = MODULE_BY_NAME.get("PlatformModule")?.slug || "platform";
  const webSlug = MODULE_BY_NAME.get("WebAppModule")?.slug || "web-app";
  const cliSlug = MODULE_BY_NAME.get("CliCommandsModule")?.slug || "cli-commands";
  return `<div class="docs-secondary-nav-header">Introduction</div>
<ul class="docs-navigation-list docs-faceted-list">
  <li class="docs-faceted-list-item"><a class="docs-faceted-list-item-active" href="${r}index.html"><span class="docs-faceted-list-item-text">Architecture Overview</span></a></li>
  <li class="docs-faceted-list-item"><a href="${r}kernel/index.html"><span class="docs-faceted-list-item-text">penguin-core/kernel</span><span class="tag docs-new-item">Showcase</span></a></li>
  <li class="docs-faceted-list-item"><a href="${r}modules/${pmSlug}/"><span class="docs-faceted-list-item-text">PlatformModule</span><span class="tag docs-updated-item">Root</span></a></li>
  <li class="docs-faceted-list-item"><a href="${r}modules/${webSlug}/"><span class="docs-faceted-list-item-text">WebAppModule</span><span class="tag">Web</span></a></li>
  <li class="docs-faceted-list-item"><a href="${r}modules/${cliSlug}/"><span class="docs-faceted-list-item-text">CliCommandsModule</span><span class="tag">CLI</span></a></li>
</ul>
<div class="docs-secondary-nav-header">Reference Surfaces</div>
<ul class="docs-navigation-list docs-faceted-list">
  <li class="docs-faceted-list-item"><a href="${r}kernel/index.html"><span class="docs-faceted-list-item-text">Kernel API</span><span class="tag docs-new-item">${KERNEL_EXPORTS.length}</span></a></li>
  <li class="docs-faceted-list-item"><a href="${r}modules/index.html"><span class="docs-faceted-list-item-text">Modules</span><span class="tag">${MODULES.length}</span></a></li>
  <li class="docs-faceted-list-item"><a href="${r}interfaces/index.html"><span class="docs-faceted-list-item-text">Interfaces</span><span class="tag docs-updated-item">${IFACES.length}</span></a></li>
  <li class="docs-faceted-list-item"><a href="${r}apis/index.html"><span class="docs-faceted-list-item-text">APIs</span><span class="tag">${HTTP_CONTRIBS.length + CLI_COMMANDS.length}</span></a></li>
  <li class="docs-faceted-list-item"><a href="${r}contributions/index.html"><span class="docs-faceted-list-item-text">Contribution Slots</span><span class="tag">${SLOTS.length}</span></a></li>
</ul>`;
}

function shell({ r, title, section, side, toc, body, wide = false }) {
  const contexts = [
    { key: "", title: "Overview", href: `${r}index.html`, icon: ICONS.overview },
    { key: "kernel", title: "Kernel API", href: `${r}kernel/index.html`, icon: ICONS.kernel },
    { key: "modules", title: "Modules", href: `${r}modules/index.html`, icon: ICONS.modules },
    { key: "interfaces", title: "Interfaces", href: `${r}interfaces/index.html`, icon: ICONS.interfaces },
    { key: "apis", title: "APIs", href: `${r}apis/index.html`, icon: ICONS.apis },
    { key: "contributions", title: "Contribution Slots", href: `${r}contributions/index.html`, icon: ICONS.contributions },
  ];
  const curCtx = contexts.find((c) => c.key === section) || contexts[0];
  const secondaryContent = side || overviewSidebar(r);
  return `<!doctype html>
<html lang="en" class="docs-light-mode" data-brand="frost">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<script>(function(){try{var d=document.documentElement,u=new URLSearchParams(location.search),t=u.get("theme")||localStorage.getItem("refs-theme")||(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"),b=u.get("brand")||localStorage.getItem("refs-brand-v2")||"frost";d.classList.remove("docs-light-mode","docs-dark-mode");d.classList.add(t==="dark"?"docs-dark-mode":"docs-light-mode");d.dataset.theme=t;if(b==="adev")delete d.dataset.brand;else d.dataset.brand=b;if(localStorage.getItem("refs-sidebar-collapsed")==="1")d.classList.add("sidebar-collapsed");var w=localStorage.getItem("refs-sidebar-width");if(w)d.style.setProperty("--secondary-nav-width",w);}catch(e){}})();</script>
<title>${esc(title)} • PenguinHarness Docs</title>
<link rel="icon" type="image/svg+xml" href="${r}assets/penguin-logo.svg">
<link rel="stylesheet" href="${r}assets/style.css?v=${ASSET_VER}">
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
        <a class="sb-brand-link" href="${r}index.html" title="PenguinHarness References (${esc(GIT_SHA)})">
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
          ${contexts.map((c) => `<a class="sb-ctx-option${c.key === curCtx.key ? " active" : ""}" href="${c.href}" role="menuitem">
            <span class="sb-ctx-opt-icon">${c.icon}</span>
            <span class="sb-ctx-title">${esc(c.title)}</span>
            ${c.key === curCtx.key ? `<svg class="sb-ctx-check" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M20 6 9 17l-5-5"/></svg>` : ""}
          </a>`).join("")}
        </div>
      </div>

      <button type="button" class="sb-search-pill" id="search-trigger" title="Search docs (Ctrl+K or /)">
        <span class="sb-search-label">${ICONS.search}<span>Quick search...</span></span>
        <span class="adev-kbd-row"><kbd>Ctrl</kbd><kbd>K</kbd></span>
      </button>
    </div>

    <div class="sb-sidebar-scroll" id="sidebar-scroll-area">
      <div class="docs-nav-secondary">
        ${secondaryContent}
      </div>
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
      <main class="docs-viewer">
        ${body}
      </main>
      ${toc ? `<aside class="docs-toc" aria-label="Table of contents">
        <nav>
          <header><h2 class="docs-title">On this page</h2></header>
          <ul class="docs-faceted-list" id="toc-list">${toc}</ul>
        </nav>
        <button type="button" class="docs-back-top" onclick="window.scrollTo({top:0,behavior:'smooth'})">${ICONS.up} Back to the top</button>
      </aside>` : ""}
    </div>
    <footer class="adev-footer-container">
      <div class="adev-footer-columns">
        <div><h2>Overview</h2><ul><li><a href="${r}index.html">Architecture Overview</a></li><li><a href="${r}kernel/index.html">@prismshadow/penguin-core/kernel</a></li><li><a href="https://penguin.ooo/" target="_blank" rel="noopener">Home Page ↗</a></li><li><a href="https://github.com/Prism-Shadow/penguin-harness/tree/${esc(GIT_SHA)}" target="_blank" rel="noopener">Source (${esc(GIT_SHA)}) ↗</a></li></ul></div>
        <div><h2>Modules</h2><ul><li><a href="${r}modules/${MODULE_BY_NAME.get("PlatformModule")?.slug || "platform"}/">PlatformModule</a></li><li><a href="${r}modules/${MODULE_BY_NAME.get("WebAppModule")?.slug || "web-app"}/">WebAppModule</a></li><li><a href="${r}modules/${MODULE_BY_NAME.get("CliCommandsModule")?.slug || "cli-commands"}/">CliCommandsModule</a></li><li><a href="${r}modules/index.html">All Modules (${MODULES.length})</a></li></ul></div>
        <div><h2>Kernel &amp; Interfaces</h2><ul><li><a href="${r}kernel/${KERNEL_BY_NAME.get("Module")?.slug || "module"}/">@Module</a></li><li><a href="${r}kernel/${KERNEL_BY_NAME.get("Component")?.slug || "component"}/">@Component</a></li><li><a href="${r}kernel/${KERNEL_BY_NAME.get("Use")?.slug || "use"}/">@Use &amp; @Provide</a></li><li><a href="${r}interfaces/index.html">All Interfaces (${IFACES.length})</a></li></ul></div>
        <div><h2>APIs &amp; Contribution Slots</h2><ul><li><a href="${r}apis/index.html#http">HTTP Route Groups (${HTTP_CONTRIBS.length})</a></li><li><a href="${r}apis/index.html#cli">CLI Commands (${CLI_COMMANDS.length})</a></li><li><a href="${r}contributions/index.html">Contribution Slots (${SLOTS.length})</a></li></ul></div>
      </div>
      <p class="docs-license">Generated directly from TypeScript AST · commit ${esc(GIT_SHA)} (${esc(DATA.git.date.slice(0, 10))})</p>
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
<script>window.__REFS_ROOT__=${JSON.stringify(r)};</script>
<script src="${r}assets/app.js?v=${ASSET_VER}" defer></script>
</body></html>`;
}

function parseSigParts(sig) {
  const m = sig.match(/^([A-Za-z0-9_$]+)(\??)\s*(?:<[^>]+>)?\s*\(([\s\S]*)\)\s*:\s*([\s\S]+)$/);
  if (!m) {
    const f = sig.match(/^(?:readonly\s+)?([A-Za-z0-9_$]+)(\??)\s*:\s*([\s\S]+)$/);
    if (f) return { name: f[1] + f[2], params: [], ret: f[3].trim(), isMethod: false };
    return { name: sig.split(/[(\s:<]/)[0] || "member", params: [], ret: "", isMethod: false };
  }
  const rawParams = m[3].trim();
  const params = [];
  if (rawParams) {
    let depth = 0, cur = "";
    for (const ch of rawParams) {
      if (ch === "<" || ch === "(" || ch === "{" || ch === "[") depth++;
      else if (ch === ">" || ch === ")" || ch === "}" || ch === "]") depth--;
      if (ch === "," && depth === 0) { params.push(cur.trim()); cur = ""; }
      else cur += ch;
    }
    if (cur.trim()) params.push(cur.trim());
  }
  return { name: m[1] + m[2], params, ret: m[4].trim(), isMethod: true };
}

function lookupVerifiedSample(ownerTypeName, memberName) {
  if (!ownerTypeName || !memberName) return null;
  const direct = VERIFIED_SAMPLES[`${ownerTypeName}.${memberName}`];
  if (direct) return direct;
  if (ownerTypeName === "ComponentMeta") {
    const inherited = VERIFIED_SAMPLES[`ModuleMeta.${memberName}`];
    if (inherited) return inherited;
  }
  return null;
}

function renderRichSampleBlock(sample, r, currentSymbol = null) {
  const failBanner = sample.verified === false
    ? `<div class="docs-sample-fail"><div class="docs-sample-fail-head"><strong>⚠ Sample failing</strong><code>${esc(sample.testFile)}:${sample.line}</code></div>${sample.error ? `<pre>${esc(sample.error)}</pre>` : ""}</div>`
    : "";

  if (!sample.html) {
    return `${failBanner}${codeBlock(sample.code, { r, preferKernel: true, currentSymbol })}`;
  }

  // Rewrite kernel placeholder hrefs to relative paths and strip self-links on currentSymbol
  let html = sample.html.replaceAll("__KERNEL_ROOT__", `${r}kernel/`);
  if (currentSymbol) {
    const selfRe = new RegExp(
      `<a class="twoslash-ref-link" href="${r.replace(/\./g, "\\.")}kernel/${currentSymbol}/" data-k-sym="${currentSymbol}">([\\s\\S]*?)</a>`,
      "g",
    );
    html = html.replace(selfRe, "$1");
  }
  const cleanCopy = String(sample.code || "").replace(/\s*\/\/\s*\[!code\s+[^\]]+\]/g, "");
  return `${failBanner}<div class="docs-code docs-twoslash" data-copy-code="${esc(cleanCopy)}">${COPY_BTN}${html}</div>`;
}

const memberSection = (m, r, preferKernel = false, ownerTypeName = null, currentSymbol = null) => {
  const rawName = m.name || m.sig.split(/[(\s:<]/)[0] || "member";
  const id = slugOf(rawName);
  const parts = parseSigParts(m.sig);
  const sample = lookupVerifiedSample(ownerTypeName, rawName);
  const paramRows = parts.params.map((p) => {
    const idx = p.indexOf(":");
    if (idx === -1) return `<div class="docs-param-group"><span class="docs-param-keyword">@param</span><span class="docs-param-name">${esc(p)}</span></div>`;
    const pName = p.slice(0, idx).trim();
    const pType = p.slice(idx + 1).trim();
    return `<div class="docs-param-group"><span class="docs-param-keyword">@param</span><span class="docs-param-name">${esc(pName)}</span><code class="docs-param-type">${hl(pType, r, preferKernel, currentSymbol)}</code></div>`;
  }).join("");
  // Only show @returns for methods; properties already display their full type in the card header
  const retRow = parts.isMethod && parts.ret
    ? `<div class="docs-return-type"><span class="docs-param-keyword">@returns</span><code>${hl(parts.ret, r, preferKernel, currentSymbol)}</code></div>`
    : "";
  const docHtml = m.docBlocks?.length
    ? `<div class="docs-function-definition">${renderDocBlocks(m.docBlocks, r, preferKernel)}</div>`
    : m.doc?.length
      ? `<div class="docs-function-definition">${para(m.doc, r, preferKernel)}</div>`
      : sample?.doc
        ? `<div class="docs-function-definition"><p>${renderInlineDoc(sample.doc, r, preferKernel)}</p></div>`
        : "";
  const sampleHtml = sample
    ? `<div class="docs-sample-wrap">${renderRichSampleBlock(sample, r, currentSymbol)}</div>`
    : "";
  const hasBody = Boolean(docHtml || paramRows || retRow || sampleHtml);
  return `<div class="docs-reference-member-card" id="${esc(id)}">
  <header class="docs-reference-card-header">
    <h3><a class="docs-anchor" href="#${esc(id)}">${esc(rawName)}</a></h3>
    <div class="docs-card-sig"><code>${hl(m.sig, r, preferKernel, currentSymbol)}</code></div>
  </header>${hasBody ? `
  <div class="docs-reference-card-body">
    <div class="docs-reference-card-item">
      ${docHtml}
      ${paramRows}
      ${retRow}
      ${sampleHtml}
    </div>
  </div>` : ""}
</div>`;
};

const GLOBE_SVG = `<svg class="docs-what-is-angular-svg" width="260" height="220" viewBox="0 0 260 220" fill="none" aria-hidden="true">
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

/* ================================================================== */
/* Pure API Reference: @prismshadow/penguin-core/kernel                */
/* ================================================================== */

function kernelSidebar(p, activeSlug = "") {
  const backHeader = activeSlug
    ? `<a class="docs-secondary-back" href="${p}index.html">← @prismshadow/penguin-core/kernel</a>`
    : "";
  const groupsHtml = KERNEL_GROUPS.map((g) => {
    const items = KERNEL_BY_GROUP.get(g.id) || [];
    if (!items.length) return "";
    const containsActive = activeSlug && items.some((e) => e.slug === activeSlug);
    const foldedCls = g.tier === "low-level" && !containsActive ? " folded" : "";
    return `<div class="docs-secondary-nav-header${foldedCls}">${esc(g.title)}</div>
<ul class="docs-navigation-list docs-faceted-list">${items
      .map((e) => {
        const isAct = e.slug === activeSlug;
        const label = e.kind === "decorator" ? `@${e.name}` : e.name;
        return `<li class="docs-faceted-list-item"><a href="${p}${e.slug}/"${isAct ? ' class="docs-faceted-list-item-active"' : ""}><span class="docs-faceted-list-item-text">${esc(label)}</span></a></li>`;
      })
      .join("")}</ul>`;
  }).join("");

  return backHeader + groupsHtml;
}

function kernelOverviewPage() {
  const r = "../";
  const countByKind = (k) => KERNEL_EXPORTS.filter((e) => e.kind === k).length;
  const publicCount = KERNEL_GROUPS.filter((g) => g.tier === "public").reduce((n, g) => n + (KERNEL_BY_GROUP.get(g.id)?.length || 0), 0);
  const lowLevelCount = KERNEL_EXPORTS.length - publicCount;

  const renderRows = (items) => items.map((e) => {
    const bm = kernelBadgeMeta(e.kind);
    const summary = e.doc[0] ? e.doc[0].slice(0, 140) + (e.doc[0].length > 140 ? "…" : "") : "";
    const sigPreview = compactSig(e.sig);
    return `<a class="kernel-api-row" href="${e.slug}/" data-item-type="${e.kind}" data-item-name="${esc((e.name + " " + e.sourceFile + " " + summary + " " + sigPreview).toLowerCase())}">
      <div class="kernel-api-row-left">
        ${apiLabel(bm.tKey, bm.ch)}
        <span class="kernel-api-name">${e.kind === "decorator" ? "@" : ""}${esc(e.name)}</span>
        ${e.isTypeOnly ? '<span class="kernel-type-pill">type</span>' : ""}
      </div>
      <div class="kernel-api-row-desc">${summary ? renderInlineDoc(summary, r, true) : `<code class="kernel-api-sig">${hl(sigPreview, null, true)}</code>`}</div>
      <div class="kernel-api-row-meta"><code>${esc(e.sourceFile)}:${e.line}</code></div>
    </a>`;
  }).join("");

  const catalogSections = KERNEL_GROUPS.map((g) => {
    const items = KERNEL_BY_GROUP.get(g.id) || [];
    if (!items.length) return "";
    if (g.tier === "low-level") {
      return `<section class="adev-api-items-section" data-section-group data-section-tier="low-level" id="group-${g.id}">
  <details class="kernel-group-details">
    <summary class="kernel-group-summary">
      <span class="kernel-group-summary-title">${esc(g.title)}</span>
      <span class="kernel-type-pill">low-level</span>
      <span class="kernel-file-meta">${items.length} exports</span>
    </summary>
    <div class="kernel-catalog-list">${renderRows(items)}</div>
  </details>
</section>`;
    }
    return `<section class="adev-api-items-section" data-section-group data-section-tier="public" id="group-${g.id}">
  <header class="adev-api-items-section-header">
    <h3><a class="adev-api-anchor" href="#group-${g.id}">${esc(g.title)}</a> <span class="kernel-file-meta">(${items.length})</span></h3>
  </header>
  <div class="kernel-catalog-list">${renderRows(items)}</div>
</section>`;
  }).join("\n");

  const body = `
<header class="docs-reference-header">
  <span class="docs-reference-category">packages/core/src/kernel/index.ts · ${publicCount} core · ${lowLevelCount} low-level · commit ${esc(GIT_SHA)}</span>
  <div class="docs-reference-title">
    <div>
      <h1>@prismshadow/penguin-core/kernel</h1>
    </div>
    <a class="docs-github-links" target="_blank" rel="noopener" href="${SRC_URL("packages/core/src/kernel/index.ts")}" title="View packages/core/src/kernel/index.ts" aria-label="View source">${ICONS.code}</a>
  </div>
  <div class="kernel-import-bar">
    <span class="kernel-import-label">IMPORT</span>
    <code>${hl('import { ... } from "@prismshadow/penguin-core/kernel";', null, true)}</code>
    ${COPY_BTN}
  </div>
</header>
<div class="adev-reference-list-filter">
  <div class="adev-reference-list-query-filter">
    <div class="docs-text-field-wrap">
      ${ICONS.search}
      <input type="search" class="docs-text-field" data-filter-input placeholder="Filter all ${KERNEL_EXPORTS.length} symbols by name, signature, or description..." autocomplete="off">
    </div>
    <div class="kernel-tier-toggle" role="group" aria-label="Visibility">
      <button type="button" class="kernel-tier-btn active" data-tier-btn="public">Core (${publicCount})</button>
      <button type="button" class="kernel-tier-btn" data-tier-btn="all">All (${KERNEL_EXPORTS.length})</button>
    </div>
  </div>
  <p class="adev-reference-list-type-filter-label">Filter by Identifier type</p>
  <ul class="adev-reference-list-type-filter">
    <li class="adev-reference-list-type-filter-item adev-reference-list-type-filter-item-active" data-filter-type="all">${apiLabel("block", "B")}<span>All</span></li>
    <li class="adev-reference-list-type-filter-item" data-filter-type="decorator">${apiLabel("decorator", "@")}<span class="docs-api-item-label-full">Decorator (${countByKind("decorator")})</span></li>
    <li class="adev-reference-list-type-filter-item" data-filter-type="function">${apiLabel("function", "F")}<span class="docs-api-item-label-full">Function (${countByKind("function")})</span></li>
    <li class="adev-reference-list-type-filter-item" data-filter-type="class">${apiLabel("class", "C")}<span class="docs-api-item-label-full">Class (${countByKind("class")})</span></li>
    <li class="adev-reference-list-type-filter-item" data-filter-type="interface">${apiLabel("interface", "I")}<span class="docs-api-item-label-full">Interface (${countByKind("interface")})</span></li>
    <li class="adev-reference-list-type-filter-item" data-filter-type="type_alias">${apiLabel("type_alias", "T")}<span class="docs-api-item-label-full">Type Alias (${countByKind("type_alias")})</span></li>
  </ul>
</div>
${catalogSections}`;

  return shell({ r, title: "@prismshadow/penguin-core/kernel", section: "kernel", side: kernelSidebar("", ""), body, wide: true });
}

function kernelSymbolPage(k) {
  const r = "../../";
  const bm = kernelBadgeMeta(k.kind);
  const group = KERNEL_GROUP_BY_NAME.get(k.name) || KERNEL_GROUPS[0];
  const siblings = (KERNEL_BY_GROUP.get(group.id) || []).filter((e) => e.name !== k.name);
  const refsOut = KERNEL_REFERENCES.get(k.name) || [];
  const refsIn = KERNEL_REFERENCED_BY.get(k.name) || [];

  // Pull @param and @returns tags onto structured parameter/return cards so they aren't duplicated in body prose
  const paramDocMap = new Map();
  let returnDoc = "";
  const bodyDocBlocks = [];
  for (const b of k.docBlocks) {
    if (b.kind === "tag" && b.tag === "param") {
      const m = b.text.match(/^(\[?[\w.$]+\]?)\s*(?:-\s*)?([\s\S]*)$/);
      if (m) {
        const pKey = m[1].replace(/^\[|\]$/g, "").split(".")[0];
        if (k.params.some((p) => p.name === pKey)) {
          paramDocMap.set(pKey, m[2].trim());
          continue;
        }
      }
    } else if (b.kind === "tag" && (b.tag === "returns" || b.tag === "return") && k.returnType) {
      returnDoc = b.text;
      continue;
    } else if (b.kind === "tag" && (b.tag === "category" || b.tag === "group" || b.tag === "internal" || b.tag === "publicApi")) {
      continue;
    }
    bodyDocBlocks.push(b);
  }

  // Expand options interfaces inline for decorators & functions (Angular @Component/@NgModule style)
  let expandedOptions = null;
  if (k.kind === "decorator" || k.kind === "function") {
    for (const p of k.params) {
      const isOptParam = k.kind === "decorator" || /^(opts|options|meta|config|cfg)$/i.test(p.name) || /(Options|Meta|Config)\b/.test(p.type);
      if (!isOptParam) continue;
      const resolved = resolveTypeMembers(p.type);
      if (resolved && resolved.members.length) {
        expandedOptions = { paramName: p.name, defaultVal: p.defaultVal || "", ...resolved };
        break;
      }
    }
  }

  const optionsMetaParts = [`<a href="../${expandedOptions?.typeSlug}/"><code>${esc(expandedOptions?.typeName || "")}</code></a>`];
  if (expandedOptions?.defaultVal) optionsMetaParts.push(`default <code>${esc(expandedOptions.defaultVal)}</code>`);

  const optionsHtml = expandedOptions
    ? `<h2 id="options" class="docs-reference-section-heading"><a class="docs-anchor" href="#options">Options</a> <span class="kernel-file-meta">${optionsMetaParts.join(" · ")}</span></h2>
<div class="docs-reference-members">${expandedOptions.members.map((mb) => memberSection(mb, r, true, expandedOptions.typeName, k.name)).join("")}</div>`
    : "";

  // If a decorator's sole parameter was already expanded into Options, don't duplicate a redundant Parameters section
  const skipParamsForDecorator = k.kind === "decorator" && expandedOptions && k.params.length === 1 && !k.returnType;
  const hasParamsSection = !skipParamsForDecorator && (k.params.length > 0 || Boolean(k.returnType));
  const paramsHeading = k.params.length && k.returnType ? "Parameters &amp; Return" : k.params.length ? "Parameters" : "Return Type";

  const paramsHtml = !hasParamsSection
    ? ""
    : k.params.length
      ? `<h2 id="parameters" class="docs-reference-section-heading"><a class="docs-anchor" href="#parameters">${paramsHeading}</a></h2>
<div class="docs-reference-members">
${k.params.map((p) => {
  const pDesc = paramDocMap.get(p.name) || "";
  const hasBody = Boolean(p.defaultVal || pDesc);
  return `<div class="docs-reference-member-card" id="param-${slugOf(p.name)}">
  <header class="docs-reference-card-header">
    <h3><code>${esc(p.name)}${p.optional ? "?" : ""}</code></h3>
    <div class="docs-card-sig"><code>${hl(p.type, r, true, k.name)}</code></div>
  </header>${hasBody ? `
  <div class="docs-reference-card-body"><div class="docs-reference-card-item">
    ${pDesc ? `<div class="docs-function-definition"><p>${renderInlineDoc(pDesc, r, true)}</p></div>` : ""}
    ${p.defaultVal ? `<div class="docs-param-group"><span class="docs-param-keyword">default</span><code>${hl(p.defaultVal, r, true, k.name)}</code></div>` : ""}
  </div></div>` : ""}
</div>`;
}).join("")}
${k.returnType ? `<div class="docs-reference-member-card" id="returns">
  <header class="docs-reference-card-header">
    <h3>@returns</h3>
    <div class="docs-card-sig"><code>${hl(k.returnType, r, true, k.name)}</code></div>
  </header>${returnDoc ? `
  <div class="docs-reference-card-body"><div class="docs-reference-card-item"><div class="docs-function-definition"><p>${renderInlineDoc(returnDoc, r, true)}</p></div></div></div>` : ""}
</div>` : ""}
</div>`
      : `<h2 id="returns" class="docs-reference-section-heading"><a class="docs-anchor" href="#returns">Return Type</a></h2><p><code>${hl(k.returnType, r, true, k.name)}</code></p>${returnDoc ? `<p>${renderInlineDoc(returnDoc, r, true)}</p>` : ""}`;

  // Also resolve members for utility type aliases like ComponentMeta = Omit<ModuleMeta, "children">
  const ownMembers = k.members.length
    ? k.members
    : k.kind === "type_alias"
      ? (resolveTypeMembers(k.name)?.members || [])
      : [];

  const membersHtml = ownMembers.length
    ? `<h2 id="members" class="docs-reference-section-heading"><a class="docs-anchor" href="#members">Members (${ownMembers.length})</a></h2>
<div class="docs-reference-members">${ownMembers.map((mb) => memberSection(mb, r, true, k.name, k.name)).join("")}</div>`
    : "";

  const variantsHtml = k.variants.length
    ? `<h2 id="variants" class="docs-reference-section-heading"><a class="docs-anchor" href="#variants">Union Variants (${k.variants.length})</a></h2>
<div class="docs-reference-members">
${k.variants.map((v, idx) => `<div class="docs-reference-member-card" id="variant-${idx + 1}">
  <header class="docs-reference-card-header">
    <h3><a class="docs-anchor" href="#variant-${idx + 1}">Variant ${idx + 1}</a></h3>
    <div class="docs-card-sig"><code>${hl(v.type, r, true, k.name)}</code></div>
  </header>${v.docBlocks?.length ? `
  <div class="docs-reference-card-body"><div class="docs-reference-card-item"><div class="docs-function-definition">${renderDocBlocks(v.docBlocks, r, true)}</div></div></div>` : ""}
</div>`).join("")}
</div>`
    : "";

  const xrefsHtml = (refsOut.length || refsIn.length)
    ? `<section class="docs-wiring-box" id="xrefs">
  <div class="docs-wiring-head">
    <h2 class="docs-reference-section-heading"><a class="docs-anchor" href="#xrefs">Type Cross-References</a></h2>
    <span class="docs-wiring-sub">Static signature graph within @prismshadow/penguin-core/kernel</span>
  </div>
  <div class="docs-wiring-grid">
    ${refsOut.length ? `<div class="docs-wiring-row"><span class="docs-param-keyword">references</span><span class="docs-wiring-role">${refsOut.length} kernel ${refsOut.length === 1 ? "type" : "types"}</span><div class="docs-wiring-chips">${refsOut.map((x) => `<a class="docs-wiring-chip" href="../${x.slug}/">${x.kind === "decorator" ? "@" : ""}${esc(x.name)}</a>`).join("")}</div></div>` : ""}
    ${refsIn.length ? `<div class="docs-wiring-row"><span class="docs-param-keyword">referenced by</span><span class="docs-wiring-role">${refsIn.length} kernel ${refsIn.length === 1 ? "API" : "APIs"}</span><div class="docs-wiring-chips">${refsIn.map((x) => `<a class="docs-wiring-chip" href="../${x.slug}/">${x.kind === "decorator" ? "@" : ""}${esc(x.name)}</a>`).join("")}</div></div>` : ""}
  </div>
</section>`
    : "";

  // Decorators present their decorator call form (e.g. @Module(meta?: ModuleMeta)) directly from AST params
  const declSig = k.kind === "decorator"
    ? `@${k.name}(${k.params.map((p) => `${p.name}${p.optional ? "?" : ""}: ${p.type}${p.defaultVal ? ` = ${p.defaultVal}` : ""}`).join(", ")})`
    : k.sig;

  const toc = [
    `<li class="docs-faceted-list-item"><a href="#api">Declaration</a></li>`,
    ...(expandedOptions ? [`<li class="docs-faceted-list-item"><a href="#options">Options (${expandedOptions.members.length})</a></li>`, ...expandedOptions.members.map((mb) => `<li class="docs-faceted-list-item docs-toc-item-h3"><a href="#${slugOf(mb.name)}">${esc(mb.name)}</a></li>`)] : []),
    ...(hasParamsSection ? [`<li class="docs-faceted-list-item"><a href="#${k.params.length ? "parameters" : "returns"}">${paramsHeading}</a></li>`] : []),
    ...(ownMembers.length ? [`<li class="docs-faceted-list-item"><a href="#members">Members (${ownMembers.length})</a></li>`, ...ownMembers.slice(0, 20).map((mb) => `<li class="docs-faceted-list-item docs-toc-item-h3"><a href="#${slugOf(mb.name)}">${esc(mb.name)}</a></li>`)] : []),
    ...(k.variants.length ? [`<li class="docs-faceted-list-item"><a href="#variants">Union Variants (${k.variants.length})</a></li>`] : []),
    ...(xrefsHtml ? [`<li class="docs-faceted-list-item"><a href="#xrefs">Type Cross-References</a></li>`] : []),
  ].join("");

  const body = `
<header class="docs-reference-header">
  <span class="docs-reference-category"><a href="../index.html">@prismshadow/penguin-core/kernel</a> · <a href="../index.html#group-${group.id}">${esc(group.title)}</a></span>
  <div class="docs-reference-title">
    <div>
      <h1>${k.kind === "decorator" ? "@" : ""}${esc(k.name)}</h1>
      ${apiLabel(bm.tKey, bm.ch, bm.label)}
      ${k.isTypeOnly ? '<span class="kernel-type-pill">type-only</span>' : ""}
      ${group.tier === "low-level" ? '<span class="kernel-type-pill">low-level</span>' : ""}
    </div>
    <a class="docs-github-links kernel-source-btn" target="_blank" rel="noopener" href="${SRC_URL(k.file, k.line)}" title="View source at ${esc(k.file)}:${k.line}" aria-label="View source on GitHub">${ICONS.code}<span>Source ↗</span></a>
  </div>
  <div class="kernel-import-bar">
    <span class="kernel-import-label">IMPORT</span>
    <code>${hl(k.importStmt, r, true, k.name)}</code>
    ${COPY_BTN}
  </div>
  ${bodyDocBlocks.length ? `<section class="docs-reference-description">${renderDocBlocks(bodyDocBlocks, r, true)}</section>` : ""}
</header>
<div class="docs-reference-api-section">
  <h2 id="api" class="docs-reference-section-heading"><a class="docs-anchor" href="#api">Declaration</a></h2>
  ${codeBlock(declSig, { file: k.file, line: k.line, r, preferKernel: true, currentSymbol: k.name })}
</div>
${optionsHtml}
${paramsHtml}
${membersHtml}
${variantsHtml}
${xrefsHtml}`;

  return shell({ r, title: `${k.kind === "decorator" ? "@" : ""}${k.name} · kernel`, section: "kernel", side: kernelSidebar("../", k.slug), toc, body });
}

/* ================================================================== */
/* Overview Landing                                                    */
/* ================================================================== */

function landing() {
  const pm = MODULE_BY_NAME.get("PlatformModule");
  const totalEndpoints = HTTP_CONTRIBS.reduce((n, g) => n + g.endpoints.length, 0);
  const totalHttpEntries = HTTP_CONTRIBS.reduce((n, g) => n + g.entries.length, 0);
  const totalMembers = IFACES.reduce((n, i) => n + i.members.length, 0);
  const modDocs = MODULES.filter((m) => m.doc.length).length;
  const compDocs = COMPONENTS.filter((c) => c.doc.length).length;
  const ifaceDocs = IFACES.filter((i) => i.doc.length).length;
  const memDocs = IFACES.reduce((n, i) => n + i.members.filter((m) => m.doc.length).length, 0);
  const kDocs = KERNEL_EXPORTS.filter((e) => e.doc.length).length;

  const body = `
<div class="docs-decorative-header">
  <div class="docs-header-content">
    <div class="penguin-hero-kicker"><span class="penguin-hero-kicker-dot"></span>PenguinHarness · API Reference (${esc(GIT_SHA)})</div>
    <h1>API &amp; Architecture Reference</h1>
    <p>Generated directly from TypeScript AST on <code>origin/main</code> (<code>${esc(GIT_SHA)}</code>, ${esc(DATA.git.date.slice(0, 10))}).</p>
    <div class="penguin-hero-stats">
      <a class="penguin-stat-chip" href="kernel/index.html"><strong>${KERNEL_EXPORTS.length}</strong> Kernel APIs</a>
      <a class="penguin-stat-chip" href="modules/index.html"><strong>${MODULES.length}</strong> Modules</a>
      <a class="penguin-stat-chip" href="interfaces/index.html"><strong>${IFACES.length}</strong> Interfaces</a>
      <a class="penguin-stat-chip" href="contributions/index.html"><strong>${SLOTS.length}</strong> Slots</a>
    </div>
  </div>
  <div class="penguin-blueprint-card" aria-hidden="true">
    <div class="penguin-blueprint-head"><span class="penguin-hero-kicker-dot"></span>Extracted Graph</div>
    <div class="penguin-blueprint-layer"><span class="penguin-blueprint-label">Kernel</span><code>penguin-core/kernel</code><span>${KERNEL_EXPORTS.length} exports</span></div>
    <div class="penguin-blueprint-arrow">↓ @Module &amp; @Component</div>
    <div class="penguin-blueprint-layer"><span class="penguin-blueprint-label">@Module</span><code>PlatformModule</code><span>${pm ? pm.resolvedChildren.length : 0} children</span></div>
    <div class="penguin-blueprint-arrow">↓ @Interface &amp; Slot&lt;D,C&gt;</div>
    <div class="penguin-blueprint-layer"><span class="penguin-blueprint-label">Surfaces</span><code>${IFACES.length} ifaces</code><span>${HTTP_CONTRIBS.length} HTTP · ${CLI_COMMANDS.length} CLI</span></div>
  </div>
  ${GLOBE_SVG}
</div>

<div class="adev-callout-box" id="surfaces">
  <p class="adev-callout-title"><span>✦</span> Reference Surfaces</p>
  <div class="adev-callout-cards">
    <a class="adev-callout-card" href="kernel/index.html">
      <h3>${ICONS.kernel} @prismshadow/penguin-core/kernel (${KERNEL_EXPORTS.length} Exports)</h3>
      <p>Full TypeScript API surface across 13 source files: declarations, parameters, members, union variants, static type cross-references, and repo usage.</p>
    </a>
    <a class="adev-callout-card" href="modules/index.html">
      <h3>${ICONS.modules} Modules (${MODULES.length} @Module · ${COMPONENTS.length} @Component)</h3>
      <p>Complete module graph across Server, Web, CLI, Libraries, and Plugins, with verbatim <code>@Module</code> / <code>@Component</code> declarations and real <code>children</code> / <code>exports</code>.</p>
    </a>
    <a class="adev-callout-card" href="interfaces/index.html">
      <h3>${ICONS.interfaces} Interfaces (${IFACES.length} Contracts · ${totalMembers} Members)</h3>
      <p>All ${IFACES.length} <code>@Interface()</code> contracts across 24 packages with static <strong>Contract Topology</strong> (<code>@Module</code> / <code>@Provide</code> / <code>@Use</code>) wiring.</p>
    </a>
    <a class="adev-callout-card" href="apis/index.html">
      <h3>${ICONS.apis} External APIs (${HTTP_CONTRIBS.length} HTTP · ${CLI_COMMANDS.length} CLI)</h3>
      <p>${totalHttpEntries} <code>HttpModule.routes</code> contributions (${totalEndpoints} endpoints) and ${CLI_COMMANDS.length} <code>penguin</code> CLI commands extracted from source.</p>
    </a>
    <a class="adev-callout-card" href="contributions/index.html">
      <h3>${ICONS.contributions} Contribution Slots (${SLOTS.length})</h3>
      <p>All <code>*Slots</code> interfaces across Server, CLI, Messaging, and Web with exact <code>Slot&lt;Data, Code&gt;</code> types and live contributor lists.</p>
    </a>
  </div>
</div>

<div class="docs-alert docs-alert-note" id="coverage">
  <p><strong>Commit:</strong> <code>${esc(GIT_SHA)}</code> (${esc(DATA.git.date)}) — ${esc(DATA.git.subject)}</p>
  <p><strong>Source JSDoc coverage:</strong> Kernel <code>${kDocs}/${KERNEL_EXPORTS.length}</code> · @Module <code>${modDocs}/${MODULES.length}</code> · @Component <code>${compDocs}/${COMPONENTS.length}</code> · @Interface <code>${ifaceDocs}/${IFACES.length}</code> · Interface members <code>${memDocs}/${totalMembers}</code>.</p>
</div>`;

  return shell({ r: "", title: "References", section: "", body, wide: true });
}

/* ---------- Modules ---------- */

function groupModulesByPkg() {
  const order = [];
  const groups = new Map();
  for (const m of MODULES) {
    if (!groups.has(m.pkg)) {
      groups.set(m.pkg, []);
      order.push(m.pkg);
    }
    groups.get(m.pkg).push(m);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => (b.isRoot ? 1 : 0) - (a.isRoot ? 1 : 0) || a.name.localeCompare(b.name));
  }
  return { order, groups };
}

function modulesSidebar(p, activeSlug) {
  const backHeader = activeSlug ? `<a class="docs-secondary-back" href="${p}index.html">← All Modules</a>` : "";
  const { order, groups } = groupModulesByPkg();
  const item = (m) => {
    const isAct = m.slug === activeSlug;
    const tag = m.isRoot ? `<span class="tag docs-updated-item">Root</span>` : "";
    return `<li class="docs-faceted-list-item"><a href="${p}${m.slug}/"${isAct ? ' class="docs-faceted-list-item-active"' : ""}><span class="docs-faceted-list-item-text">${esc(trimModule(m.name))}</span>${tag}</a></li>`;
  };
  let html = backHeader + order
    .map((pkg) => `<div class="docs-secondary-nav-header">${esc(pkg)}</div><ul class="docs-navigation-list docs-faceted-list">${groups.get(pkg).map(item).join("")}</ul>`)
    .join("");
  if (STANDALONE_COMPONENTS.length) {
    html += `<div class="docs-secondary-nav-header">Standalone Components</div><ul class="docs-navigation-list docs-faceted-list">${STANDALONE_COMPONENTS.map((c) => `<li class="docs-faceted-list-item"><a href="${p}standalone/components/${c.slug}/"${`standalone:${c.slug}` === activeSlug ? ' class="docs-faceted-list-item-active"' : ""}><span class="docs-faceted-list-item-text">${esc(c.name)}</span></a></li>`).join("")}</ul>`;
  }
  return html;
}

function filterToolbar(placeholder, types, pkgLabel = "All Packages") {
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
    <li class="adev-reference-list-type-filter-item adev-reference-list-type-filter-item-active" data-filter-type="all">${apiLabel("block", "B")}<span>All</span></li>
    ${types.map(([key, tKey, ch, label]) => `<li class="adev-reference-list-type-filter-item" data-filter-type="${key}">${apiLabel(tKey, ch)}<span class="docs-api-item-label-full">${esc(label)}</span></li>`).join("")}
  </ul>
</div>`;
}

function modulesIndex() {
  const { order, groups } = groupModulesByPkg();
  const sections = order.map((pkg) => {
    const items = groups.get(pkg).map((m) => {
      const fType = m.isRoot ? "root" : m.area === "web" ? "web" : m.area === "plugin" ? "plugin" : m.exports.length ? "exported" : "internal";
      const tKey = m.isRoot ? "block" : m.area === "cli" ? "function" : "ng_module";
      const ch = m.isRoot ? "R" : m.area === "cli" ? "F" : "M";
      return `<li data-item-type="${fType}" data-item-name="${esc((m.name + " " + m.pkg + " " + m.file).toLowerCase())}"><a class="adev-api-items-section-item" href="${m.slug}/">${apiLabel(tKey, ch)}<span class="adev-item-title" title="${esc(m.name)}">${esc(m.name)}</span></a></li>`;
    }).join("");
    return `<section class="adev-api-items-section" data-section-group>
      <header class="adev-api-items-section-header"><h3 id="p-${slugOf(pkg)}"><a class="adev-api-anchor" href="#p-${slugOf(pkg)}">${esc(pkg)}</a></h3></header>
      <ul class="adev-api-items-section-grid">${items}</ul>
    </section>`;
  }).join("\n");

  const standaloneSec = STANDALONE_COMPONENTS.length
    ? `<section class="adev-api-items-section" data-section-group>
      <header class="adev-api-items-section-header"><h3 id="p-standalone"><a class="adev-api-anchor" href="#p-standalone">Standalone &amp; Plugin @Component (${STANDALONE_COMPONENTS.length})</a></h3></header>
      <ul class="adev-api-items-section-grid">${STANDALONE_COMPONENTS.map((c) => `<li data-item-type="plugin" data-item-name="${esc((c.name + " " + c.pkg + " " + c.file).toLowerCase())}"><a class="adev-api-items-section-item" href="standalone/components/${c.slug}/">${apiLabel("class", "C")}<span class="adev-item-title" title="${esc(c.name)}">${esc(c.name)}</span></a></li>`).join("")}</ul>
    </section>`
    : "";

  const body = `
<header class="docs-reference-header">
  <div class="docs-reference-title"><div><h1>Modules Reference</h1></div></div>
</header>
${filterToolbar("Filter modules & components...", [
  ["root", "block", "R", "Root Module"],
  ["exported", "ng_module", "M", "Exporting Module"],
  ["internal", "class", "C", "Internal Module"],
  ["web", "directive", "W", "Web Module"],
  ["plugin", "pipe", "P", "Plugin / Standalone"],
], `${order.length} Packages`)}
${sections}
${standaloneSec}`;
  return shell({ r: "../", title: "Modules Reference", section: "modules", side: modulesSidebar("", ""), body, wide: true });
}

function modulePage(m) {
  const r = "../../";
  const childrenHtml = m.resolvedChildren.map((ch) => {
    const target = ch.target;
    const isMod = ch.kind === "module" && target;
    const href = isMod ? `../${target.slug}/` : target ? `${r}${target.href}` : null;
    const badge = isMod ? "@Module" : "@Component";
    const docPreview = target?.doc?.length ? para([target.doc[0]], r) : "";
    const wiring = target ? nodeWiringChips(target, r) : "";
    const exportsRow = isMod && target.exports.length
      ? `<div class="docs-param-group"><span class="docs-param-keyword">exports</span><span class="docs-param-name">interfaces</span>${target.exports.map((e) => linkifyType(e, r)).join(" ")}</div>`
      : "";
    return `<div class="docs-reference-member-card" id="${slugOf(ch.name)}">
  <header class="docs-reference-card-header">
    <h3><a class="docs-anchor" href="#${slugOf(ch.name)}">${esc(ch.name)}</a></h3>
    <div class="docs-card-sig"><code>${hl(`${badge} ${ch.name}`, r)}</code></div>
  </header>
  <div class="docs-reference-card-body">
    <div class="docs-reference-card-item">
      <div class="docs-function-definition">${docPreview || '<p class="muted">No JSDoc comment in source.</p>'}${href ? `<p><a class="card-detail-link" href="${href}">View ${isMod ? "module" : "component"} →</a>${target ? ` <span class="muted">(${esc(target.file)}:${target.line})</span>` : ""}</p>` : ""}</div>
      ${exportsRow}
      ${wiring}
    </div>
  </div>
</div>`;
  }).join("");

  const wiringHtml = nodeWiringBlocks(m, r);
  const slotKeys = Object.keys(m.contributes || {});
  const contribHtml = slotKeys.length
    ? `<h2 id="contributes" class="docs-reference-section-heading"><a class="docs-anchor" href="#contributes">Contributes</a></h2>
${codeBlock(JSON.stringify(m.contributes, null, 2), { r })}
<p>Target slots: ${slotKeys.map((sk) => `<a href="${r}contributions/index.html#${slugOf(sk)}"><code>${esc(sk)}</code></a>`).join(" · ")}</p>`
    : "";

  const parentLinks = m.parents.length
    ? ` · Child of ${m.parents.map((p) => `<a href="../${p.slug}/">${esc(p.name)}</a>`).join(", ")}`
    : "";

  const toc = [
    `<li class="docs-faceted-list-item"><a href="#api">API</a></li>`,
    ...(wiringHtml ? [`<li class="docs-faceted-list-item"><a href="#wiring">Dependencies &amp; Wiring</a></li>`] : []),
    ...(m.context ? [`<li class="docs-faceted-list-item"><a href="#context">Parked Context</a></li>`] : []),
    ...(slotKeys.length ? [`<li class="docs-faceted-list-item"><a href="#contributes">Contributes</a></li>`] : []),
    `<li class="docs-faceted-list-item"><a href="#children">Children (${m.resolvedChildren.length})</a></li>`,
    ...m.resolvedChildren.slice(0, 35).map((c) => `<li class="docs-faceted-list-item docs-toc-item-h3"><a href="#${slugOf(c.name)}">${esc(c.name)}</a></li>`),
    `<li class="docs-faceted-list-item"><a href="#exports">Exports (${m.exports.length})</a></li>`,
  ].join("");

  const body = `
<header class="docs-reference-header">
  <span class="docs-reference-category">${esc(m.pkg)} · ${esc(m.file)}:${m.line}${parentLinks}</span>
  <div class="docs-reference-title">
    <div>
      <h1>${esc(m.name)}</h1>
      ${apiLabel(m.isRoot ? "block" : "ng_module", "M", m.isRoot ? "root module" : "module")}
    </div>
    <a class="docs-github-links" target="_blank" rel="noopener" href="${SRC_URL(m.file, m.line)}" title="View source at ${esc(m.file)}:${m.line}" aria-label="View source">${ICONS.code}</a>
  </div>
  <section class="docs-reference-description">${m.docBlocks.length ? renderDocBlocks(m.docBlocks, r) : '<p class="muted">No JSDoc comment in source yet.</p>'}</section>
</header>
<div class="docs-reference-api-section">
  <h2 id="api" class="docs-reference-section-heading"><a class="docs-anchor" href="#api">API</a></h2>
  ${codeBlock(m.rawDecl, { file: m.file, line: m.line, r })}
</div>
${wiringHtml}
${m.context ? `<h2 id="context" class="docs-reference-section-heading"><a class="docs-anchor" href="#context">Parked Context</a></h2>\n${codeBlock("context: " + m.context, { r })}` : ""}
${contribHtml}
<h2 id="children" class="docs-reference-section-heading"><a class="docs-anchor" href="#children">Children (${m.resolvedChildren.length})</a></h2>
<div class="docs-reference-members">${childrenHtml || '<p class="muted">No child modules or components declared in <code>@Module</code>.</p>'}</div>
<h2 id="exports" class="docs-reference-section-heading"><a class="docs-anchor" href="#exports">Exports (${m.exports.length})</a></h2>
<p>${m.exports.length ? m.exports.map((e) => linkifyType(e, r)).join(" · ") : '<span class="muted">None (module-private).</span>'}</p>`;

  return shell({ r, title: m.name, section: "modules", side: modulesSidebar("../", m.slug), toc, body });
}

function componentPage(comp) {
  const r = "../../../../";
  const parent = comp.primaryParent;
  const sideActive = parent ? parent.slug : `standalone:${comp.slug}`;
  const wiringHtml = nodeWiringBlocks(comp, r);
  const slotKeys = Object.keys(comp.contributes || {});
  const httpRef = HTTP_BY_CLS.get(comp.name);
  const contribHtml = slotKeys.length
    ? `<h2 id="contributes" class="docs-reference-section-heading"><a class="docs-anchor" href="#contributes">Contributes</a></h2>
${codeBlock(JSON.stringify(comp.contributes, null, 2), { r })}
<p>Target slots: ${slotKeys.map((sk) => `<a href="${r}contributions/index.html#${slugOf(sk)}"><code>${esc(sk)}</code></a>`).join(" · ")}${httpRef ? ` · <a href="${r}apis/http/${httpRef.slug}/">View HTTP endpoints (${httpRef.endpoints.length}) →</a>` : ""}</p>`
    : "";

  const methodsHtml = comp.methods.length
    ? `<h2 id="methods" class="docs-reference-section-heading"><a class="docs-anchor" href="#methods">Methods (${comp.methods.length})</a></h2>
<div class="docs-reference-members">${comp.methods.map((mb) => memberSection(mb, r)).join("")}</div>`
    : "";

  const toc = [
    `<li class="docs-faceted-list-item"><a href="#api">API</a></li>`,
    ...(wiringHtml ? [`<li class="docs-faceted-list-item"><a href="#wiring">Dependencies &amp; Wiring</a></li>`] : []),
    ...(comp.context ? [`<li class="docs-faceted-list-item"><a href="#context">Parked Context</a></li>`] : []),
    ...(slotKeys.length ? [`<li class="docs-faceted-list-item"><a href="#contributes">Contributes</a></li>`] : []),
    ...(comp.methods.length ? [`<li class="docs-faceted-list-item"><a href="#methods">Methods (${comp.methods.length})</a></li>`] : []),
  ].join("");

  const parentCrumb = parent ? `<a href="../../">${esc(parent.name)}</a>` : `<span>${esc(comp.pkg)}</span>`;

  const body = `
<header class="docs-reference-header">
  <span class="docs-reference-category">${parentCrumb} · ${esc(comp.file)}:${comp.line}</span>
  <div class="docs-reference-title">
    <div>
      <h1>${esc(comp.name)}</h1>
      ${apiLabel("class", "C", "component")}
    </div>
    <a class="docs-github-links" target="_blank" rel="noopener" href="${SRC_URL(comp.file, comp.line)}" title="View source at ${esc(comp.file)}:${comp.line}" aria-label="View source">${ICONS.code}</a>
  </div>
  <section class="docs-reference-description">${comp.docBlocks.length ? renderDocBlocks(comp.docBlocks, r) : '<p class="muted">No JSDoc comment in source yet.</p>'}</section>
</header>
<div class="docs-reference-api-section">
  <h2 id="api" class="docs-reference-section-heading"><a class="docs-anchor" href="#api">API</a></h2>
  ${codeBlock(comp.rawDecl, { file: comp.file, line: comp.line, r })}
</div>
${wiringHtml}
${comp.context ? `<h2 id="context" class="docs-reference-section-heading"><a class="docs-anchor" href="#context">Parked Context</a></h2>\n${codeBlock("context: " + comp.context, { r })}` : ""}
${contribHtml}
${methodsHtml}`;

  return shell({ r, title: comp.name, section: "modules", side: modulesSidebar("../../../", sideActive), toc, body });
}

/* ---------- Interfaces ---------- */

function groupIfacesByPkg() {
  const order = [];
  const groups = new Map();
  for (const it of IFACES) {
    if (!groups.has(it.pkg)) {
      groups.set(it.pkg, []);
      order.push(it.pkg);
    }
    groups.get(it.pkg).push(it);
  }
  return { order, groups };
}

function ifacesSidebar(p, activeSlug) {
  const backHeader = activeSlug ? `<a class="docs-secondary-back" href="${p}index.html">← All Interfaces</a>` : "";
  const { order, groups } = groupIfacesByPkg();
  const kernelLink = `<div class="docs-secondary-nav-header">@prismshadow/penguin-core/kernel</div>
<ul class="docs-navigation-list docs-faceted-list">
  <li class="docs-faceted-list-item"><a href="${p}../kernel/index.html"><span class="docs-faceted-list-item-text">All Kernel Exports</span><span class="tag docs-new-item">${KERNEL_EXPORTS.length}</span></a></li>
</ul>`;
  const ifaceHtml = order
    .map((pkg) => `<div class="docs-secondary-nav-header">${esc(pkg)}</div><ul class="docs-navigation-list docs-faceted-list">${groups.get(pkg).map((it) => `<li class="docs-faceted-list-item"><a href="${p}${it.slug}/"${it.slug === activeSlug ? ' class="docs-faceted-list-item-active"' : ""}><span class="docs-faceted-list-item-text">${esc(it.name)}</span></a></li>`).join("")}</ul>`)
    .join("");
  return backHeader + kernelLink + ifaceHtml;
}

function ifacesIndex() {
  const { order, groups } = groupIfacesByPkg();
  const gridItem = (name, href, pkg, fType, tKey, ch) =>
    `<li data-item-type="${fType}" data-item-name="${esc((name + " " + pkg).toLowerCase())}"><a class="adev-api-items-section-item" href="${href}">${apiLabel(tKey, ch)}<span class="adev-item-title" title="${esc(name)}">${esc(name)}</span></a></li>`;

  const kernelSec = `<section class="adev-api-items-section" data-section-group>
  <header class="adev-api-items-section-header"><h3 id="kernel"><a class="adev-api-anchor" href="../kernel/index.html">@prismshadow/penguin-core/kernel (${KERNEL_EXPORTS.length} exports →)</a></h3></header>
  <ul class="adev-api-items-section-grid">${KERNEL_EXPORTS.slice(0, 18).map((k) => {
    const bm = kernelBadgeMeta(k.kind);
    return gridItem(k.kind === "decorator" ? `@${k.name}` : k.name, `../kernel/${k.slug}/`, "@prismshadow/penguin-core/kernel", k.kind === "decorator" ? "decorator" : "kernel", bm.tKey, bm.ch);
  }).join("")}</ul>
</section>`;

  const ifaceSecs = order.map((pkg) => {
    const list = groups.get(pkg);
    const fType = pkg.includes("penguin-library-") ? "library" : pkg === "@prismshadow/penguin-server" ? "server" : pkg === "@prismshadow/penguin-web" ? "web" : "plugin";
    return `<section class="adev-api-items-section" data-section-group>
  <header class="adev-api-items-section-header"><h3 id="pkg-${slugOf(pkg)}"><a class="adev-api-anchor" href="#pkg-${slugOf(pkg)}">${esc(pkg)}</a></h3></header>
  <ul class="adev-api-items-section-grid">${list.map((it) => gridItem(it.name, `${it.slug}/`, it.pkg, fType, "interface", "I")).join("")}</ul>
</section>`;
  }).join("\n");

  const body = `
<header class="docs-reference-header">
  <div class="docs-reference-title"><div><h1>Interfaces Reference</h1></div></div>
</header>
${filterToolbar("Filter interfaces & kernel primitives...", [
  ["decorator", "decorator", "@", "Decorator"],
  ["kernel", "type_alias", "T", "Kernel API"],
  ["server", "interface", "I", "Server Interface"],
  ["library", "class", "L", "Library Interface"],
  ["web", "directive", "W", "Web Interface"],
  ["plugin", "pipe", "P", "Plugin Interface"],
], `${order.length + 1} Packages`)}
${kernelSec}
${ifaceSecs}`;
  return shell({ r: "../", title: "Interfaces Reference", section: "interfaces", side: ifacesSidebar("", ""), body, wide: true });
}

function ifacePage(it) {
  const r = "../../";
  const members = it.members || [];
  const wiringHtml = ifaceWiringSection(it.name, r);
  const toc = [
    `<li class="docs-faceted-list-item"><a href="#api">API</a></li>`,
    ...(wiringHtml ? [`<li class="docs-faceted-list-item"><a href="#wiring">Contract Topology</a></li>`] : []),
    `<li class="docs-faceted-list-item"><a href="#members">Members (${members.length})</a></li>`,
    ...members.map((mb) => `<li class="docs-faceted-list-item docs-toc-item-h3"><a href="#${slugOf(mb.name || mb.sig.split(/[(\s:<]/)[0])}">${esc(mb.name || mb.sig.split(/[(\s:<]/)[0])}</a></li>`),
  ].join("");
  const body = `
<header class="docs-reference-header">
  <span class="docs-reference-category">${esc(it.pkg)} · ${esc(it.file)}:${it.line}</span>
  <div class="docs-reference-title">
    <div>
      <h1>${esc(it.name)}</h1>
      ${apiLabel("interface", "I", "interface")}
    </div>
    <a class="docs-github-links" target="_blank" rel="noopener" href="${SRC_URL(it.file, it.line)}" title="View source at ${esc(it.file)}:${it.line}" aria-label="View source">${ICONS.code}</a>
  </div>
  <section class="docs-reference-description">
    ${it.docBlocks.length ? renderDocBlocks(it.docBlocks, r) : '<p class="muted">No JSDoc comment in source yet.</p>'}
  </section>
</header>
<div class="docs-reference-api-section">
  <h2 id="api" class="docs-reference-section-heading"><a class="docs-anchor" href="#api">API</a></h2>
  ${codeBlock(it.rawDecl, { file: it.file, line: it.line, r })}
</div>
${wiringHtml}
<h2 id="members" class="docs-reference-section-heading"><a class="docs-anchor" href="#members">Members (${members.length})</a></h2>
<div class="docs-reference-members">
${members.length ? members.map((mb) => memberSection(mb, r)).join("") : '<p class="muted">No declared members.</p>'}
</div>`;
  return shell({ r, title: it.name, section: "interfaces", side: ifacesSidebar("../", it.slug), toc, body });
}

/* ---------- External APIs (HTTP & CLI) ---------- */

const apisSidebar = (kind, activeSlug = "") => {
  const cliHref = kind === "index" ? (c) => `cli/${c.slug}/` : kind === "cli" ? (c) => `../${c.slug}/` : (c) => `../../cli/${c.slug}/`;
  const httpHref = kind === "index" ? (g) => `http/${g.slug}/` : kind === "http" ? (g) => `../${g.slug}/` : (g) => `../../http/${g.slug}/`;
  const back = kind === "index" ? "" : `<a class="docs-secondary-back" href="../../index.html">← External APIs</a>`;
  return `${back}<div class="docs-secondary-nav-header">HTTP Route Groups (${HTTP_CONTRIBS.length})</div>
<ul class="docs-navigation-list docs-faceted-list">${HTTP_CONTRIBS.map((g) => `<li class="docs-faceted-list-item"><a href="${httpHref(g)}"${g.slug === activeSlug ? ' class="docs-faceted-list-item-active"' : ""}><span class="docs-faceted-list-item-text">${esc(g.cls)}</span></a></li>`).join("")}</ul>
<div class="docs-secondary-nav-header">CLI Commands (${CLI_COMMANDS.length})</div>
<ul class="docs-navigation-list docs-faceted-list">${CLI_COMMANDS.map((c) => `<li class="docs-faceted-list-item"><a href="${cliHref(c)}"${c.slug === activeSlug ? ' class="docs-faceted-list-item-active"' : ""}><span class="docs-faceted-list-item-text">penguin ${esc(c.name)}</span></a></li>`).join("")}</ul>`;
};

function apiIndex() {
  const httpItem = (g) => `<li data-item-type="http" data-item-name="${esc((g.cls + " " + g.entries.map((e) => e.prefix).join(" ")).toLowerCase())}"><a class="adev-api-items-section-item" href="http/${g.slug}/">${apiLabel("pipe", "H")}<span class="adev-item-title" title="${esc(g.cls)}">${esc(g.cls)}</span></a></li>`;
  const cliItem = (c) => `<li data-item-type="cli" data-item-name="${esc(("penguin " + c.name + " " + c.brief).toLowerCase())}"><a class="adev-api-items-section-item" href="cli/${c.slug}/">${apiLabel("function", "F")}<span class="adev-item-title" title="penguin ${esc(c.name)}">penguin ${esc(c.name)}</span></a></li>`;
  const body = `
<header class="docs-reference-header">
  <div class="docs-reference-title"><div><h1>HTTP &amp; CLI Reference</h1></div></div>
</header>
${filterToolbar("Filter HTTP routes & CLI commands...", [
  ["http", "pipe", "H", "HTTP Route Group"],
  ["cli", "function", "F", "CLI Command"],
], "HttpModule.routes & CLI")}
<section class="adev-api-items-section" data-section-group>
  <header class="adev-api-items-section-header"><h3 id="http"><a class="adev-api-anchor" href="#http">HttpModule.routes (${HTTP_CONTRIBS.length})</a></h3></header>
  <ul class="adev-api-items-section-grid">${HTTP_CONTRIBS.map(httpItem).join("")}</ul>
</section>
<section class="adev-api-items-section" data-section-group>
  <header class="adev-api-items-section-header"><h3 id="cli"><a class="adev-api-anchor" href="#cli">CLI Commands (${CLI_COMMANDS.length})</a></h3></header>
  <ul class="adev-api-items-section-grid">${CLI_COMMANDS.map(cliItem).join("")}</ul>
</section>`;
  return shell({ r: "../", title: "External APIs", section: "apis", side: apisSidebar("index"), body, wide: true });
}

function httpPage(g) {
  const r = "../../../";
  const eps = g.endpoints.length
    ? `<h2 id="endpoints" class="docs-reference-section-heading"><a class="docs-anchor" href="#endpoints">Endpoints (${g.endpoints.length})</a></h2>
<div class="docs-reference-members">
${g.endpoints.map((e, idx) => `<div class="docs-reference-member-card" id="ep-${idx}">
  <header class="docs-reference-card-header">
    <div class="docs-card-title-group"><span class="method m-${e.method.toLowerCase()}">${e.method}</span><h3><code>${esc(e.path)}</code></h3></div>
    <div class="docs-card-sig"><a href="${SRC_URL(e.file || g.file, e.line)}" target="_blank" rel="noopener"><code>${esc((e.file || g.file).split("/").pop())}:${e.line}</code></a></div>
  </header>
</div>`).join("")}
</div>`
    : '<p class="muted">No literal Hono route registrations found in this file (delegated to a helper module).</p>';

  const toc = `
    <li class="docs-faceted-list-item"><a href="#contrib">HttpModule.routes</a></li>
    <li class="docs-faceted-list-item"><a href="#binds">@Bind Implementation</a></li>
    ${g.endpoints.length ? `<li class="docs-faceted-list-item"><a href="#endpoints">Endpoints (${g.endpoints.length})</a></li>` : ""}`;

  const body = `
<header class="docs-reference-header">
  <span class="docs-reference-category"><a href="${r}${g.nodeHref}">${esc(g.cls)}</a> · ${esc(g.file)}:${g.line}</span>
  <div class="docs-reference-title">
    <div>
      <h1>${esc(g.cls)}</h1>
      ${apiLabel("pipe", "H", "http-routes")}
    </div>
    <a class="docs-github-links" target="_blank" rel="noopener" href="${SRC_URL(g.file, g.line)}" title="View source" aria-label="View source">${ICONS.code}</a>
  </div>
  ${g.docBlocks.length ? `<section class="docs-reference-description">${renderDocBlocks(g.docBlocks, r)}</section>` : ""}
</header>
<div class="docs-reference-api-section">
  <h2 id="contrib" class="docs-reference-section-heading"><a class="docs-anchor" href="#contrib">API</a></h2>
  ${codeBlock('contributes: {\n  "HttpModule.routes": [\n' + g.entries.map((e) => `    { id: "${e.id}", prefix: "${e.prefix}", auth: "${e.auth}", order: ${e.order}${e.origin ? `, origin: "${e.origin}"` : ""} },`).join("\n") + "\n  ],\n}", { file: g.file, line: g.line, r })}
</div>
<h2 id="binds" class="docs-reference-section-heading"><a class="docs-anchor" href="#binds">Code Half (@Bind)</a></h2>
<p>${g.binds.length ? g.binds.map((b) => `<code>${esc(b.raw)}</code>`).join(" · ") : g.entries.map((e) => `<code>@Bind("${esc(e.id)}")</code>`).join(" · ")}</p>
${eps}`;
  return shell({ r, title: g.cls, section: "apis", side: apisSidebar("http", g.slug), toc, body });
}

function cliPage(c) {
  const r = "../../../";
  const subHtml = c.subcommands.length
    ? `<h2 id="subcommands" class="docs-reference-section-heading"><a class="docs-anchor" href="#subcommands">Subcommands (${c.subcommands.length})</a></h2>
${codeBlock(c.subcommands.map((s) => `penguin ${s}`).join("\n"), { r })}`
    : "";
  const optHtml = c.options.length
    ? `<h2 id="options" class="docs-reference-section-heading"><a class="docs-anchor" href="#options">Options (${c.options.length})</a></h2>
<div class="docs-reference-members">
${c.options.map((o, idx) => `<div class="docs-reference-member-card" id="opt-${idx}">
  <header class="docs-reference-card-header">
    <h3><code>${esc(o.flag)}</code></h3>
  </header>
  ${o.desc ? `<div class="docs-reference-card-body"><div class="docs-reference-card-item"><div class="docs-function-definition"><p>${esc(o.desc)}</p></div></div></div>` : ""}
</div>`).join("")}
</div>`
    : "";
  const toc = [
    ...(c.subcommands.length ? [`<li class="docs-faceted-list-item"><a href="#subcommands">Subcommands</a></li>`] : []),
    ...(c.options.length ? [`<li class="docs-faceted-list-item"><a href="#options">Options</a></li>`] : []),
    ...(c.docBlocks.length ? [`<li class="docs-faceted-list-item"><a href="#doc">Source Doc</a></li>`] : []),
  ].join("");

  const body = `
<header class="docs-reference-header">
  <span class="docs-reference-category">${esc(c.pkg)}${c.nodeHref ? ` · <a href="${r}${c.nodeHref}">${esc(c.cls)}</a>` : ""} · ${esc(c.file)}:${c.line}</span>
  <div class="docs-reference-title">
    <div>
      <h1>penguin ${esc(c.name)}</h1>
      ${apiLabel("function", "F", "cli-command")}
    </div>
    <a class="docs-github-links" target="_blank" rel="noopener" href="${SRC_URL(c.file, c.line)}" title="View source" aria-label="View source">${ICONS.code}</a>
  </div>
  ${c.brief ? `<section class="docs-reference-description"><p>${esc(c.brief)}${c.briefZh && c.briefZh !== c.brief ? `<br><span class="muted">${esc(c.briefZh)}</span>` : ""}</p></section>` : ""}
</header>
<p class="muted">Registered via <code>${esc(c.slot)}</code>${c.id ? ` (id: <code>${esc(c.id)}</code>)` : ""}.</p>
${subHtml}
${optHtml}
${c.docBlocks.length ? `<h2 id="doc" class="docs-reference-section-heading"><a class="docs-anchor" href="#doc">Source Doc</a></h2>${renderDocBlocks(c.docBlocks, r)}` : ""}`;
  return shell({ r, title: `penguin ${c.name}`, section: "apis", side: apisSidebar("cli", c.slug), toc, body });
}

/* ---------- Contributions ---------- */

function contributionsPage() {
  const r = "../";
  const byPkg = new Map();
  const pkgOrder = [];
  for (const s of SLOTS) {
    if (!byPkg.has(s.pkg)) { byPkg.set(s.pkg, []); pkgOrder.push(s.pkg); }
    byPkg.get(s.pkg).push(s);
  }

  const toc = pkgOrder.map((pkg) => `<li class="docs-faceted-list-item"><a href="#pkg-${slugOf(pkg)}">${esc(pkg)} (${byPkg.get(pkg).length})</a></li>`).join("");
  const side = pkgOrder
    .map((pkg) => `<div class="docs-secondary-nav-header">${esc(pkg)}</div><ul class="docs-navigation-list docs-faceted-list">${byPkg.get(pkg).map((s) => `<li class="docs-faceted-list-item"><a href="#${slugOf(s.key)}"><span class="docs-faceted-list-item-text">${esc(s.key)}</span>${s.contributors.length ? `<span class="tag">${s.contributors.length}</span>` : ""}</a></li>`).join("")}</ul>`)
    .join("");

  const sectionsHtml = pkgOrder.map((pkg) => {
    const list = byPkg.get(pkg);
    return `<h2 id="pkg-${slugOf(pkg)}" class="docs-reference-section-heading"><a class="docs-anchor" href="#pkg-${slugOf(pkg)}">${esc(pkg)} (${list.length})</a></h2>
<div class="docs-reference-members">
${list.map((s) => `<div class="docs-reference-member-card" id="${slugOf(s.key)}">
  <header class="docs-reference-card-header">
    <h3><a class="docs-anchor" href="#${slugOf(s.key)}">${esc(s.key)}</a></h3>
    <div class="docs-card-sig">${s.hostHref ? `<a href="${r}${s.hostHref}"><code>${esc(s.host)}</code></a>` : `<code>${esc(s.host)}</code>`} · <a href="${SRC_URL(s.file, s.line)}" target="_blank" rel="noopener"><code>${esc(s.file.split("/").pop())}:${s.line}</code></a></div>
  </header>
  <div class="docs-reference-card-body">
    <div class="docs-reference-card-item">
      ${s.docBlocks.length ? `<div class="docs-function-definition">${renderDocBlocks(s.docBlocks, r)}</div>` : ""}
      <div class="docs-param-group"><span class="docs-param-keyword">@data</span><span class="docs-param-name">manifest</span><code>${hl(s.data, r)}</code></div>
      <div class="docs-return-type"><span class="docs-param-keyword">@code</span><code>${s.code ? hl(s.code, r) : '<span class="muted">data-only (never)</span>'}</code></div>
      ${s.contributors.length ? `<div class="docs-param-group"><span class="docs-param-keyword">contributors</span><span class="docs-param-name">(${s.contributors.length})</span><div class="docs-wiring-chips">${s.contributors.map((c) => `<a class="docs-wiring-chip" href="${r}${c.href}">${esc(c.name)}${c.count > 1 ? ` ×${c.count}` : ""}</a>`).join("")}</div></div>` : ""}
    </div>
  </div>
</div>`).join("")}
</div>`;
  }).join("\n");

  const body = `
<header class="docs-reference-header">
  <span class="docs-reference-category"><a href="../kernel/${KERNEL_BY_NAME.get("Slot")?.slug || "Slot"}/">@prismshadow/penguin-core/kernel · Slot&lt;Data, Code&gt;</a></span>
  <div class="docs-reference-title"><div><h1>Contribution Slots</h1>${apiLabel("directive", "D", `${SLOTS.length} slots`)}</div></div>
  <p>Extracted from all <code>*Slots</code> companion interfaces and live <code>contributes</code> declarations across the repository (<code>${esc(GIT_SHA)}</code>).</p>
</header>
${sectionsHtml}`;

  return shell({ r, title: "Contribution Slots", section: "contributions", side, toc, body });
}

/* ---------- Supplemental CSS for Kernel Showcase & Doc Lists ---------- */

const EXTRA_CSS = `
/* Structured JSDoc bullet lists */
.docs-doc-list {
  margin: 0.55rem 0 0.85rem 1.25rem;
  padding: 0;
  color: var(--secondary-contrast);
  line-height: 1.65;
}
.docs-doc-list li {
  margin: 0.25rem 0;
}

/* Copyable Import Bar */
.kernel-import-bar {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.65rem 2.75rem 0.65rem 0.9rem;
  margin: 0.85rem 0 1.25rem;
  background: var(--octonary-contrast);
  border: 1px solid var(--senary-contrast);
  border-radius: var(--card-radius);
  overflow-x: auto;
}
.kernel-import-bar code {
  font-family: var(--code-font);
  font-size: 0.82rem;
  background: transparent;
  padding: 0;
  color: var(--primary-contrast);
  white-space: nowrap;
}
.kernel-import-bar button[docs-copy-source-code] {
  top: 50%;
  transform: translateY(-50%);
  opacity: 0.72;
}
.kernel-import-bar:hover button[docs-copy-source-code] {
  opacity: 1;
}
.kernel-import-label {
  font-family: var(--code-font);
  font-size: 0.68rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--quaternary-contrast);
  flex-shrink: 0;
}
.kernel-type-pill {
  display: inline-flex;
  align-items: center;
  padding: 0.12rem 0.45rem;
  font-family: var(--code-font);
  font-size: 0.7rem;
  border-radius: calc(var(--card-radius) * 0.6);
  background: var(--septenary-contrast);
  color: var(--tertiary-contrast);
  border: 1px solid var(--senary-contrast);
}

/* Kernel File Header Meta & Compact Signature Preview */
.kernel-file-meta {
  font-weight: 400;
  font-size: 0.78rem;
  color: var(--quaternary-contrast);
  margin-left: 0.35rem;
}
.kernel-file-meta a {
  color: var(--tertiary-contrast);
  text-decoration: none;
}
.kernel-file-meta a:hover {
  color: var(--bright-blue);
  text-decoration: underline;
}
.kernel-api-sig {
  font-family: var(--code-font);
  font-size: 0.78rem;
  background: transparent;
  padding: 0;
  color: var(--tertiary-contrast);
}
.kernel-tier-toggle {
  display: inline-flex;
  align-items: center;
  padding: 2px;
  border-radius: var(--card-radius);
  border: 1px solid var(--senary-contrast);
  background: var(--octonary-contrast);
  gap: 2px;
  flex-shrink: 0;
}
.kernel-tier-btn {
  border: none;
  background: transparent;
  color: var(--tertiary-contrast);
  font-size: 0.78rem;
  font-weight: 500;
  padding: 0.34rem 0.68rem;
  border-radius: calc(var(--card-radius) - 2px);
  cursor: pointer;
  transition: background-color 140ms ease, color 140ms ease;
}
.kernel-tier-btn:hover { color: var(--primary-contrast); }
.kernel-tier-btn.active {
  background: var(--septenary-contrast);
  color: var(--primary-contrast);
  box-shadow: inset 0 0 0 1px var(--senary-contrast);
}
.kernel-group-details {
  border: 1px solid var(--senary-contrast);
  border-radius: var(--card-radius);
  background: var(--octonary-contrast);
  overflow: hidden;
}
.kernel-group-summary {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.72rem 0.95rem;
  cursor: pointer;
  user-select: none;
  list-style: none;
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--secondary-contrast);
  transition: background-color 140ms ease, color 140ms ease;
}
.kernel-group-summary::-webkit-details-marker { display: none; }
.kernel-group-summary::before {
  content: "";
  width: 6px;
  height: 6px;
  border-right: 1.5px solid var(--quaternary-contrast);
  border-bottom: 1.5px solid var(--quaternary-contrast);
  transform: rotate(-45deg);
  transition: transform 160ms ease;
  flex-shrink: 0;
}
.kernel-group-details[open] > .kernel-group-summary::before {
  transform: rotate(45deg);
}
.kernel-group-summary:hover {
  background: var(--septenary-contrast);
  color: var(--primary-contrast);
}
.kernel-group-details > .kernel-catalog-list {
  border: none;
  border-top: 1px solid var(--senary-contrast);
  border-radius: 0;
}

/* Complete Wiring / Cross-Reference Box & Chip System */
.docs-wiring-box {
  margin: 1.75rem 0 1.25rem;
  padding: 1rem 1.15rem;
  background: var(--octonary-contrast);
  border: 1px solid var(--senary-contrast);
  border-radius: var(--card-radius);
}
.docs-wiring-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.4rem 1rem;
  padding-bottom: 0.7rem;
  border-bottom: 1px solid var(--senary-contrast);
}
.docs-wiring-head .docs-reference-section-heading {
  margin: 0;
  font-size: 1.02rem;
}
.docs-wiring-sub {
  font-size: 0.76rem;
  color: var(--quaternary-contrast);
}
.docs-wiring-grid {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  margin-top: 0.8rem;
}
.docs-wiring-row {
  display: grid;
  grid-template-columns: 112px 115px 1fr;
  gap: 0.65rem;
  align-items: start;
}
.docs-wiring-role {
  font-size: 0.78rem;
  color: var(--tertiary-contrast);
  padding-top: 0.22rem;
  white-space: nowrap;
}
.docs-wiring-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  align-items: center;
}
.docs-wiring-chip {
  display: inline-flex;
  align-items: center;
  padding: 0.2rem 0.56rem;
  font-family: var(--code-font);
  font-size: 0.76rem;
  line-height: 1.35;
  border-radius: calc(var(--card-radius) * 0.65);
  background: var(--septenary-contrast);
  color: var(--primary-contrast);
  border: 1px solid var(--senary-contrast);
  text-decoration: none;
  transition: border-color 140ms ease, color 140ms ease, background-color 140ms ease;
}
.docs-wiring-chip:hover {
  border-color: var(--bright-blue);
  color: var(--bright-blue);
  background: var(--octonary-contrast);
}
@media (max-width: 720px) {
  .docs-wiring-row { grid-template-columns: 1fr; gap: 0.3rem; }
}

/* Copy Button Checkmark State + Unhide Copy Button in Declaration Code Blocks */
button[docs-copy-source-code] .docs-check { display: none; }
button[docs-copy-source-code].copied .docs-copy { display: none; }
button[docs-copy-source-code].copied .docs-check { display: block; color: var(--symbolic-green, #10b981); }
.docs-reference-api-section .docs-code button[docs-copy-source-code] {
  display: inline-flex !important;
  align-items: center;
  justify-content: center;
}

/* Source Pill Button */
.kernel-source-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.32rem 0.65rem;
  font-size: 0.78rem;
  font-weight: 500;
  color: var(--secondary-contrast);
  background: var(--octonary-contrast);
  border: 1px solid var(--senary-contrast);
  border-radius: calc(var(--card-radius) * 0.75);
  text-decoration: none;
  white-space: nowrap;
  flex-shrink: 0;
  transition: border-color 140ms ease, color 140ms ease;
}
.kernel-source-btn:hover {
  border-color: var(--bright-blue);
  color: var(--bright-blue);
}
.kernel-source-btn svg { width: 15px; height: 15px; }

/* Fix Card Target Ring Radius, Orphaned Divider & Consistent Wrapping Alignment */
.docs-reference-member-card:target::before {
  border-radius: var(--card-radius) !important;
}
.docs-reference-card-item .docs-function-definition:last-child {
  border-block-end: none !important;
  padding-bottom: 0 !important;
  margin-bottom: 0 !important;
}
.docs-reference-card-header {
  gap: 0.4rem 1rem;
  align-items: baseline;
}
.docs-reference-card-header .docs-card-sig {
  text-align: left;
  max-width: 100%;
  word-break: break-word;
}
.docs-reference-section-heading .kernel-file-meta code {
  padding: 0.1rem 0.4rem;
}
.docs-code-header a {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.kernel-import-bar {
  padding-right: 2.8rem;
}

/* Official Shiki + @shikijs/twoslash Theme Mapping & Highlight Lines */
.docs-sample-wrap {
  margin-top: 0.7rem;
}
.docs-sample-wrap .docs-code {
  margin: 0;
}
.docs-sample-fail {
  margin-bottom: 0.55rem;
  padding: 0.6rem 0.8rem;
  border-radius: calc(var(--card-radius) * 0.8);
  border: 1px solid rgba(239, 68, 68, 0.45);
  background: rgba(239, 68, 68, 0.08);
  color: #b91c1c;
  font-size: 0.8rem;
}
html.docs-dark-mode .docs-sample-fail {
  color: #fca5a5;
  background: rgba(239, 68, 68, 0.14);
}
.docs-sample-fail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
.docs-sample-fail pre {
  margin: 0.4rem 0 0;
  font-size: 0.74rem;
  white-space: pre-wrap;
  overflow-x: auto;
}

/* Shiki dual-theme token colors */
.shiki, .shiki span {
  color: var(--shiki-light);
  background-color: transparent;
}
html.docs-dark-mode .shiki,
html.docs-dark-mode .shiki span {
  color: var(--shiki-dark);
}

/* Official Twoslash variables mapped to Frost/Console light & dark tokens */
:root {
  --twoslash-border-color: var(--senary-contrast);
  --twoslash-popup-bg: #ffffff;
  --twoslash-popup-color: var(--primary-contrast);
  --twoslash-popup-shadow: 0 10px 28px rgba(15, 23, 42, 0.14);
  --twoslash-docs-color: var(--tertiary-contrast);
  --twoslash-docs-font: var(--body-font, Inter, sans-serif);
  --twoslash-code-font: var(--code-font);
  --twoslash-code-font-size: 0.78rem;
}
html.docs-dark-mode {
  --twoslash-popup-bg: #141922;
  --twoslash-popup-shadow: 0 12px 32px rgba(0, 0, 0, 0.48);
}

/* Prevent ancestor overflow from clipping official Twoslash hover popups */
.docs-reference-member-card,
.docs-reference-card-body,
.docs-code.docs-twoslash,
.docs-code.docs-twoslash > pre.shiki {
  overflow: visible !important;
}
.docs-code.docs-twoslash > pre.shiki {
  margin: 0;
  padding: 0.85rem 0;
  background: transparent !important;
  font-size: 0.82rem;
  line-height: 1.6;
}
.docs-code.docs-twoslash > pre.shiki > code {
  display: block;
}
.docs-code.docs-twoslash > pre.shiki > code > .line {
  display: block;
  padding-inline: 1rem;
  border-left: 2.5px solid transparent;
  min-height: 1.3em;
}
.docs-code.docs-twoslash > pre.shiki > code > .line.highlighted {
  background: rgba(59, 130, 246, 0.085);
  border-left-color: var(--bright-blue);
}
html.docs-dark-mode .docs-code.docs-twoslash > pre.shiki > code > .line.highlighted {
  background: rgba(96, 165, 250, 0.13);
}

/* Override style-rich.css: NEVER underline every token when hovering the code block;
 * only highlight the single token under the cursor. */
.twoslash:hover .twoslash-hover {
  border-bottom-color: transparent !important;
}
.twoslash .twoslash-hover {
  border-bottom: 1px solid transparent;
  border-radius: 2px;
  transition: background-color 120ms ease, border-color 120ms ease;
}
.twoslash .twoslash-hover:hover {
  border-bottom-color: var(--bright-blue) !important;
  background: rgba(59, 130, 246, 0.09);
}
html.docs-dark-mode .twoslash .twoslash-hover:hover {
  background: rgba(96, 165, 250, 0.15);
}

.twoslash .twoslash-popup-container {
  z-index: 60 !important;
  border-radius: var(--card-radius) !important;
  width: max-content !important;
  max-width: min(560px, calc(100vw - 32px)) !important;
  min-width: 0;
}
/* Override base .docs-code pre.shiki code flex-column inside Twoslash popups */
.docs-code pre.shiki code.twoslash-popup-code,
.docs-code pre.shiki .twoslash-popup-code pre.shiki code {
  display: block !important;
  font-size: var(--twoslash-code-font-size) !important;
  line-height: 1.48 !important;
}
.twoslash .twoslash-popup-code {
  display: block !important;
  padding: 0.45rem 0.7rem !important;
  white-space: pre-wrap !important;
  word-break: break-word;
  line-height: 1.48;
}
.twoslash .twoslash-popup-code pre,
.twoslash .twoslash-popup-code pre.shiki {
  padding: 0 !important;
  margin: 0 !important;
  background: transparent !important;
  white-space: pre-wrap !important;
  font-size: inherit !important;
  line-height: 1.48 !important;
}
.twoslash .twoslash-popup-code .line {
  display: inline !important;
  padding: 0 !important;
  border: none !important;
  white-space: pre-wrap !important;
}
.twoslash .twoslash-popup-docs {
  padding: 0.48rem 0.7rem !important;
  font-size: 0.76rem;
  line-height: 1.5;
  white-space: normal !important;
}
.twoslash .twoslash-popup-docs p {
  margin: 0;
}
.docs-code pre.shiki .twoslash-popup-docs code {
  display: inline !important;
  font-family: var(--code-font);
  font-size: 0.73rem !important;
  line-height: inherit !important;
  padding: 0.08rem 0.3rem;
  border-radius: 3px;
  background: var(--septenary-contrast);
  color: var(--primary-contrast);
}
.twoslash .twoslash-ref-link {
  color: inherit;
  text-decoration: none;
}
.twoslash .twoslash-ref-link:hover {
  text-decoration: underline;
  text-decoration-color: var(--bright-blue);
  text-underline-offset: 2.5px;
}

/* Prevent Sidebar Brand Truncation at Default 276px Width */
.sb-brand-link {
  gap: 0.38rem;
}
.sb-brand-name {
  font-size: 0.88rem;
}
.sb-ver-badge {
  font-size: 0.66rem;
  padding: 0.08rem 0.34rem;
}

/* Fix Dead 256px Right Gutter when Right TOC Hides at <= 1280px */
@media (max-width: 1280px) {
  .docs-content-layout {
    width: 100% !important;
    max-width: 100% !important;
  }
}

/* Rich Kernel API Catalog Rows */
.kernel-catalog-list {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--senary-contrast);
  border-radius: var(--card-radius);
  overflow: hidden;
  background: var(--octonary-contrast);
}
.kernel-api-row {
  display: grid;
  grid-template-columns: minmax(195px, 240px) 1fr auto;
  gap: 0.85rem;
  align-items: center;
  padding: 0.62rem 0.9rem;
  text-decoration: none;
  color: inherit;
  border-bottom: 1px solid var(--senary-contrast);
  transition: background-color 140ms ease;
}
.kernel-api-row:last-child { border-bottom: none; }
.kernel-api-row:hover { background: var(--septenary-contrast); }
.kernel-api-row-left {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}
.kernel-api-name {
  font-family: var(--code-font);
  font-size: 0.84rem;
  font-weight: 500;
  color: var(--primary-contrast);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.kernel-api-row-desc {
  font-size: 0.82rem;
  color: var(--secondary-contrast);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.kernel-api-row-meta {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.74rem;
  color: var(--quaternary-contrast);
  white-space: nowrap;
}
.kernel-imp-badge {
  font-family: var(--code-font);
  font-size: 0.68rem;
  padding: 0.1rem 0.42rem;
  border-radius: 999px;
  background: var(--septenary-contrast);
  color: var(--bright-blue);
  border: 1px solid var(--senary-contrast);
}
.kernel-usage-detail p {
  margin: 0 0 0.45rem;
  font-size: 0.8rem;
}
@media (max-width: 820px) {
  .kernel-api-row { grid-template-columns: 1fr; gap: 0.25rem; }
  .kernel-api-row-desc { white-space: normal; }
}
`;

/* ---------- Search Index & App JS (FIXED single-arrow sidebar folding!) ---------- */

const SEARCH_INDEX = [
  { t: "@prismshadow/penguin-core/kernel", sub: `Kernel Package · ${KERNEL_EXPORTS.length} exports`, k: "decorator", c: "K", u: "kernel/index.html" },
  ...KERNEL_EXPORTS.map((k) => {
    const bm = kernelBadgeMeta(k.kind);
    return { t: k.kind === "decorator" ? `@${k.name}` : k.name, sub: `Kernel · ${k.sourceFile}`, k: bm.tKey, c: bm.ch, u: `kernel/${k.slug}/` };
  }),
  ...MODULES.map((m) => ({ t: m.name, sub: `Module · ${m.pkg}`, k: "ng_module", c: "M", u: `modules/${m.slug}/` })),
  ...COMPONENTS.map((c) => ({ t: c.name, sub: `Component · ${c.primaryParent ? c.primaryParent.name : c.pkg}`, k: "class", c: "C", u: c.href })),
  ...IFACES.map((i) => ({ t: i.name, sub: `Interface · ${i.pkg}`, k: "interface", c: "I", u: `interfaces/${i.slug}/` })),
  ...HTTP_CONTRIBS.map((g) => ({ t: g.cls, sub: `HTTP · ${g.entries.map((e) => e.prefix).join(" ")}`, k: "pipe", c: "H", u: `apis/http/${g.slug}/` })),
  ...CLI_COMMANDS.map((c) => ({ t: `penguin ${c.name}`, sub: `CLI · ${c.brief.slice(0, 48)}`, k: "function", c: "F", u: `apis/cli/${c.slug}/` })),
  ...SLOTS.map((s) => ({ t: s.key, sub: `Slot · ${s.host} (${s.contributors.length} contributors)`, k: "directive", c: "S", u: `contributions/index.html#${slugOf(s.key)}` })),
];

const APP_JS = `(function(){
  var html = document.documentElement;
  var themeKey = "refs-theme";
  var brandKey = "refs-brand-v2";
  var themeBtn = document.getElementById("theme-toggle");
  var segBtns = Array.from(document.querySelectorAll("[data-set-brand]"));
  var BRANDS = ["frost", "console", "adev"];

  function applyTheme(t) {
    html.classList.remove("docs-light-mode", "docs-dark-mode");
    html.classList.add(t === "dark" ? "docs-dark-mode" : "docs-light-mode");
    html.dataset.theme = t;
    try { localStorage.setItem(themeKey, t); } catch (e) {}
  }
  function applyBrand(b) {
    if (BRANDS.indexOf(b) === -1) b = "frost";
    if (b === "adev") delete html.dataset.brand;
    else html.dataset.brand = b;
    segBtns.forEach(function(btn) {
      btn.classList.toggle("active", btn.getAttribute("data-set-brand") === b);
    });
    try { localStorage.setItem(brandKey, b); } catch (e) {}
  }

  var savedTheme = null, savedBrand = null;
  try {
    savedTheme = localStorage.getItem(themeKey);
    savedBrand = localStorage.getItem(brandKey);
  } catch (e) {}
  var urlParams = new URLSearchParams(window.location.search);
  var queryBrand = urlParams.get("brand");
  var queryTheme = urlParams.get("theme");
  applyTheme(queryTheme || savedTheme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
  applyBrand(queryBrand || savedBrand || "frost");

  requestAnimationFrame(function() { html.classList.add("ui-ready"); });

  if (themeBtn) themeBtn.addEventListener("click", function() {
    applyTheme(html.classList.contains("docs-dark-mode") ? "light" : "dark");
  });
  segBtns.forEach(function(btn) {
    btn.addEventListener("click", function() {
      applyBrand(btn.getAttribute("data-set-brand") || "frost");
    });
  });

  var collapseKey = "refs-sidebar-collapsed";
  var widthKey = "refs-sidebar-width";
  var secSidebar = document.getElementById("secondary-sidebar");
  var collapseBtn = document.getElementById("sidebar-collapse-btn");
  var unfoldBtn = document.getElementById("sidebar-unfold-btn");
  var foldAllBtn = document.getElementById("sidebar-fold-all");
  var resizer = document.getElementById("sidebar-resizer");

  function setSidebarCollapsed(c) {
    html.classList.toggle("sidebar-collapsed", !!c);
    try { localStorage.setItem(collapseKey, c ? "1" : "0"); } catch (e) {}
  }
  try {
    if (localStorage.getItem(collapseKey) === "1") setSidebarCollapsed(true);
    var savedW = localStorage.getItem(widthKey);
    if (savedW) html.style.setProperty("--secondary-nav-width", savedW);
  } catch (e) {}

  if (collapseBtn) collapseBtn.addEventListener("click", function() { setSidebarCollapsed(true); });
  if (unfoldBtn) unfoldBtn.addEventListener("click", function() { setSidebarCollapsed(false); });

  var ctxBtn = document.getElementById("ctx-switcher-btn");
  var ctxMenu = document.getElementById("ctx-switcher-menu");
  if (ctxBtn && ctxMenu) {
    ctxBtn.addEventListener("click", function(e) {
      e.stopPropagation();
      var open = ctxMenu.classList.toggle("open");
      ctxBtn.setAttribute("aria-expanded", open ? "true" : "false");
    });
    document.addEventListener("click", function(e) {
      if (!ctxMenu.contains(e.target) && e.target !== ctxBtn) {
        ctxMenu.classList.remove("open");
        ctxBtn.setAttribute("aria-expanded", "false");
      }
    });
    document.addEventListener("keydown", function(e) {
      if (e.key === "Escape" && ctxMenu.classList.contains("open")) {
        ctxMenu.classList.remove("open");
        ctxBtn.setAttribute("aria-expanded", "false");
      }
    });
  }

  // FIXED: CSS already renders a single chevron via .docs-secondary-nav-header::after
  // and collapses the adjacent .docs-faceted-list when .folded is present.
  var navHeaders = Array.from(document.querySelectorAll(".docs-nav-secondary .docs-secondary-nav-header"));
  navHeaders.forEach(function(hdr) {
    var list = hdr.nextElementSibling;
    if (!list || !list.classList.contains("docs-faceted-list")) return;
    hdr.setAttribute("role", "button");
    hdr.setAttribute("tabindex", "0");
    hdr.setAttribute("aria-expanded", hdr.classList.contains("folded") ? "false" : "true");
    var toggle = function() {
      var folded = hdr.classList.toggle("folded");
      hdr.setAttribute("aria-expanded", folded ? "false" : "true");
    };
    hdr.addEventListener("click", toggle);
    hdr.addEventListener("keydown", function(e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggle();
      }
    });
  });

  if (foldAllBtn && navHeaders.length) {
    foldAllBtn.addEventListener("click", function() {
      var anyOpen = navHeaders.some(function(h) { return !h.classList.contains("folded"); });
      navHeaders.forEach(function(h) {
        h.classList.toggle("folded", anyOpen);
        h.setAttribute("aria-expanded", anyOpen ? "false" : "true");
      });
    });
  }

  if (resizer && secSidebar) {
    var dragging = false;
    resizer.addEventListener("mousedown", function(e) {
      e.preventDefault();
      dragging = true;
      html.classList.add("sidebar-resizing");
      resizer.classList.add("dragging");
      var onMove = function(ev) {
        if (!dragging) return;
        var rect = secSidebar.getBoundingClientRect();
        var w = Math.max(180, Math.min(520, Math.round(ev.clientX - rect.left)));
        html.style.setProperty("--secondary-nav-width", w + "px");
      };
      var onUp = function() {
        if (!dragging) return;
        dragging = false;
        html.classList.remove("sidebar-resizing");
        resizer.classList.remove("dragging");
        var finalW = getComputedStyle(html).getPropertyValue("--secondary-nav-width").trim();
        try { if (finalW) localStorage.setItem(widthKey, finalW); } catch (err) {}
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });
    resizer.addEventListener("dblclick", function() {
      html.style.removeProperty("--secondary-nav-width");
      try { localStorage.removeItem(widthKey); } catch (e) {}
    });
  }

  var activeNav = document.querySelector(".docs-nav-secondary .docs-faceted-list-item-active");
  var secScroll = document.getElementById("sidebar-scroll-area");
  if (activeNav && secScroll) {
    var aRect = activeNav.getBoundingClientRect();
    var sRect = secScroll.getBoundingClientRect();
    if (aRect.bottom > sRect.bottom - 20 || aRect.top < sRect.top + 48) {
      secScroll.scrollTop = Math.max(0, activeNav.offsetTop - 96);
    }
  }

  document.querySelectorAll("button[docs-copy-source-code]").forEach(function(btn) {
    btn.addEventListener("click", function() {
      var explicit = btn.parentElement.getAttribute("data-copy-code");
      var code = btn.parentElement.querySelector("pre code") || btn.parentElement.querySelector("code");
      var text = explicit || (code ? code.innerText : "");
      if (!text) return;
      if (navigator.clipboard) navigator.clipboard.writeText(text);
      btn.classList.add("copied");
      setTimeout(function() { btn.classList.remove("copied"); }, 1400);
    });
  });

  var filterInput = document.querySelector("[data-filter-input]");
  var filterPills = Array.from(document.querySelectorAll("[data-filter-type]"));
  var tierBtns = Array.from(document.querySelectorAll("[data-tier-btn]"));
  if (filterInput || filterPills.length || tierBtns.length) {
    var activeType = "all";
    var activeTier = "public";
    var applyFilter = function() {
      var q = filterInput ? filterInput.value.trim().toLowerCase() : "";
      document.querySelectorAll("[data-item-name]").forEach(function(el) {
        var okType = activeType === "all" || el.getAttribute("data-item-type") === activeType;
        var okQ = !q || el.getAttribute("data-item-name").indexOf(q) !== -1;
        el.style.display = okType && okQ ? "" : "none";
      });
      document.querySelectorAll("[data-section-group]").forEach(function(sec) {
        var any = Array.from(sec.querySelectorAll("[data-item-name]")).some(function(el) { return el.style.display !== "none"; });
        sec.style.display = any ? "" : "none";
        var det = sec.querySelector("details.kernel-group-details");
        if (det) {
          if (q || activeTier === "all") det.open = any;
          else if (activeType !== "all") det.open = any;
          else det.open = false;
        }
      });
    };
    if (filterInput) filterInput.addEventListener("input", applyFilter);
    filterPills.forEach(function(p) {
      p.addEventListener("click", function() {
        filterPills.forEach(function(x) { x.classList.remove("adev-reference-list-type-filter-item-active"); });
        p.classList.add("adev-reference-list-type-filter-item-active");
        activeType = p.getAttribute("data-filter-type");
        applyFilter();
      });
    });
    tierBtns.forEach(function(btn) {
      btn.addEventListener("click", function() {
        tierBtns.forEach(function(b) { b.classList.remove("active"); });
        btn.classList.add("active");
        activeTier = btn.getAttribute("data-tier-btn") || "public";
        applyFilter();
      });
    });
  }

  var tocLinks = Array.from(document.querySelectorAll("#toc-list a"));
  if (tocLinks.length && "IntersectionObserver" in window) {
    var heads = tocLinks.map(function(a) { return document.getElementById(a.getAttribute("href").slice(1)); }).filter(Boolean);
    var setAct = function(id) {
      tocLinks.forEach(function(a) {
        a.classList.toggle("docs-faceted-list-item-active", a.getAttribute("href") === "#" + id);
      });
    };
    if (heads[0]) setAct(heads[0].id);
    var io = new IntersectionObserver(function(entries) {
      entries.forEach(function(e) { if (e.isIntersecting) setAct(e.target.id); });
    }, { rootMargin: "-10% 0px -75% 0px" });
    heads.forEach(function(h) { io.observe(h); });
  }

  var dlg = document.getElementById("search-dialog");
  var sInput = document.getElementById("search-input");
  var sResults = document.getElementById("search-results");
  var sTrigger = document.getElementById("search-trigger");
  var sClose = document.getElementById("search-close");
  var rootPrefix = window.__REFS_ROOT__ || "";
  var INDEX = ${JSON.stringify(SEARCH_INDEX)};

  function renderHits(q) {
    if (!sResults) return;
    var needle = (q || "").trim().toLowerCase();
    var hits = INDEX.filter(function(x) {
      return !needle || x.t.toLowerCase().indexOf(needle) !== -1 || x.sub.toLowerCase().indexOf(needle) !== -1;
    }).slice(0, 32);
    sResults.innerHTML = hits.map(function(h) {
      return '<a class="adev-search-hit" href="' + rootPrefix + h.u + '"><span class="docs-api-item-label type-' + h.k + '">' + h.c + '</span><span>' + h.t + '</span><span class="adev-search-hit-sub">' + h.sub + '</span></a>';
    }).join("");
  }
  function openSearch() {
    if (!dlg) return;
    dlg.showModal();
    renderHits(sInput ? sInput.value : "");
    if (sInput) sInput.focus();
  }
  if (sTrigger) sTrigger.addEventListener("click", openSearch);
  if (sClose) sClose.addEventListener("click", function() { dlg.close(); });
  if (dlg) dlg.addEventListener("click", function(e) { if (e.target === dlg) dlg.close(); });
  if (sInput) sInput.addEventListener("input", function() { renderHits(sInput.value); });
  window.addEventListener("keydown", function(e) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openSearch(); }
    else if (e.key === "/" && document.activeElement && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); openSearch(); }
    else if (e.key === "[" && document.activeElement && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) {
      e.preventDefault();
      setSidebarCollapsed(!html.classList.contains("sidebar-collapsed"));
    }
  });

  // Keep official Twoslash popups inside viewport horizontally when hovering near right edge
  document.querySelectorAll(".twoslash .twoslash-hover").forEach(function(tok) {
    tok.addEventListener("mouseenter", function() {
      var pop = tok.querySelector(".twoslash-popup-container");
      if (!pop) return;
      pop.style.marginLeft = "";
      var r = pop.getBoundingClientRect();
      if (r.right > window.innerWidth - 16) {
        pop.style.marginLeft = Math.round(window.innerWidth - 16 - r.right) + "px";
      } else if (r.left < 16) {
        pop.style.marginLeft = Math.round(16 - r.left) + "px";
      }
    });
  });
})();`;

/* ================================================================== */
/* Emit Static Site                                                    */
/* ================================================================== */

let pageCount = 0;
const emittedLowerPaths = new Set();
const write = (relPath, content) => {
  const lower = relPath.toLowerCase();
  if (emittedLowerPaths.has(lower)) {
    throw new Error(`Case-insensitive static path collision: ${relPath}`);
  }
  emittedLowerPaths.add(lower);
  const f = join(OUT, relPath);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, content);
  if (relPath.endsWith(".html")) pageCount++;
};

write("index.html", `<!doctype html><meta charset="utf-8"><title>PenguinHarness References</title><meta http-equiv="refresh" content="0; url=references/"><p><a href="references/">References</a></p>`);
write("references/index.html", landing());
write("references/assets/style.css", BASE_CSS + "\n" + TWOSLASH_CSS + "\n" + EXTRA_CSS);
write("references/assets/app.js", APP_JS);

// Gold-standard @prismshadow/penguin-core/kernel showcase
write("references/kernel/index.html", kernelOverviewPage());
for (const k of KERNEL_EXPORTS) {
  write(`references/kernel/${k.slug}/index.html`, kernelSymbolPage(k));
}

// Modules & Components
write("references/modules/index.html", modulesIndex());
for (const m of MODULES) write(`references/modules/${m.slug}/index.html`, modulePage(m));
for (const c of COMPONENTS) write(`references/${c.href}index.html`, componentPage(c));

// Interfaces
write("references/interfaces/index.html", ifacesIndex());
for (const it of IFACES) write(`references/interfaces/${it.slug}/index.html`, ifacePage(it));

// APIs
write("references/apis/index.html", apiIndex());
for (const g of HTTP_CONTRIBS) write(`references/apis/http/${g.slug}/index.html`, httpPage(g));
for (const c of CLI_COMMANDS) write(`references/apis/cli/${c.slug}/index.html`, cliPage(c));

// Contribution Slots
write("references/contributions/index.html", contributionsPage());

console.log(`Generated ${pageCount} HTML pages from ${GIT_SHA} (${DATA.git.date.slice(0, 10)})`);
console.log(`Kernel: ${KERNEL_EXPORTS.length} | Modules: ${MODULES.length} | Components: ${COMPONENTS.length} | Interfaces: ${IFACES.length} | HTTP: ${HTTP_CONTRIBS.length} | CLI: ${CLI_COMMANDS.length} | Slots: ${SLOTS.length}`);
console.log(`Output: ${OUT}`);
