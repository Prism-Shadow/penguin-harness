# Blog links to a Chinese heading anchor scroll to the heading

- **Date:** 2026-09-17
- **Type:** fix
- **Scope:** `landing`, `docs`
- **PR:** [#772](https://github.com/Prism-Shadow/penguin-harness/pull/772)

[中文版](2026-09-17-blog-cjk-heading-anchors.zh.md)

The landing site's router looked up the element for a URL hash without decoding the hash first. Browsers report the fragment percent-encoded, so a link to a Chinese heading such as `#升级须知` arrived as `#%E5%8D%87…` and matched no element, and the page scrolled to the top instead. The router now decodes the hash before the lookup. A shared deep link, an in-post `[…](#…)` link (which opens in a new tab) and a table-of-contents click all scroll to the Chinese heading, as links to English headings already did.

## Details

- Each site gained a `hashTargetId` helper that turns a hash into an element id. It decodes the hash with `decodeURIComponent` and falls back to the raw fragment when an escape is malformed.
- The landing router's scroll-to-hash effect uses the helper. Before, clicking a Chinese table-of-contents entry in a post opened from the blog list pulled the page back to the top.
- The docs site already decoded the hash, but had no fallback. A malformed escape such as `#100%` threw inside its effects and blanked the whole page. Its router and the doc page's table-of-contents highlight now use the same helper.
- A landing test renders every blog post and fails when an in-page link or a table-of-contents entry names no rendered heading.
