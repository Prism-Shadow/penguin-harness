# The landing page and the docs share their page components through the UI package

- **Date:** 2026-10-15
- **Type:** refactor
- **Scope:** `ui`, `landing`, `docs`, `ui-gallery`, `skills`
- **PR:** [#1161](https://github.com/Prism-Shadow/penguin-harness/pull/1161)

[中文版](2026-10-15-site-ui-unify.zh.md)

The components the landing page and the docs each kept a copy of moved into `@prismshadow/penguin-ui/site`, beside the header that [#1142](https://github.com/Prism-Shadow/penguin-harness/pull/1142) moved there: the footer, the code card and copy button, the blog's category pills, the external-link confirmation, the docs sidebar and search dialog, an article's "on this page" column, the article prose (`SiteMarkdown`, with the docs' tab groups and callouts), the theme and language providers on the shared `penguin-site.*` keys, and the scroll on a route change. The two sites kept only their content, routing and words, and the gallery reads the same preference keys from the package.

## Details

- `site.css` carries the components' look and the article prose on its own palette, so they pass the package's de-slop rules and look the same in the gallery under any app theme. A site's Tailwind entry also imports the new `site-page.css`: the `dark` variant, the brand scale, the neutral dark ramp and the body defaults.
- Fenced code is highlighted by the package's own engine (`highlightSiteCode`), which gained PowerShell (`powershell`, `ps`, `ps1`) and reads `jsonl` fences as JSON — in the Web App's code blocks too. The docs no longer depend on `shiki`, `react-markdown` or `remark-gfm` directly.
- The gallery has a 公开站点 / Public site page showing every shared site component.
- What visitors see differently:
  - The docs' dark mode uses the landing page's neutral dark (a #141414 canvas) instead of pure black, so the page and its header are one surface.
  - A blog post's code blocks are highlighted and set like the docs' (13 px on a 24 px line). Its "on this page" column stays inside the viewport, scrolling when long, and keeps the entry a reader clicked marked.
  - A copy button keeps its label after a copy: its icon turns to a check and a screen reader hears that the text was copied, as in the Web App.
  - The copy, arrow, search, terminal, link and external-link glyphs come from the shared icon registry, as the header's already did.
