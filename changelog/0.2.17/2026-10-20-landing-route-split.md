# The landing home page no longer downloads the blog

- **Date:** 2026-10-20
- **Type:** fix
- **Scope:** `landing`
- **PR:** [#1231](https://github.com/Prism-Shadow/penguin-harness/pull/1231)

[中文版](2026-10-20-landing-route-split.zh.md)

The landing site's main script stopped carrying the blog. The home page, the blog list and the download page read an index of the posts' frontmatter built at build time; a post's Markdown, and the code that renders it, are fetched when the post is opened. The demo videos' posters load when a video comes near the screen instead of with the page.

## Details

- A Vite plugin (`scripts/frontmatter-plugin.ts`, registered in the Vite and vitest configs) turns `<post>.md?frontmatter` into the post's frontmatter record at build time. Each post body is a file of its own.
- The post page is a route loaded on demand. Opened directly, it fetches its body alongside its code and shows header and body together, holding a screen of empty space meanwhile so the footer does not jump. The post's other language is fetched next, so switching language keeps the reading position. A link to a heading (`/blog/<slug>#<id>`) scrolls to it once the body is in place. The blog list fetches the post page's code ahead of a click.
- When a file named by an earlier deploy is gone, the page reloads once instead of staying blank.

## Load time

Measured 2026-10-20 on a Linux test machine: local builds of `origin/main` (172c9e4c4) and of this change, served by a static server that behaves like GitHub Pages (gzip, `max-age=600`), loaded cold in Playwright Chromium with DevTools network throttling and a 4× CPU slowdown. Sizes are bytes on the wire; times are medians of two or three runs.

|                                                            |  Before |  After |
| ---------------------------------------------------------- | ------: | -----: |
| Main script                                                |  508 KB | 171 KB |
| Home page bytes before the hero's live frame               |  595 KB | 193 KB |
| Home page first paint, desktop, Slow 4G                    |  3.54 s | 1.75 s |
| Home page first paint, phone, Slow 4G                      |  3.53 s | 1.73 s |
| Home page first paint, desktop, 3G                         | 12.06 s | 5.13 s |
| A post opened directly, article rendered, desktop, Slow 4G |  3.24 s | 2.34 s |
