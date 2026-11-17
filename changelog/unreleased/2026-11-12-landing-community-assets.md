# Load the site's media from the community repository's `assets/` directory

- **Date:** 2026-11-12
- **Type:** fix
- **Scope:** `landing`
- **PR:** [#1408](https://github.com/Prism-Shadow/penguin-harness/pull/1408)

[中文版](2026-11-12-landing-community-assets.zh.md)

Pointed the site's blog pictures, its home-page demo videos and its WeChat group link at the community repository's `assets/` directory. That repository had moved `blog-assets/`, `videos/` and `wechat/` under `assets/` in community [#14](https://github.com/Prism-Shadow/penguin-harness-community/pull/14), after which every one of those URLs answered 404; the 55 pictures later uploaded to the old top-level `blog-assets/` moved under `assets/blog-assets/` in community [#69](https://github.com/Prism-Shadow/penguin-harness-community/pull/69).

## Details

- `blogAssetUrl` and `demoVideoUrl` moved from `src/lib/links.ts` to their own `src/lib/community-assets.ts` and resolved to `assets/blog-assets/` and `assets/videos/`. Posts kept writing `/blog-assets/<name>`.
- `scripts/blog-image-sizes.mjs` and `scripts/check-post-jumps.mjs` imported `blogAssetUrl` instead of spelling the directory out themselves.
- The community section and the introduction post linked the WeChat QR code at `assets/wechat/penguin.jpg`, the path the READMEs already used.
- The development and writing skills' authoring and release notes, and the capture scripts' upload instructions, named `assets/blog-assets/` as the place new screenshots go.
