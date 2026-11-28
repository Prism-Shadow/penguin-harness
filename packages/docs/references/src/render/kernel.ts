import { slugOf } from "../jsdoc.js";
import type { JsDocTagEntry, KernelExport, KernelExportKind } from "../types.js";
import { apiLabel, COPY_BTN, esc, ICONS, kernelBadgeMeta, type RenderContext } from "./context.js";

export interface KernelGroup {
  id: string;
  title: string;
  tier: "public" | "low-level";
  symbols?: ReadonlySet<string>;
  files?: ReadonlySet<string>;
}

const AUTHORING_GROUP: KernelGroup = {
  id: "authoring",
  title: "Authoring",
  tier: "public",
  symbols: new Set([
    "Module",
    "Component",
    "Interface",
    "Use",
    "Provide",
    "Bind",
    "Slot",
    "Opaque",
    "ClassCtx",
    "Contributed",
    "Resources",
  ]),
};

const LOW_LEVEL_GROUP: KernelGroup = {
  id: "low-level",
  title: "Low-level Kernel & Upgrade",
  tier: "low-level",
  files: new Set([
    "boot.ts",
    "upgrade.ts",
    "iface.ts",
    "schema.ts",
    "json.ts",
    "module.ts",
    "decorators.ts",
    "markers.ts",
  ]),
};

export const KERNEL_GROUPS: readonly KernelGroup[] = [
  AUTHORING_GROUP,
  {
    id: "assembly",
    title: "Assembly & Boot",
    tier: "public",
    symbols: new Set([
      "moduleDefOf",
      "bootModules",
      "wire",
      "moduleMetaOf",
      "ModuleDef",
      "ModuleTree",
      "ModuleInstance",
      "ModuleCtx",
      "BootModulesOptions",
      "ModuleBootError",
      "ModuleClass",
      "IfaceClass",
      "ModuleMeta",
      "ComponentMeta",
      "ManifestTable",
      "IfaceTable",
    ]),
  },
  LOW_LEVEL_GROUP,
  {
    id: "verification",
    title: "Manifest & Static Verification",
    tier: "low-level",
    files: new Set(["manifest.ts", "check.ts", "sig.ts", "data.ts"]),
  },
];

interface KernelGrouping {
  groupByName: Map<string, KernelGroup>;
  byGroup: Map<string, KernelExport[]>;
}

