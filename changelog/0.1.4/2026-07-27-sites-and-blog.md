# Sites: blog images move to the community repo

- **Date:** 2026-07-27
- **Type:** process
- **Scope:** `landing`
- **PR:** [#98](https://github.com/Prism-Shadow/penguin-harness/pull/98)

[中文版](2026-07-27-sites-and-blog.zh.md)

Blog images are the one asset class in this repo whose growth has no ceiling. A published post's images are never deleted, and every new post adds a few hundred KB more — bytes that only the marketing site ever renders, carried forever by everyone who clones the repo to build the product. They now live where the demo videos already do, in the sibling `Prism-Shadow/penguin-harness-community` repo, served from raw.githubusercontent with `access-control-allow-origin: *` and a five-minute cache; the seven files this repo carried under `packages/landing/public/blog-assets/` (six post images plus the generated `benchmark-light.svg`) are deleted. The accepted trade is that a GitHub outage degrades the site to missing images, which is cheaper than the bytes.

## Post bodies did not change

Markdown keeps writing the portable `/blog-assets/<name>` path, both in `![alt](…)` images and in the raw `<img src="…">` tags some posts use for theme-swapped screenshots, and the blog renderer resolves it to the hosted URL at render time — a `blogAssetUrl` helper in `src/lib/links.ts` plus an `img` adapter in `src/pages/blog-post.tsx` (rehype-raw has already turned the raw tags into ordinary `img` nodes by the time it is consulted). Keeping the rewrite there rather than in the Markdown leaves one source of truth for the hosting location: post bodies stay readable and diffable, the tests that assert on those paths keep asserting on paths, and moving the host again is a one-line change instead of a sweep over every post. Every other image source — absolute URLs, GitHub user-attachment uploads, site assets such as `/og-cover.png` — is forwarded untouched, pinned by tests alongside the rewrite itself.

## Regenerating images is now a two-step flow

Both capture scripts changed where they write. `scripts/capture-blog-shots.mjs` and `scripts/render-benchmark-svg.mjs` emit into the gitignored staging directory `packages/landing/.blog-assets/` (created on demand, since it does not exist in a fresh clone); the files they produce are then uploaded to the `blog-assets/` directory of the community repo, which is what the posts load from. The README's benchmark SVGs are unaffected — `assets/readme/benchmark-{light,dark}.svg` are still rendered from the same landing-page data and still committed here.
