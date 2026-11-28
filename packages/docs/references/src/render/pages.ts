import path from "node:path";
import ts from "typescript";
import { createAnchorAllocator, groupBy, slugOf } from "../jsdoc.js";
import type {
  AreaKind,
  CliCommandRecord,
  ComponentRecord,
  HttpContribRecord,
  IfaceRecord,
  ModuleRecord,
  NodeBase,
} from "../types.js";
import {
  apiLabel,
  esc,
  GLOBE_SVG,
  ICONS,
  kernelBadgeMeta,
  trimModule,
  type RenderContext,
} from "./context.js";

const TS_PRINTER = ts.createPrinter({ removeComments: true });
const SYNTH_SF = ts.createSourceFile(
  "__snippet.ts",
  "",
  ts.ScriptTarget.Latest,
  false,
  ts.ScriptKind.TS,
);

const AREA_TO_IFACE_FILTER: Record<AreaKind, string> = {
  library: "library",
  server: "server",
  web: "web",
  cli: "plugin",
  core: "server",
  plugin: "plugin",
  package: "plugin",
};

/** Exact Hono `mergePath` route-join semantics (`("/", "*")` -> `"/*"`, `("api", "/")` -> `"/api"`, `("/api/", "/")` -> `"/api/"`). */
function mergeHonoPath(prefix: string | undefined, epPath: string): string {
  const normEp = epPath.startsWith("/") ? epPath : `/${epPath}`;
  if (!prefix || prefix === "/") return normEp;
  const normPrefix = prefix.startsWith("/") ? prefix : `/${prefix}`;
  const endsWithSlash = normPrefix.endsWith("/");
  const cleanPrefix = endsWithSlash ? normPrefix.slice(0, -1) : normPrefix;
  if (epPath === "/") return endsWithSlash ? `${cleanPrefix}/` : cleanPrefix;
  if (epPath === "*") return `${cleanPrefix}/*`;
  return `${cleanPrefix}${normEp}`;
}

function renderContributesSection(
  ctx: RenderContext,
  node: NodeBase,
  r: string,
  extraLink = "",
): string {
  const slotKeys = Object.keys(node.contributes);
  if (slotKeys.length === 0) return "";
  return `<h2 id="contributes" class="docs-reference-section-heading"><a class="docs-anchor" href="#contributes">Contributes</a></h2>
${ctx.codeBlock(JSON.stringify(node.contributes, null, 2), { lang: "json", r })}
<p>Target slots: ${slotKeys.map((sk) => `<a href="${r}contributions/index.html#${slugOf(sk)}"><code>${esc(sk)}</code></a>`).join(" · ")}${extraLink}</p>`;
}

function printFallbackBindDecorator(id: string): string {
  const dec = ts.factory.createDecorator(
    ts.factory.createCallExpression(ts.factory.createIdentifier("Bind"), undefined, [
      ts.factory.createStringLiteral(id),
    ]),
  );
  return TS_PRINTER.printNode(ts.EmitHint.Unspecified, dec, SYNTH_SF);
}

