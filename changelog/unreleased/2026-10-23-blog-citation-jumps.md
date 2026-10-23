# Jumps within a blog post land on their target and stay in the page

- **Date:** 2026-10-23
- **Type:** fix
- **Scope:** `landing`

[中文版](2026-10-23-blog-citation-jumps.zh.md)

Clicking a citation in a blog post now brings its reference entry into view in Chromium, Firefox and WebKit even while the post's pictures are still loading. Before, a picture that finished loading during the scroll pushed the entry down after the scroll had been aimed: Chromium and Firefox stopped a picture's height or more above the entry, and WebKit (Safari) gave up the scroll and left the reader where they clicked. The same held for back-links, table-of-contents entries and a post opened from a link to one of its anchors. A post opened at an anchor (`…/blog/<post>#fn-3`, `#fnref-3-2`, or a heading) now also lands the way a click does: the entry or citation is highlighted, and it sits clear of the navigation bar instead of about 15 px higher.

## Details

- After a jump the page keeps its target in view whenever the article changes size: for three seconds, and for as long as the post's pictures are still loading, up to fifteen seconds. Scrolling, a key that scrolls, or a press anywhere lets go at once. Going Back or Forward between a post's anchors is left to the browser, which restores the reader's place.
- Once a post opened at an anchor has loaded and finished rising into place, the page asks the browser to follow that anchor again, in place: the history gains no entry, so Back still leaves the post.
- Every jump within a post stays in the page: a link to the same post with a fragment, written as a path or a `penguin.ooo` address (`/blog/<post>#fn-1`), now renders as the bare `#fn-1`, where before it opened a new tab like any other page of the site.
- `node scripts/check-post-jumps.mjs` in `packages/landing` checks a built site in Chromium, Firefox and WebKit: it clicks every citation, back-link and table-of-contents entry of every post that cites sources, with smooth scrolling on and the pictures arriving late, and measures where each target lands once the scroll settles.
- Nothing changes in how posts are written: the citation markup and ids are the ones in [#1252](https://github.com/Prism-Shadow/penguin-harness/pull/1252).