function buildKernelGrouping(exports: readonly KernelExport[]): KernelGrouping {
  const groupByName = new Map<string, KernelGroup>();
  const byGroup = new Map<string, KernelExport[]>(KERNEL_GROUPS.map((g) => [g.id, []]));

  const resolveGroup = (k: KernelExport): KernelGroup => {
    const catTag = k.doc.tags.find((t) => t.tag === "category" || t.tag === "group");
    if (catTag?.markdown) {
      const match = KERNEL_GROUPS.find(
        (g) =>
          g.title.toLowerCase() === catTag.markdown.toLowerCase() ||
          g.id === slugOf(catTag.markdown),
      );
      if (match) return match;
    }
    const isInternal = k.doc.tags.some((t) => t.tag === "internal");
    if (!isInternal) {
      for (const g of KERNEL_GROUPS) {
        if (g.symbols?.has(k.name)) return g;
      }
    }
    for (const g of KERNEL_GROUPS) {
      if (g.files?.has(k.sourceFile)) return g;
    }
    return LOW_LEVEL_GROUP;
  };

  for (const k of exports) {
    const g = resolveGroup(k);
    groupByName.set(k.name, g);
    byGroup.get(g.id)?.push(k);
  }
  for (const g of KERNEL_GROUPS) {
    const list = byGroup.get(g.id) ?? [];
    if (g.symbols) {
      const rank = new Map([...g.symbols].map((name, i) => [name, i]));
      list.sort(
        (a, b) =>
          (rank.get(a.name) ?? Number.MAX_SAFE_INTEGER) -
            (rank.get(b.name) ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name),
      );
    } else {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
  }
  return { groupByName, byGroup };
}

function compactSig(sig: string): string {
  const first = sig
    .replace(/^export\s+(?:declare\s+)?/, "")
    .replace(/\s+/g, " ")
    .trim();
  return first.length > 110 ? `${first.slice(0, 109)}…` : first;
}

export function createKernelRenderer(ctx: RenderContext) {
  const exports = ctx.data.kernel.exports;
  const { groupByName, byGroup } = buildKernelGrouping(exports);

  function kernelSidebar(p: string, activeSlug = ""): string {
    const backHeader = activeSlug
      ? `<a class="docs-secondary-back" href="${p}index.html">← @prismshadow/penguin-core/kernel</a>`
      : "";
    const groupsHtml = KERNEL_GROUPS.map((g) => {
      const items = byGroup.get(g.id) ?? [];
      if (items.length === 0) return "";
      const containsActive = Boolean(activeSlug && items.some((e) => e.slug === activeSlug));
      const foldedCls = g.tier === "low-level" && !containsActive ? " folded" : "";
      return `<div class="docs-secondary-nav-header${foldedCls}">${esc(g.title)}</div>
<ul class="docs-navigation-list docs-faceted-list">${items
        .map((e) => {
          const isAct = e.slug === activeSlug;
          const label = e.kind === "decorator" ? `@${e.name}` : e.name;
          return `<li class="docs-faceted-list-item"><a href="${esc(`${p}${e.slug}/`)}"${isAct ? ' class="docs-faceted-list-item-active"' : ""}><span class="docs-faceted-list-item-text">${esc(label)}</span></a></li>`;
        })
        .join("")}</ul>`;
    }).join("");
    return backHeader + groupsHtml;
  }

  function kernelOverviewPage(): string {
    const r = "../";
    const countByKind = (k: KernelExportKind): number => exports.filter((e) => e.kind === k).length;
    const publicCount = KERNEL_GROUPS.filter((g) => g.tier === "public").reduce(
      (n, g) => n + (byGroup.get(g.id)?.length ?? 0),
      0,
    );
    const lowLevelCount = exports.length - publicCount;

    const renderRows = (items: readonly KernelExport[]): string =>
      items
        .map((e) => {
          const bm = kernelBadgeMeta(e.kind);
          const firstDoc = e.doc.summary;
          const summary = firstDoc.length > 140 ? `${firstDoc.slice(0, 140)}…` : firstDoc;
          const sigPreview = compactSig(e.sig);
          return `<a class="kernel-api-row" href="${esc(`${e.slug}/`)}" data-item-type="${esc(e.kind)}" data-item-name="${esc(`${e.name} ${e.sourceFile} ${summary} ${sigPreview}`.toLowerCase())}">
      <div class="kernel-api-row-left">
        ${apiLabel(bm.tKey, bm.ch)}
        <span class="kernel-api-name">${e.kind === "decorator" ? "@" : ""}${esc(e.name)}</span>
        ${e.isTypeOnly ? '<span class="kernel-type-pill">type</span>' : ""}
      </div>
      <div class="kernel-api-row-desc">${summary ? esc(summary) : `<code class="kernel-api-sig">${ctx.hl(sigPreview, null, true)}</code>`}</div>
      <div class="kernel-api-row-meta"><code>${esc(e.sourceFile)}:${e.line}</code></div>
    </a>`;
        })
        .join("");

    const catalogSections = KERNEL_GROUPS.map((g) => {
      const items = byGroup.get(g.id) ?? [];
      if (items.length === 0) return "";
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
  <span class="docs-reference-category">packages/core/src/kernel/index.ts · ${publicCount} core · ${lowLevelCount} low-level · commit ${esc(ctx.gitSha)}</span>
  <div class="docs-reference-title">
    <div><h1>@prismshadow/penguin-core/kernel</h1></div>
    <a class="docs-github-links" target="_blank" rel="noopener" href="${ctx.srcUrl("packages/core/src/kernel/index.ts")}" title="View packages/core/src/kernel/index.ts" aria-label="View source">${ICONS.code}</a>
  </div>
  <div class="kernel-import-bar">
    <span class="kernel-import-label">IMPORT</span>
    <code>${ctx.hl('import { ... } from "@prismshadow/penguin-core/kernel";', null, true)}</code>
    ${COPY_BTN}
  </div>
</header>
<div class="adev-reference-list-filter">
  <div class="adev-reference-list-query-filter">
    <div class="docs-text-field-wrap">
      ${ICONS.search}
      <input type="search" class="docs-text-field" data-filter-input placeholder="Filter all ${exports.length} symbols by name, signature, or description..." autocomplete="off">
    </div>
    <div class="kernel-tier-toggle" role="group" aria-label="Visibility">
      <button type="button" class="kernel-tier-btn active" data-tier-btn="public">Core (${publicCount})</button>
      <button type="button" class="kernel-tier-btn" data-tier-btn="all">All (${exports.length})</button>
    </div>
  </div>
  <p class="adev-reference-list-type-filter-label">Filter by Identifier type</p>
  <ul class="adev-reference-list-type-filter">
    <li class="adev-reference-list-type-filter-item adev-reference-list-type-filter-item-active" role="button" tabindex="0" aria-pressed="true" data-filter-type="all">${apiLabel("block", "B")}<span>All</span></li>
    <li class="adev-reference-list-type-filter-item" role="button" tabindex="0" aria-pressed="false" data-filter-type="decorator">${apiLabel("decorator", "@")}<span class="docs-api-item-label-full">Decorator (${countByKind("decorator")})</span></li>
    <li class="adev-reference-list-type-filter-item" role="button" tabindex="0" aria-pressed="false" data-filter-type="function">${apiLabel("function", "F")}<span class="docs-api-item-label-full">Function (${countByKind("function")})</span></li>
    <li class="adev-reference-list-type-filter-item" role="button" tabindex="0" aria-pressed="false" data-filter-type="class">${apiLabel("class", "C")}<span class="docs-api-item-label-full">Class (${countByKind("class")})</span></li>
    <li class="adev-reference-list-type-filter-item" role="button" tabindex="0" aria-pressed="false" data-filter-type="interface">${apiLabel("interface", "I")}<span class="docs-api-item-label-full">Interface (${countByKind("interface")})</span></li>
    <li class="adev-reference-list-type-filter-item" role="button" tabindex="0" aria-pressed="false" data-filter-type="type_alias">${apiLabel("type_alias", "T")}<span class="docs-api-item-label-full">Type Alias (${countByKind("type_alias")})</span></li>
  </ul>
</div>
${catalogSections}`;

    return ctx.shell({
      r,
      title: "@prismshadow/penguin-core/kernel",
      section: "kernel",
      side: kernelSidebar("", ""),
      body,
      wide: true,
    });
  }

  function kernelSymbolPage(k: KernelExport): string {
    const r = "../../";
    const bm = kernelBadgeMeta(k.kind);
    const group = groupByName.get(k.name) ?? AUTHORING_GROUP;
    const refsOut = ctx.kernelReferences.get(k.name) ?? [];
    const refsIn = ctx.kernelReferencedBy.get(k.name) ?? [];

    // Consume structured TS JSDoc AST tags (zero @param regex!)
    const paramDocMap = new Map<string, string>();
    let returnDoc = "";
    const remainingTags: JsDocTagEntry[] = [];
    for (const t of k.doc.tags) {
      if (t.tag === "param" && t.name) {
        const rootParam = t.name.split(".")[0] ?? t.name;
        if (k.params.some((p) => p.name === rootParam)) {
          paramDocMap.set(rootParam, t.markdown);
          continue;
        }
      } else if ((t.tag === "returns" || t.tag === "return") && k.returnType) {
        returnDoc = t.markdown;
        continue;
      } else if (
        t.tag === "category" ||
        t.tag === "group" ||
        t.tag === "internal" ||
        t.tag === "publicApi"
      ) {
        continue;
      }
      remainingTags.push(t);
    }

    const expandedOptions = k.expandedOptions;
    const optionsHtml = expandedOptions
      ? `<h2 id="options" class="docs-reference-section-heading"><a class="docs-anchor" href="#options">Options</a> <span class="kernel-file-meta">${[
          `<a href="../${esc(expandedOptions.typeSlug)}/"><code>${esc(expandedOptions.typeName)}</code></a>`,
          ...(expandedOptions.defaultVal
            ? [`default <code>${esc(expandedOptions.defaultVal)}</code>`]
            : []),
        ].join(" · ")}</span></h2>
<div class="docs-reference-members">${expandedOptions.members.map((mb) => ctx.memberSection(mb, r, true, expandedOptions.typeName, k.name)).join("")}</div>`
      : "";

    const skipParams =
      k.kind === "decorator" && Boolean(expandedOptions) && k.params.length === 1 && !k.returnType;
    const hasParamsSection = !skipParams && (k.params.length > 0 || Boolean(k.returnType));
    const paramsHeading =
      k.params.length && k.returnType
        ? "Parameters &amp; Return"
        : k.params.length
          ? "Parameters"
          : "Return Type";

    const paramsHtml = !hasParamsSection
      ? ""
      : k.params.length
        ? `<h2 id="parameters" class="docs-reference-section-heading"><a class="docs-anchor" href="#parameters">${paramsHeading}</a></h2>
<div class="docs-reference-members">
${k.params
  .map((p) => {
    const pDesc = paramDocMap.get(p.name) ?? "";
    const hasBody = Boolean(p.defaultVal || pDesc);
    return `<div class="docs-reference-member-card" id="param-${slugOf(p.name)}">
  <header class="docs-reference-card-header">
    <h3><code>${esc(p.name)}${p.optional ? "?" : ""}</code></h3>
    <div class="docs-card-sig"><code>${ctx.hl(p.type, r, true, k.name)}</code></div>
  </header>${
    hasBody
      ? `
  <div class="docs-reference-card-body"><div class="docs-reference-card-item">
    ${pDesc ? `<div class="docs-function-definition">${ctx.renderMarkdown(pDesc, r, true)}</div>` : ""}
    ${p.defaultVal ? `<div class="docs-param-group"><span class="docs-param-keyword">default</span><code>${ctx.hl(p.defaultVal, r, true, k.name)}</code></div>` : ""}
  </div></div>`
      : ""
  }
</div>`;
  })
  .join("")}
${
  k.returnType
    ? `<div class="docs-reference-member-card" id="returns">
  <header class="docs-reference-card-header">
    <h3>@returns</h3>
    <div class="docs-card-sig"><code>${ctx.hl(k.returnType, r, true, k.name)}</code></div>
  </header>${
    returnDoc
      ? `
  <div class="docs-reference-card-body"><div class="docs-reference-card-item"><div class="docs-function-definition">${ctx.renderMarkdown(returnDoc, r, true)}</div></div></div>`
      : ""
  }
</div>`
    : ""
}
</div>`
        : `<h2 id="returns" class="docs-reference-section-heading"><a class="docs-anchor" href="#returns">Return Type</a></h2><p><code>${ctx.hl(k.returnType, r, true, k.name)}</code></p>${returnDoc ? ctx.renderMarkdown(returnDoc, r, true) : ""}`;

    const membersHtml = k.members.length
      ? `<h2 id="members" class="docs-reference-section-heading"><a class="docs-anchor" href="#members">Members (${k.members.length})</a></h2>
<div class="docs-reference-members">${k.members.map((mb) => ctx.memberSection(mb, r, true, k.name, k.name)).join("")}</div>`
      : "";

    const variantsHtml = k.variants.length
      ? `<h2 id="variants" class="docs-reference-section-heading"><a class="docs-anchor" href="#variants">Union Variants (${k.variants.length})</a></h2>
<div class="docs-reference-members">
${k.variants
  .map(
    (v, idx) => `<div class="docs-reference-member-card" id="variant-${idx + 1}">
  <header class="docs-reference-card-header">
    <h3><a class="docs-anchor" href="#variant-${idx + 1}">Variant ${idx + 1}</a></h3>
    <div class="docs-card-sig"><code>${ctx.hl(v.type, r, true, k.name)}</code></div>
  </header>${
    v.doc.markdown || v.doc.tags.length
      ? `
  <div class="docs-reference-card-body"><div class="docs-reference-card-item"><div class="docs-function-definition">${ctx.renderParsedDoc(v.doc, r, true)}</div></div></div>`
      : ""
  }
</div>`,
  )
  .join("")}
</div>`
      : "";

    const xrefsHtml =
      refsOut.length || refsIn.length
        ? `<section class="docs-wiring-box" id="xrefs">
  <div class="docs-wiring-head">
    <h2 class="docs-reference-section-heading"><a class="docs-anchor" href="#xrefs">Type Cross-References</a></h2>
    <span class="docs-wiring-sub">Static signature graph within @prismshadow/penguin-core/kernel</span>
  </div>
  <div class="docs-wiring-grid">
    ${refsOut.length ? `<div class="docs-wiring-row"><span class="docs-param-keyword">references</span><span class="docs-wiring-role">${refsOut.length} kernel ${refsOut.length === 1 ? "type" : "types"}</span><div class="docs-wiring-chips">${refsOut.map((x) => `<a class="docs-wiring-chip" href="../${esc(x.slug)}/">${x.kind === "decorator" ? "@" : ""}${esc(x.name)}</a>`).join("")}</div></div>` : ""}
    ${refsIn.length ? `<div class="docs-wiring-row"><span class="docs-param-keyword">referenced by</span><span class="docs-wiring-role">${refsIn.length} kernel ${refsIn.length === 1 ? "API" : "APIs"}</span><div class="docs-wiring-chips">${refsIn.map((x) => `<a class="docs-wiring-chip" href="../${esc(x.slug)}/">${x.kind === "decorator" ? "@" : ""}${esc(x.name)}</a>`).join("")}</div></div>` : ""}
  </div>
</section>`
        : "";

    const toc = [
      `<li class="docs-faceted-list-item"><a href="#api">Declaration</a></li>`,
      ...(expandedOptions
        ? [
            `<li class="docs-faceted-list-item"><a href="#options">Options (${expandedOptions.members.length})</a></li>`,
            ...expandedOptions.members.map(
              (mb) =>
                `<li class="docs-faceted-list-item docs-toc-item-h3"><a href="#${slugOf(mb.name)}">${esc(mb.name)}</a></li>`,
            ),
          ]
        : []),
      ...(hasParamsSection
        ? [
            `<li class="docs-faceted-list-item"><a href="#${k.params.length ? "parameters" : "returns"}">${paramsHeading}</a></li>`,
          ]
        : []),
      ...(k.members.length
        ? [
            `<li class="docs-faceted-list-item"><a href="#members">Members (${k.members.length})</a></li>`,
            ...k.members
              .slice(0, 20)
              .map(
                (mb) =>
                  `<li class="docs-faceted-list-item docs-toc-item-h3"><a href="#${slugOf(mb.name)}">${esc(mb.name)}</a></li>`,
              ),
          ]
        : []),
      ...(k.variants.length
        ? [
            `<li class="docs-faceted-list-item"><a href="#variants">Union Variants (${k.variants.length})</a></li>`,
          ]
        : []),
      ...(xrefsHtml
        ? [`<li class="docs-faceted-list-item"><a href="#xrefs">Type Cross-References</a></li>`]
        : []),
    ].join("");

    const descHtml = ctx.renderParsedDoc(k.doc, r, true, remainingTags);

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
    <a class="docs-github-links kernel-source-btn" target="_blank" rel="noopener" href="${ctx.srcUrl(k.file, k.line)}" title="View source at ${esc(k.file)}:${k.line}" aria-label="View source on GitHub">${ICONS.code}<span>Source ↗</span></a>
  </div>
  <div class="kernel-import-bar">
    <span class="kernel-import-label">IMPORT</span>
    <code>${ctx.hl(k.importStmt, r, true, k.name)}</code>
    ${COPY_BTN}
  </div>
  ${descHtml ? `<section class="docs-reference-description">${descHtml}</section>` : ""}
</header>
<div class="docs-reference-api-section">
  <h2 id="api" class="docs-reference-section-heading"><a class="docs-anchor" href="#api">Declaration</a></h2>
  ${ctx.codeBlock(k.sig, { file: k.file, line: k.line, r, preferKernel: true, currentSymbol: k.name })}
</div>
${optionsHtml}
${paramsHtml}
${membersHtml}
${variantsHtml}
${xrefsHtml}`;

    return ctx.shell({
      r,
      title: `${k.kind === "decorator" ? "@" : ""}${k.name} · kernel`,
      section: "kernel",
      side: kernelSidebar("../", k.slug),
      toc,
      body,
    });
  }

  return { kernelOverviewPage, kernelSymbolPage };
}