export function createPagesRenderer(ctx: RenderContext) {
  const { modules, components, ifaces, kernel, slots, httpContribs, cliCommands } = ctx.data;
  const kernelExports = kernel.exports;

  const groupedModules = () => {
    const res = groupBy(modules, (m) => m.pkg);
    for (const list of res.groups.values()) {
      list.sort((a, b) => (b.isRoot ? 1 : 0) - (a.isRoot ? 1 : 0) || a.name.localeCompare(b.name));
    }
    return res;
  };

  function landing(): string {
    const pm = ctx.moduleByName.get("PlatformModule");
    const totalEndpoints = httpContribs.reduce((n, g) => n + g.endpoints.length, 0);
    const totalHttpEntries = httpContribs.reduce((n, g) => n + g.entries.length, 0);
    const totalMembers = ifaces.reduce((n, i) => n + i.members.length, 0);
    const modDocs = modules.filter((m) => Boolean(m.doc.markdown)).length;
    const compDocs = components.filter((c) => Boolean(c.doc.markdown)).length;
    const ifaceDocs = ifaces.filter((i) => Boolean(i.doc.markdown)).length;
    const memDocs = ifaces.reduce(
      (n, i) => n + i.members.filter((m) => Boolean(m.doc.markdown)).length,
      0,
    );
    const kDocs = kernelExports.filter((e) => Boolean(e.doc.markdown)).length;

    const body = `
<div class="docs-decorative-header">
  <div class="docs-header-content">
    <div class="penguin-hero-kicker"><span class="penguin-hero-kicker-dot"></span>PenguinHarness · API Reference (${esc(ctx.gitSha)})</div>
    <h1>API &amp; Architecture Reference</h1>
    <p>Generated directly from TypeScript AST on <code>origin/main</code> (<code>${esc(ctx.gitSha)}</code>, ${esc(ctx.data.git.shortDate)}).</p>
    <div class="penguin-hero-stats">
      <a class="penguin-stat-chip" href="kernel/index.html"><strong>${kernelExports.length}</strong> Kernel APIs</a>
      <a class="penguin-stat-chip" href="modules/index.html"><strong>${modules.length}</strong> Modules</a>
      <a class="penguin-stat-chip" href="interfaces/index.html"><strong>${ifaces.length}</strong> Interfaces</a>
      <a class="penguin-stat-chip" href="contributions/index.html"><strong>${slots.length}</strong> Slots</a>
    </div>
  </div>
  <div class="penguin-blueprint-card" aria-hidden="true">
    <div class="penguin-blueprint-head"><span class="penguin-hero-kicker-dot"></span>Extracted Graph</div>
    <div class="penguin-blueprint-layer"><span class="penguin-blueprint-label">Kernel</span><code>penguin-core/kernel</code><span>${kernelExports.length} exports</span></div>
    <div class="penguin-blueprint-arrow">↓ @Module &amp; @Component</div>
    <div class="penguin-blueprint-layer"><span class="penguin-blueprint-label">@Module</span><code>PlatformModule</code><span>${pm ? pm.resolvedChildren.length : 0} children</span></div>
    <div class="penguin-blueprint-arrow">↓ @Interface &amp; Slot&lt;D,C&gt;</div>
    <div class="penguin-blueprint-layer"><span class="penguin-blueprint-label">Surfaces</span><code>${ifaces.length} ifaces</code><span>${httpContribs.length} HTTP · ${cliCommands.length} CLI</span></div>
  </div>
  ${GLOBE_SVG}
</div>

<div class="adev-callout-box" id="surfaces">
  <p class="adev-callout-title"><span>✦</span> Reference Surfaces</p>
  <div class="adev-callout-cards">
    <a class="adev-callout-card" href="kernel/index.html">
      <h3>${ICONS.kernel} @prismshadow/penguin-core/kernel (${kernelExports.length} Exports)</h3>
      <p>Full TypeScript API surface across 13 source files: declarations, parameters, members, union variants, static type cross-references, and tested option samples.</p>
    </a>
    <a class="adev-callout-card" href="modules/index.html">
      <h3>${ICONS.modules} Modules (${modules.length} @Module · ${components.length} @Component)</h3>
      <p>Complete module graph across Server, Web, CLI, Libraries, and Plugins, with verbatim <code>@Module</code> / <code>@Component</code> declarations and real <code>children</code> / <code>exports</code>.</p>
    </a>
    <a class="adev-callout-card" href="interfaces/index.html">
      <h3>${ICONS.interfaces} Interfaces (${ifaces.length} Contracts · ${totalMembers} Members)</h3>
      <p>All ${ifaces.length} <code>@Interface()</code> contracts across packages with static <strong>Contract Topology</strong> (<code>@Module</code> / <code>@Provide</code> / <code>@Use</code>) wiring.</p>
    </a>
    <a class="adev-callout-card" href="apis/index.html">
      <h3>${ICONS.apis} External APIs (${httpContribs.length} HTTP · ${cliCommands.length} CLI)</h3>
      <p>${totalHttpEntries} <code>HttpModule.routes</code> contributions (${totalEndpoints} endpoints) and ${cliCommands.length} <code>penguin</code> CLI commands extracted from source.</p>
    </a>
    <a class="adev-callout-card" href="contributions/index.html">
      <h3>${ICONS.contributions} Contribution Slots (${slots.length})</h3>
      <p>All <code>*Slots</code> interfaces across Server, CLI, Messaging, and Web with exact <code>Slot&lt;Data, Code&gt;</code> types and live contributor lists.</p>
    </a>
  </div>
</div>

<div class="docs-alert docs-alert-note" id="coverage">
  <p><strong>Commit:</strong> <code>${esc(ctx.gitSha)}</code> (${esc(ctx.data.git.date)}) — ${esc(ctx.data.git.subject)}</p>
  <p><strong>Source JSDoc coverage:</strong> Kernel <code>${kDocs}/${kernelExports.length}</code> · @Module <code>${modDocs}/${modules.length}</code> · @Component <code>${compDocs}/${components.length}</code> · @Interface <code>${ifaceDocs}/${ifaces.length}</code> · Interface members <code>${memDocs}/${totalMembers}</code>.</p>
</div>`;

    return ctx.shell({ r: "", title: "References", section: "", body, wide: true });
  }

  /* ---------- Modules & Components ---------- */

  function modulesSidebar(p: string, activeSlug: string): string {
    const backHeader = activeSlug
      ? `<a class="docs-secondary-back" href="${p}index.html">← All Modules</a>`
      : "";
    const { order, groups } = groupedModules();
    const item = (m: ModuleRecord): string => {
      const isAct = m.slug === activeSlug;
      const tag = m.isRoot ? `<span class="tag docs-updated-item">Root</span>` : "";
      return `<li class="docs-faceted-list-item"><a href="${p}${m.slug}/"${isAct ? ' class="docs-faceted-list-item-active"' : ""}><span class="docs-faceted-list-item-text">${esc(trimModule(m.name))}</span>${tag}</a></li>`;
    };
    let html =
      backHeader +
      order
        .map(
          (pkg) =>
            `<div class="docs-secondary-nav-header">${esc(pkg)}</div><ul class="docs-navigation-list docs-faceted-list">${(groups.get(pkg) ?? []).map(item).join("")}</ul>`,
        )
        .join("");
    if (ctx.standaloneComponents.length) {
      html += `<div class="docs-secondary-nav-header">Standalone Components</div><ul class="docs-navigation-list docs-faceted-list">${ctx.standaloneComponents
        .map(
          (c) =>
            `<li class="docs-faceted-list-item"><a href="${p}standalone/components/${c.slug}/"${`standalone:${c.slug}` === activeSlug ? ' class="docs-faceted-list-item-active"' : ""}><span class="docs-faceted-list-item-text">${esc(c.name)}</span></a></li>`,
        )
        .join("")}</ul>`;
    }
    return html;
  }

  function modulesIndex(): string {
    const { order, groups } = groupedModules();
    const sections = order
      .map((pkg) => {
        const items = (groups.get(pkg) ?? [])
          .map((m) => {
            const fType = m.isRoot
              ? "root"
              : m.area === "web"
                ? "web"
                : m.area === "plugin"
                  ? "plugin"
                  : m.exports.length
                    ? "exported"
                    : "internal";
            const tKey = m.isRoot ? "block" : m.area === "cli" ? "function" : "ng_module";
            const ch = m.isRoot ? "R" : m.area === "cli" ? "F" : "M";
            return `<li data-item-type="${fType}" data-item-name="${esc(`${m.name} ${m.pkg} ${m.file}`.toLowerCase())}"><a class="adev-api-items-section-item" href="${m.slug}/">${apiLabel(tKey, ch)}<span class="adev-item-title" title="${esc(m.name)}">${esc(m.name)}</span></a></li>`;
          })
          .join("");
        return `<section class="adev-api-items-section" data-section-group>
      <header class="adev-api-items-section-header"><h3 id="p-${slugOf(pkg)}"><a class="adev-api-anchor" href="#p-${slugOf(pkg)}">${esc(pkg)}</a></h3></header>
      <ul class="adev-api-items-section-grid">${items}</ul>
    </section>`;
      })
      .join("\n");

    const standaloneSec = ctx.standaloneComponents.length
      ? `<section class="adev-api-items-section" data-section-group>
      <header class="adev-api-items-section-header"><h3 id="p-standalone"><a class="adev-api-anchor" href="#p-standalone">Standalone &amp; Plugin @Component (${ctx.standaloneComponents.length})</a></h3></header>
      <ul class="adev-api-items-section-grid">${ctx.standaloneComponents.map((c) => `<li data-item-type="plugin" data-item-name="${esc(`${c.name} ${c.pkg} ${c.file}`.toLowerCase())}"><a class="adev-api-items-section-item" href="standalone/components/${c.slug}/">${apiLabel("class", "C")}<span class="adev-item-title" title="${esc(c.name)}">${esc(c.name)}</span></a></li>`).join("")}</ul>
    </section>`
      : "";

    const body = `
<header class="docs-reference-header">
  <div class="docs-reference-title"><div><h1>Modules Reference</h1></div></div>
</header>
${ctx.filterToolbar(
  "Filter modules & components...",
  [
    ["root", "block", "R", "Root Module"],
    ["exported", "ng_module", "M", "Exporting Module"],
    ["internal", "class", "C", "Internal Module"],
    ["web", "directive", "W", "Web Module"],
    ["plugin", "pipe", "P", "Plugin / Standalone"],
  ],
  `${order.length} Packages`,
)}
${sections}
${standaloneSec}`;

    return ctx.shell({
      r: "../",
      title: "Modules Reference",
      section: "modules",
      side: modulesSidebar("", ""),
      body,
      wide: true,
    });
  }

  function modulePage(m: ModuleRecord): string {
    const r = "../../";
    const allocAnchor = createAnchorAllocator();
    const childEntries = m.resolvedChildren.map((ch) => ({
      child: ch,
      id: allocAnchor(ch.name),
    }));
    const childrenHtml = childEntries
      .map(({ child: ch, id }) => {
        const target = ch.target;
        const isMod = ch.kind === "module" && target?.kind === "module";
        const href = isMod
          ? `../${target.slug}/`
          : target?.kind === "component"
            ? `${r}${target.href}`
            : null;
        const badge = isMod ? "@Module" : "@Component";
        const firstDoc = target?.doc.summary;
        const docPreview = firstDoc ? `<p>${esc(firstDoc)}</p>` : "";
        const wiring = target ? ctx.nodeWiringChips(target, r) : "";
        const exportsRow =
          isMod && target.exports.length
            ? `<div class="docs-param-group"><span class="docs-param-keyword">exports</span><span class="docs-param-name">interfaces</span>${target.exports.map((e) => ctx.linkifyType(e, r)).join(" ")}</div>`
            : "";
        return `<div class="docs-reference-member-card" id="${esc(id)}">
  <header class="docs-reference-card-header">
    <h3><a class="docs-anchor" href="#${esc(id)}">${esc(ch.name)}</a></h3>
    <div class="docs-card-sig"><code>${ctx.hl(`${badge} ${ch.name}`, r)}</code></div>
  </header>
  <div class="docs-reference-card-body">
    <div class="docs-reference-card-item">
      <div class="docs-function-definition">${docPreview || '<p class="muted">No JSDoc comment in source.</p>'}${href ? `<p><a class="card-detail-link" href="${href}">View ${isMod ? "module" : "component"} →</a>${target ? ` <span class="muted">(${esc(target.file)}:${target.line})</span>` : ""}</p>` : ""}</div>
      ${exportsRow}
      ${wiring}
    </div>
  </div>
</div>`;
      })
      .join("");

    const wiringHtml = ctx.nodeWiringBlocks(m, r);
    const contribHtml = renderContributesSection(ctx, m, r);
    const parentLinks = m.parents.length
      ? ` · Child of ${m.parents.map((p) => `<a href="../${p.slug}/">${esc(p.name)}</a>`).join(", ")}`
      : "";

    const toc = [
      `<li class="docs-faceted-list-item"><a href="#api">API</a></li>`,
      ...(wiringHtml
        ? [
            `<li class="docs-faceted-list-item"><a href="#wiring">Dependencies &amp; Wiring</a></li>`,
          ]
        : []),
      ...(m.context
        ? [`<li class="docs-faceted-list-item"><a href="#context">Parked Context</a></li>`]
        : []),
      ...(contribHtml
        ? [`<li class="docs-faceted-list-item"><a href="#contributes">Contributes</a></li>`]
        : []),
      `<li class="docs-faceted-list-item"><a href="#children">Children (${childEntries.length})</a></li>`,
      ...childEntries
        .slice(0, 35)
        .map(
          ({ child: c, id }) =>
            `<li class="docs-faceted-list-item docs-toc-item-h3"><a href="#${esc(id)}">${esc(c.name)}</a></li>`,
        ),
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
    <a class="docs-github-links" target="_blank" rel="noopener" href="${esc(ctx.srcUrl(m.file, m.line))}" title="View source at ${esc(m.file)}:${m.line}" aria-label="View source">${ICONS.code}</a>
  </div>
  <section class="docs-reference-description">${m.doc.markdown || m.doc.tags.length ? ctx.renderParsedDoc(m.doc, r) : '<p class="muted">No JSDoc comment in source yet.</p>'}</section>
</header>
<div class="docs-reference-api-section">
  <h2 id="api" class="docs-reference-section-heading"><a class="docs-anchor" href="#api">API</a></h2>
  ${ctx.codeBlock(m.rawDecl, { file: m.file, line: m.line, r })}
</div>
${wiringHtml}
${m.context ? `<h2 id="context" class="docs-reference-section-heading"><a class="docs-anchor" href="#context">Parked Context</a></h2>\n${ctx.codeBlock(`context: ${m.context}`, { r })}` : ""}
${contribHtml}
<h2 id="children" class="docs-reference-section-heading"><a class="docs-anchor" href="#children">Children (${childEntries.length})</a></h2>
<div class="docs-reference-members">${childrenHtml || '<p class="muted">No child modules or components declared in <code>@Module</code>.</p>'}</div>
<h2 id="exports" class="docs-reference-section-heading"><a class="docs-anchor" href="#exports">Exports (${m.exports.length})</a></h2>
<p>${m.exports.length ? m.exports.map((e) => ctx.linkifyType(e, r)).join(" · ") : '<span class="muted">None (module-private).</span>'}</p>`;

    return ctx.shell({
      r,
      title: m.name,
      section: "modules",
      side: modulesSidebar("../", m.slug),
      toc,
      body,
    });
  }

  function componentPage(comp: ComponentRecord): string {
    const r = "../../../../";
    const parent = comp.primaryParent;
    const sideActive = parent ? parent.slug : `standalone:${comp.slug}`;
    const wiringHtml = ctx.nodeWiringBlocks(comp, r);
    const httpRef = ctx.httpByCls.get(comp.name);
    const allocAnchor = createAnchorAllocator();
    const contribHtml = renderContributesSection(
      ctx,
      comp,
      r,
      httpRef
        ? ` · <a href="${r}apis/http/${httpRef.slug}/">View HTTP endpoints (${httpRef.endpoints.length}) →</a>`
        : "",
    );
    const methodEntries = comp.methods.map((mb) => ({ member: mb, id: allocAnchor(mb.name) }));
    const methodsHtml = methodEntries.length
      ? `<h2 id="methods" class="docs-reference-section-heading"><a class="docs-anchor" href="#methods">Methods (${methodEntries.length})</a></h2>
<div class="docs-reference-members">${methodEntries.map(({ member, id }) => ctx.memberSection(member, r, false, null, null, id)).join("")}</div>`
      : "";

    const toc = [
      `<li class="docs-faceted-list-item"><a href="#api">API</a></li>`,
      ...(wiringHtml
        ? [
            `<li class="docs-faceted-list-item"><a href="#wiring">Dependencies &amp; Wiring</a></li>`,
          ]
        : []),
      ...(comp.context
        ? [`<li class="docs-faceted-list-item"><a href="#context">Parked Context</a></li>`]
        : []),
      ...(contribHtml
        ? [`<li class="docs-faceted-list-item"><a href="#contributes">Contributes</a></li>`]
        : []),
      ...(methodEntries.length
        ? [
            `<li class="docs-faceted-list-item"><a href="#methods">Methods (${methodEntries.length})</a></li>`,
          ]
        : []),
    ].join("");

    const parentCrumb = parent
      ? `<a href="../../">${esc(parent.name)}</a>`
      : `<span>${esc(comp.pkg)}</span>`;
    const body = `
<header class="docs-reference-header">
  <span class="docs-reference-category">${parentCrumb} · ${esc(comp.file)}:${comp.line}</span>
  <div class="docs-reference-title">
    <div>
      <h1>${esc(comp.name)}</h1>
      ${apiLabel("class", "C", "component")}
    </div>
    <a class="docs-github-links" target="_blank" rel="noopener" href="${esc(ctx.srcUrl(comp.file, comp.line))}" title="View source at ${esc(comp.file)}:${comp.line}" aria-label="View source">${ICONS.code}</a>
  </div>
  <section class="docs-reference-description">${comp.doc.markdown || comp.doc.tags.length ? ctx.renderParsedDoc(comp.doc, r) : '<p class="muted">No JSDoc comment in source yet.</p>'}</section>
</header>
<div class="docs-reference-api-section">
  <h2 id="api" class="docs-reference-section-heading"><a class="docs-anchor" href="#api">API</a></h2>
  ${ctx.codeBlock(comp.rawDecl, { file: comp.file, line: comp.line, r })}
</div>
${wiringHtml}
${comp.context ? `<h2 id="context" class="docs-reference-section-heading"><a class="docs-anchor" href="#context">Parked Context</a></h2>\n${ctx.codeBlock(`context: ${comp.context}`, { r })}` : ""}
${contribHtml}
${methodsHtml}`;

    return ctx.shell({
      r,
      title: comp.name,
      section: "modules",
      side: modulesSidebar("../../../", sideActive),
      toc,
      body,
    });
  }

  /* ---------- Interfaces ---------- */

  function ifacesSidebar(p: string, activeSlug: string): string {
    const backHeader = activeSlug
      ? `<a class="docs-secondary-back" href="${p}index.html">← All Interfaces</a>`
      : "";
    const { order, groups } = groupBy(ifaces, (it) => it.pkg);
    const kernelLink = `<div class="docs-secondary-nav-header">@prismshadow/penguin-core/kernel</div>
<ul class="docs-navigation-list docs-faceted-list">
  <li class="docs-faceted-list-item"><a href="${p}../kernel/index.html"><span class="docs-faceted-list-item-text">All Kernel Exports</span><span class="tag docs-new-item">${kernelExports.length}</span></a></li>
</ul>`;
    const ifaceHtml = order
      .map(
        (pkg) =>
          `<div class="docs-secondary-nav-header">${esc(pkg)}</div><ul class="docs-navigation-list docs-faceted-list">${(
            groups.get(pkg) ?? []
          )
            .map(
              (it) =>
                `<li class="docs-faceted-list-item"><a href="${p}${it.slug}/"${it.slug === activeSlug ? ' class="docs-faceted-list-item-active"' : ""}><span class="docs-faceted-list-item-text">${esc(it.name)}</span></a></li>`,
            )
            .join("")}</ul>`,
      )
      .join("");
    return backHeader + kernelLink + ifaceHtml;
  }

  function ifacesIndex(): string {
    const { order, groups } = groupBy(ifaces, (it) => it.pkg);
    const gridItem = (
      name: string,
      href: string,
      pkg: string,
      fType: string,
      tKey: string,
      ch: string,
    ): string =>
      `<li data-item-type="${fType}" data-item-name="${esc(`${name} ${pkg}`.toLowerCase())}"><a class="adev-api-items-section-item" href="${href}">${apiLabel(tKey, ch)}<span class="adev-item-title" title="${esc(name)}">${esc(name)}</span></a></li>`;

    const kernelSec = `<section class="adev-api-items-section" data-section-group>
  <header class="adev-api-items-section-header"><h3 id="kernel"><a class="adev-api-anchor" href="../kernel/index.html">@prismshadow/penguin-core/kernel (${kernelExports.length} exports →)</a></h3></header>
  <ul class="adev-api-items-section-grid">${kernelExports
    .slice(0, 18)
    .map((k) => {
      const bm = kernelBadgeMeta(k.kind);
      return gridItem(
        k.kind === "decorator" ? `@${k.name}` : k.name,
        `../kernel/${k.slug}/`,
        "@prismshadow/penguin-core/kernel",
        k.kind === "decorator" ? "decorator" : "kernel",
        bm.tKey,
        bm.ch,
      );
    })
    .join("")}</ul>
</section>`;

    const ifaceSecs = order
      .map((pkg) => {
        const list = groups.get(pkg) ?? [];
        return `<section class="adev-api-items-section" data-section-group>
  <header class="adev-api-items-section-header"><h3 id="pkg-${slugOf(pkg)}"><a class="adev-api-anchor" href="#pkg-${slugOf(pkg)}">${esc(pkg)}</a></h3></header>
  <ul class="adev-api-items-section-grid">${list.map((it) => gridItem(it.name, `${it.slug}/`, it.pkg, AREA_TO_IFACE_FILTER[it.area], "interface", "I")).join("")}</ul>
</section>`;
      })
      .join("\n");

    const body = `
<header class="docs-reference-header">
  <div class="docs-reference-title"><div><h1>Interfaces Reference</h1></div></div>
</header>
${ctx.filterToolbar(
  "Filter interfaces & kernel primitives...",
  [
    ["decorator", "decorator", "@", "Decorator"],
    ["kernel", "type_alias", "T", "Kernel API"],
    ["server", "interface", "I", "Server Interface"],
    ["library", "class", "L", "Library Interface"],
    ["web", "directive", "W", "Web Interface"],
    ["plugin", "pipe", "P", "Plugin Interface"],
  ],
  `${order.length + 1} Packages`,
)}
${kernelSec}
${ifaceSecs}`;

    return ctx.shell({
      r: "../",
      title: "Interfaces Reference",
      section: "interfaces",
      side: ifacesSidebar("", ""),
      body,
      wide: true,
    });
  }

  function ifacePage(it: IfaceRecord): string {
    const r = "../../";
    const wiringHtml = ctx.ifaceWiringSection(it.name, r);
    const allocAnchor = createAnchorAllocator();
    const memberEntries = it.members.map((mb) => {
      const label = mb.name || "member";
      return { member: mb, label, id: allocAnchor(label) };
    });
    const toc = [
      `<li class="docs-faceted-list-item"><a href="#api">API</a></li>`,
      ...(wiringHtml
        ? [`<li class="docs-faceted-list-item"><a href="#wiring">Contract Topology</a></li>`]
        : []),
      `<li class="docs-faceted-list-item"><a href="#members">Members (${memberEntries.length})</a></li>`,
      ...memberEntries.map(
        ({ label, id }) =>
          `<li class="docs-faceted-list-item docs-toc-item-h3"><a href="#${esc(id)}">${esc(label)}</a></li>`,
      ),
    ].join("");

    const body = `
<header class="docs-reference-header">
  <span class="docs-reference-category">${esc(it.pkg)} · ${esc(it.file)}:${it.line}</span>
  <div class="docs-reference-title">
    <div>
      <h1>${esc(it.name)}</h1>
      ${apiLabel("interface", "I", "interface")}
    </div>
    <a class="docs-github-links" target="_blank" rel="noopener" href="${esc(ctx.srcUrl(it.file, it.line))}" title="View source at ${esc(it.file)}:${it.line}" aria-label="View source">${ICONS.code}</a>
  </div>
  <section class="docs-reference-description">
    ${it.doc.markdown || it.doc.tags.length ? ctx.renderParsedDoc(it.doc, r) : '<p class="muted">No JSDoc comment in source yet.</p>'}
  </section>
</header>
<div class="docs-reference-api-section">
  <h2 id="api" class="docs-reference-section-heading"><a class="docs-anchor" href="#api">API</a></h2>
  ${ctx.codeBlock(it.rawDecl, { file: it.file, line: it.line, r })}
</div>
${wiringHtml}
<h2 id="members" class="docs-reference-section-heading"><a class="docs-anchor" href="#members">Members (${memberEntries.length})</a></h2>
<div class="docs-reference-members">
${memberEntries.length ? memberEntries.map(({ member, id }) => ctx.memberSection(member, r, false, null, null, id)).join("") : '<p class="muted">No declared members.</p>'}
</div>`;

    return ctx.shell({
      r,
      title: it.name,
      section: "interfaces",
      side: ifacesSidebar("../", it.slug),
      toc,
      body,
    });
  }

  /* ---------- External APIs (HTTP & CLI) ---------- */

  function apisSidebar(kind: "index" | "http" | "cli", activeSlug = ""): string {
    const cliHref =
      kind === "index"
        ? (c: CliCommandRecord) => `cli/${c.slug}/`
        : kind === "cli"
          ? (c: CliCommandRecord) => `../${c.slug}/`
          : (c: CliCommandRecord) => `../../cli/${c.slug}/`;
    const httpHref =
      kind === "index"
        ? (g: HttpContribRecord) => `http/${g.slug}/`
        : kind === "http"
          ? (g: HttpContribRecord) => `../${g.slug}/`
          : (g: HttpContribRecord) => `../../http/${g.slug}/`;
    const back =
      kind === "index"
        ? ""
        : `<a class="docs-secondary-back" href="../../index.html">← External APIs</a>`;
    return `${back}<div class="docs-secondary-nav-header">HTTP Route Groups (${httpContribs.length})</div>
<ul class="docs-navigation-list docs-faceted-list">${httpContribs.map((g) => `<li class="docs-faceted-list-item"><a href="${httpHref(g)}"${g.slug === activeSlug ? ' class="docs-faceted-list-item-active"' : ""}><span class="docs-faceted-list-item-text">${esc(g.cls)}</span></a></li>`).join("")}</ul>
<div class="docs-secondary-nav-header">CLI Commands (${cliCommands.length})</div>
<ul class="docs-navigation-list docs-faceted-list">${cliCommands.map((c) => `<li class="docs-faceted-list-item"><a href="${cliHref(c)}"${c.slug === activeSlug ? ' class="docs-faceted-list-item-active"' : ""}><span class="docs-faceted-list-item-text">penguin ${esc(c.name)}</span></a></li>`).join("")}</ul>`;
  }

  function apiIndex(): string {
    const httpItem = (g: HttpContribRecord): string =>
      `<li data-item-type="http" data-item-name="${esc(`${g.cls} ${g.entries.map((e) => e.prefix).join(" ")}`.toLowerCase())}"><a class="adev-api-items-section-item" href="http/${g.slug}/">${apiLabel("pipe", "H")}<span class="adev-item-title" title="${esc(g.cls)}">${esc(g.cls)}</span></a></li>`;
    const cliItem = (c: CliCommandRecord): string =>
      `<li data-item-type="cli" data-item-name="${esc(`penguin ${c.name} ${c.brief}`.toLowerCase())}"><a class="adev-api-items-section-item" href="cli/${c.slug}/">${apiLabel("function", "F")}<span class="adev-item-title" title="penguin ${esc(c.name)}">penguin ${esc(c.name)}</span></a></li>`;
    const body = `
<header class="docs-reference-header">
  <div class="docs-reference-title"><div><h1>HTTP &amp; CLI Reference</h1></div></div>
</header>
${ctx.filterToolbar(
  "Filter HTTP routes & CLI commands...",
  [
    ["http", "pipe", "H", "HTTP Route Group"],
    ["cli", "function", "F", "CLI Command"],
  ],
  "HttpModule.routes & CLI",
)}
<section class="adev-api-items-section" data-section-group>
  <header class="adev-api-items-section-header"><h3 id="http"><a class="adev-api-anchor" href="#http">HttpModule.routes (${httpContribs.length})</a></h3></header>
  <ul class="adev-api-items-section-grid">${httpContribs.map(httpItem).join("")}</ul>
</section>
<section class="adev-api-items-section" data-section-group>
  <header class="adev-api-items-section-header"><h3 id="cli"><a class="adev-api-anchor" href="#cli">CLI Commands (${cliCommands.length})</a></h3></header>
  <ul class="adev-api-items-section-grid">${cliCommands.map(cliItem).join("")}</ul>
</section>`;
    return ctx.shell({
      r: "../",
      title: "External APIs",
      section: "apis",
      side: apisSidebar("index"),
      body,
      wide: true,
    });
  }

  function httpPage(g: HttpContribRecord): string {
    const r = "../../../";
    const showAuthBadge =
      g.entries.length > 1 || new Set(g.endpoints.map((e) => e.auth).filter(Boolean)).size > 1;
    const eps = g.endpoints.length
      ? `<h2 id="endpoints" class="docs-reference-section-heading"><a class="docs-anchor" href="#endpoints">Endpoints (${g.endpoints.length})</a></h2>
<div class="docs-reference-members">
${g.endpoints
  .map((e, idx) => {
    const file = e.file ?? g.file;
    const displayPath = mergeHonoPath(e.mountPrefix, e.path);
    const idPill =
      e.entryId && g.entries.length > 1
        ? ` <span class="kernel-type-pill">${esc(e.entryId)}</span>`
        : "";
    const authPill =
      showAuthBadge && e.auth ? ` <span class="kernel-type-pill">auth: ${esc(e.auth)}</span>` : "";
    return `<div class="docs-reference-member-card" id="ep-${idx}">
  <header class="docs-reference-card-header">
    <div class="docs-card-title-group"><span class="method m-${e.method.toLowerCase()}">${esc(e.method)}</span><h3><code>${esc(displayPath)}</code></h3>${idPill}${authPill}</div>
    <div class="docs-card-sig">${e.entryId && g.entries.length === 1 ? `<code>${esc(e.entryId)}</code> · ` : ""}<a href="${esc(ctx.srcUrl(file, e.line))}" target="_blank" rel="noopener"><code>${esc(path.posix.basename(file))}:${e.line}</code></a></div>
  </header>
</div>`;
  })
  .join("")}
</div>`
      : '<p class="muted">No statically resolved Hono route registrations for this route group (mounted dynamically or delegated to a shared helper).</p>';

    const toc = `
    <li class="docs-faceted-list-item"><a href="#contrib">HttpModule.routes</a></li>
    <li class="docs-faceted-list-item"><a href="#binds">@Bind Implementation</a></li>
    ${g.endpoints.length ? `<li class="docs-faceted-list-item"><a href="#endpoints">Endpoints (${g.endpoints.length})</a></li>` : ""}`;

    const contribObj = {
      "HttpModule.routes": g.entries.map((e) => ({
        id: e.id,
        prefix: e.prefix,
        auth: e.auth,
        order: e.order,
        ...(e.origin ? { origin: e.origin } : {}),
      })),
    };
    const contribCode = `contributes: ${JSON.stringify(contribObj, null, 2)}`;

    const body = `
<header class="docs-reference-header">
  <span class="docs-reference-category"><a href="${r}${g.nodeHref}">${esc(g.cls)}</a> · ${esc(g.file)}:${g.line}</span>
  <div class="docs-reference-title">
    <div>
      <h1>${esc(g.cls)}</h1>
      ${apiLabel("pipe", "H", "http-routes")}
    </div>
    <a class="docs-github-links" target="_blank" rel="noopener" href="${esc(ctx.srcUrl(g.file, g.line))}" title="View source" aria-label="View source">${ICONS.code}</a>
  </div>
  ${g.doc.markdown || g.doc.tags.length ? `<section class="docs-reference-description">${ctx.renderParsedDoc(g.doc, r)}</section>` : ""}
</header>
<div class="docs-reference-api-section">
  <h2 id="contrib" class="docs-reference-section-heading"><a class="docs-anchor" href="#contrib">API</a></h2>
  ${ctx.codeBlock(contribCode, { file: g.file, line: g.line, r })}
</div>
<h2 id="binds" class="docs-reference-section-heading"><a class="docs-anchor" href="#binds">Code Half (@Bind)</a></h2>
<p>${g.binds.length ? g.binds.map((b) => `<code>${esc(b.raw)}</code>`).join(" · ") : g.entries.map((e) => `<code>${esc(printFallbackBindDecorator(e.id))}</code>`).join(" · ")}</p>
${eps}`;

    return ctx.shell({
      r,
      title: g.cls,
      section: "apis",
      side: apisSidebar("http", g.slug),
      toc,
      body,
    });
  }

  function cliPage(c: CliCommandRecord): string {
    const r = "../../../";
    const cmdPrefix = c.name.split(".").join(" ");
    const subHtml = c.subcommands.length
      ? `<h2 id="subcommands" class="docs-reference-section-heading"><a class="docs-anchor" href="#subcommands">Subcommands (${c.subcommands.length})</a></h2>
${ctx.codeBlock(c.subcommands.map((sub) => `penguin ${sub}`).join("\n"), { lang: "bash", r })}`
      : "";
    const optHtml = c.options.length
      ? `<h2 id="options" class="docs-reference-section-heading"><a class="docs-anchor" href="#options">Options (${c.options.length})</a></h2>
<div class="docs-reference-members">
${c.options
  .map(
    (o, idx) => `<div class="docs-reference-member-card" id="opt-${idx}">
  <header class="docs-reference-card-header">
    <h3><code>${esc(o.flag)}</code>${o.required ? ' <span class="kernel-type-pill">required</span>' : ""}</h3>
    ${o.command && o.command !== cmdPrefix ? `<div class="docs-card-sig"><code>penguin ${esc(o.command)}</code></div>` : ""}
  </header>
  ${o.desc ? `<div class="docs-reference-card-body"><div class="docs-reference-card-item"><div class="docs-function-definition"><p>${esc(o.desc)}</p></div></div></div>` : ""}
</div>`,
  )
  .join("")}
</div>`
      : "";
    const toc = [
      ...(c.subcommands.length
        ? [`<li class="docs-faceted-list-item"><a href="#subcommands">Subcommands</a></li>`]
        : []),
      ...(c.options.length
        ? [`<li class="docs-faceted-list-item"><a href="#options">Options</a></li>`]
        : []),
      ...(c.doc.markdown || c.doc.tags.length
        ? [`<li class="docs-faceted-list-item"><a href="#doc">Source Doc</a></li>`]
        : []),
    ].join("");

    const body = `
<header class="docs-reference-header">
  <span class="docs-reference-category">${esc(c.pkg)}${c.nodeHref && c.cls ? ` · <a href="${r}${c.nodeHref}">${esc(c.cls)}</a>` : ""} · ${esc(c.file)}:${c.line}</span>
  <div class="docs-reference-title">
    <div>
      <h1>penguin ${esc(c.name)}</h1>
      ${apiLabel("function", "F", "cli-command")}
    </div>
    <a class="docs-github-links" target="_blank" rel="noopener" href="${esc(ctx.srcUrl(c.file, c.line))}" title="View source" aria-label="View source">${ICONS.code}</a>
  </div>
  ${c.brief ? `<section class="docs-reference-description"><p>${esc(c.brief)}${c.briefZh && c.briefZh !== c.brief ? `<br><span class="muted">${esc(c.briefZh)}</span>` : ""}</p></section>` : ""}
</header>
<p class="muted">Registered via <code>${esc(c.slot)}</code>${c.id ? ` (id: <code>${esc(c.id)}</code>)` : ""}.</p>
${subHtml}
${optHtml}
${c.doc.markdown || c.doc.tags.length ? `<h2 id="doc" class="docs-reference-section-heading"><a class="docs-anchor" href="#doc">Source Doc</a></h2>${ctx.renderParsedDoc(c.doc, r)}` : ""}`;

    return ctx.shell({
      r,
      title: `penguin ${c.name}`,
      section: "apis",
      side: apisSidebar("cli", c.slug),
      toc,
      body,
    });
  }

  /* ---------- Contribution Slots ---------- */

  function contributionsPage(): string {
    const r = "../";
    const { order: pkgOrder, groups: byPkg } = groupBy(slots, (s) => s.pkg);
    const toc = pkgOrder
      .map(
        (pkg) =>
          `<li class="docs-faceted-list-item"><a href="#pkg-${slugOf(pkg)}">${esc(pkg)} (${(byPkg.get(pkg) ?? []).length})</a></li>`,
      )
      .join("");
    const side = pkgOrder
      .map(
        (pkg) =>
          `<div class="docs-secondary-nav-header">${esc(pkg)}</div><ul class="docs-navigation-list docs-faceted-list">${(
            byPkg.get(pkg) ?? []
          )
            .map(
              (s) =>
                `<li class="docs-faceted-list-item"><a href="#${slugOf(s.key)}"><span class="docs-faceted-list-item-text">${esc(s.key)}</span>${s.contributors.length ? `<span class="tag">${s.contributors.length}</span>` : ""}</a></li>`,
            )
            .join("")}</ul>`,
      )
      .join("");

    const sectionsHtml = pkgOrder
      .map((pkg) => {
        const list = byPkg.get(pkg) ?? [];
        return `<h2 id="pkg-${slugOf(pkg)}" class="docs-reference-section-heading"><a class="docs-anchor" href="#pkg-${slugOf(pkg)}">${esc(pkg)} (${list.length})</a></h2>
<div class="docs-reference-members">
${list
  .map(
    (s) => `<div class="docs-reference-member-card" id="${slugOf(s.key)}">
  <header class="docs-reference-card-header">
    <h3><a class="docs-anchor" href="#${slugOf(s.key)}">${esc(s.key)}</a></h3>
    <div class="docs-card-sig">${s.hostHref ? `<a href="${r}${s.hostHref}"><code>${esc(s.host)}</code></a>` : `<code>${esc(s.host)}</code>`} · <a href="${esc(ctx.srcUrl(s.file, s.line))}" target="_blank" rel="noopener"><code>${esc(path.posix.basename(s.file))}:${s.line}</code></a></div>
  </header>
  <div class="docs-reference-card-body">
    <div class="docs-reference-card-item">
      ${s.doc.markdown || s.doc.tags.length ? `<div class="docs-function-definition">${ctx.renderParsedDoc(s.doc, r)}</div>` : ""}
      <div class="docs-param-group"><span class="docs-param-keyword">@data</span><span class="docs-param-name">manifest</span><code>${ctx.hl(s.data, r)}</code></div>
      <div class="docs-return-type"><span class="docs-param-keyword">@code</span><code>${s.code ? ctx.hl(s.code, r) : '<span class="muted">data-only (never)</span>'}</code></div>
      ${s.contributors.length ? `<div class="docs-param-group"><span class="docs-param-keyword">contributors</span><span class="docs-param-name">(${s.contributors.length})</span><div class="docs-wiring-chips">${s.contributors.map((c) => `<a class="docs-wiring-chip" href="${r}${c.href}">${esc(c.name)}${c.count > 1 ? ` ×${c.count}` : ""}</a>`).join("")}</div></div>` : ""}
    </div>
  </div>
</div>`,
  )
  .join("")}
</div>`;
      })
      .join("\n");

    const slotSlug = ctx.kernelByName.get("Slot")?.slug ?? "Slot";
    const body = `
<header class="docs-reference-header">
  <span class="docs-reference-category"><a href="../kernel/${slotSlug}/">@prismshadow/penguin-core/kernel · Slot&lt;Data, Code&gt;</a></span>
  <div class="docs-reference-title"><div><h1>Contribution Slots</h1>${apiLabel("directive", "D", `${slots.length} slots`)}</div></div>
  <p>Extracted from all <code>*Slots</code> companion interfaces and live <code>contributes</code> declarations across the repository (<code>${esc(ctx.gitSha)}</code>).</p>
</header>
${sectionsHtml}`;

    return ctx.shell({
      r,
      title: "Contribution Slots",
      section: "contributions",
      side,
      toc,
      body,
    });
  }

  return {
    landing,
    modulesIndex,
    modulePage,
    componentPage,
    ifacesIndex,
    ifacePage,
    apiIndex,
    httpPage,
    cliPage,
    contributionsPage,
  };
}
