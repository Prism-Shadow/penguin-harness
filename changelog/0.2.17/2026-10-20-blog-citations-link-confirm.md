# Blog posts cite their sources by number, and links that leave the site ask first

- **Date:** 2026-10-20
- **Type:** feature
- **Scope:** `landing`, `ui`
- **PR:** [#1252](https://github.com/Prism-Shadow/penguin-harness/pull/1252)

[中文版](2026-10-20-blog-citations-link-confirm.zh.md)

Blog posts render GFM footnotes as numbered citations: a raised `[n]` just before a sentence's punctuation jumps to entry n of a References list at the end of the post, several sources cited at one spot read as one group `[1, 2]` with each number its own link, and each entry links back to every place that cites it. Links in a post now open by destination: a `#` link scrolls within the page, a page of this site opens in a new tab as before, and a link to another site first shows the confirmation the home page's catalogue rows use, then opens in a new tab. Bold text in a post, which marks its key sentences, is set a step heavier and darker than the text around it.

## Details

- A post cites with `…a sentence[^1].`, placed before the sentence's punctuation (`文字[^1]。` in Chinese), and defines each source at the end as `[^1]: [Title](https://…)`, or as a bare title when the source has no URL. The list's heading comes from the site's dictionary (References / 参考资料); a post does not write one.
- The ids are ASCII in both languages: `fn-n` for an entry, `fnref-n` and `fnref-n-k` for the places that cite it. A back-link names its destination for screen readers.
- A page of this site is a relative path or an address on `penguin.ooo`, `www.penguin.ooo` or the host the page is served from. Any other host, and a scheme such as `mailto:`, leaves the site.
- `SiteMarkdown` in `@prismshadow/penguin-ui/site` takes `remarkRehypeOptions`, and its `##` and `###` headings keep an id the pipeline already assigned (the footnote list's label, which every citation names) instead of replacing it with a slug. It also sets each run of adjacent citations as one raised group, `[1, 2]`: the brackets and the comma are text, so they survive copying and reader modes; each number keeps its own link, id and description; and a word joiner (U+2060) keeps the group on the line of the text before it, so a group never starts a line.
- `site-prose.css` styles the citations and the list in light and dark, keeps a jump clear of the sticky navigation bar, highlights the entry or citation it lands on, and prints the list with its URLs. In a post, `strong` is set at weight 600 and a step darker than the body text, in light and dark.
