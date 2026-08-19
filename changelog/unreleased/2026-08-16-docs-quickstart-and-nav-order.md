# Docs: Quickstart branches into one page per route, and guides come before the design chapters

- **Date:** 2026-08-16
- **Type:** process
- **Scope:** `docs`
- **PR:** [#303](https://github.com/Prism-Shadow/penguin-harness/pull/303)

[中文版](2026-08-16-docs-quickstart-and-nav-order.zh.md)

The Installation page was folded into Quickstart, which became an overview branching into one sub-page per installation route; the sidebar gained a level of nesting to show them, and the usage guides moved ahead of the core-design chapters.

## Details

- Quickstart became a three-row route table (desktop app / CLI and Web App / SDK — who each is for, and whether a terminal is involved), what the three share, and the one common prerequisite. Each route then carries its own page to a first Task: `quickstart-desktop` (download page and per-platform installers, the one-time unsigned-build unblock, configuring a model, a first message from the Chat page), `quickstart-cli` (the install one-liners plus npm, `penguin web`, `penguin run`, `penguin chat`, and everything the Installation page carried as a trailing installation reference), `quickstart-sdk` (installing `@prismshadow/penguin-core` and a first program annotated line by line).
- `DocsPageDef` gained `children`, the sidebar renders them indented under their parent, and `DOC_SLUGS` flattens each parent immediately ahead of its children so pagination follows the visible order. Nesting stops at one level.
- `content/installation.{zh,en}.md` was deleted and the post-build step stopped emitting its route shell; the links that pointed there — both Introduction pages and the CLI package README — were retargeted at Quickstart.
- `DOCS_NAV` moved `guides` above `design`: Start → Guides → Core Design → Reference.
- The SDK page overrides its pagination successor to Core Interfaces rather than the Web App guide. The override is forward-only: Core Interfaces keeps the predecessor its own position gives it.

## Renderer

- **Tabbed code blocks** (`remark-tabs`) — a fence whose info string carries `tab="Label"` becomes a tab, and adjacent tab fences group into one switcher. Labels ride on the group as JSON rather than on each block, since `mdast-util-to-hast` applies a code node's `hProperties` to the inner `<code>`. Only the selected panel is mounted; arrow keys move between tabs over a roving tabindex.
- **Callouts** (`remark-callout`) — a blockquote whose first line carries a `[!TYPE]` marker becomes a boxed note, a trailing `-` collapsing it and `+` opening it. Collapsing is emitted as native `<details>`/`<summary>`, so it costs no JavaScript and the body stays in the DOM for find-in-page and Copy Markdown. `markdownToSearchText` strips the marker so the type and flag stay out of the search index.
- **Syntax highlighting** (Shiki) — the highlighter is built from `shiki/core` with only the seven grammars this site writes and the JavaScript RegExp engine rather than Oniguruma, which drops the WASM payload; everything sits behind dynamic imports (~30 kB gzip of core plus a grammar only when a page uses one), leaving the entry bundle unchanged. Both themes are baked into one render through dual-theme CSS variables, so the light/dark toggle is a CSS switch. A language with no grammar, or a highlighter that fails to load, leaves the plain `<pre>` in place, carrying the same padding and type. The grammar loaders are written out one static `import()` each, since Vite only rewrites a dynamic import it can read literally.

## Checks

`test/content.test.ts` gained checks that heading anchors are unique within a page, that every `[…](#anchor)` names a heading on its own page, that every `[…](/slug)` names a navigated slug, and that every page paginates to a real page other than itself. The slug check found five dead `/docs/goal-mode` links in `agent-loop`, `server-api` and `web-app.en` that carried the deployed base path the router already supplies; all five now link to `/goal-mode`.
