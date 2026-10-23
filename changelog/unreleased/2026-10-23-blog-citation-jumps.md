# Jumps within a blog post land on their target and stay in the page

- **Date:** 2026-10-23
- **Type:** fix
- **Scope:** `landing`
- **PR:** [#1302](https://github.com/Prism-Shadow/penguin-harness/pull/1302)

[中文版](2026-10-23-blog-citation-jumps.zh.md)

Clicking a citation in a blog post now brings its reference entry into view in Chromium, Firefox and WebKit even while the post's pictures are still loading, and the text no longer moves under the reader as they arrive. A post's pictures used to take up no room until they loaded, so each one that loaded pushed everything below it down. During the scroll to a citation, Chromium and Firefox then stopped a picture's height or more above the entry, and WebKit (Safari) gave up the scroll and left the reader where they clicked. The same held for back-links and table-of-contents entries. A post opened from a link to one of its anchors (`…/blog/<post>#fn-3`, `#fnref-3-2`, or a heading) now also lands the way a click does: the entry or citation is highlighted, and it sits clear of the navigation bar instead of about 15 px higher.

## Details

- Every picture a post shows as a Markdown image has its width and height recorded in `packages/landing/src/lib/blog-image-sizes.json`. The page gives each `<img>` those attributes, so its place is held at the right shape before the picture arrives. `node scripts/blog-image-sizes.mjs` in `packages/landing` records the pictures not listed yet (it downloads each once and reads its header), and the landing tests fail when a post shows a picture whose size is not recorded. A raw `<img>` keeps the `width` and `height` it is written with.
- Once a post opened at an anchor has loaded and finished rising into place, the page asks the browser to follow that anchor again, in place. The history gains no entry, so Back still leaves the post.
- Every jump within a post stays in the page: a link to the same post with a fragment, written as a path or a `penguin.ooo` address (`/blog/<post>#fn-1`), now renders as the bare `#fn-1`. Before, it opened a new tab like any other page of the site.
- `node scripts/check-post-jumps.mjs` in `packages/landing` checks a built site in Chromium, Firefox and WebKit. It runs with smooth scrolling on and the pictures arriving late at their recorded sizes. It clicks every citation, back-link and table-of-contents entry of every post that cites sources, and measures where each target lands once the scroll settles.
- Citations are written the same way as before; the markup and ids are those of [#1252](https://github.com/Prism-Shadow/penguin-harness/pull/1252). A post that adds a Markdown image needs its size recorded.
