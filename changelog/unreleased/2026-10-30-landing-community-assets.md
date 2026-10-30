# Load the site's media from the community repository's `assets/` directory

- **Date:** 2026-10-30
- **Type:** fix
- **Scope:** `landing`
- **PR:** [#1408](https://github.com/Prism-Shadow/penguin-harness/pull/1408)

[中文版](2026-10-30-landing-community-assets.zh.md)

Pointed the site's blog pictures, its home-page demo videos and its WeChat group link at the community repository's `assets/` directory. That repository had moved `blog-assets/`, `videos/` and `wechat/` under `assets/` in community [#14](https://github.com/Prism-Shadow/penguin-harness-community/pull/14), after which every one of those URLs answered 404.

## Details

- `blogAssetUrl` and `demoVideoUrl` in `src/lib/links.ts` resolved to `assets/blog-assets/` and `assets/videos/`. Posts kept writing `/blog-assets/<name>`.
- The community section and the introduction post linked the WeChat QR code at `assets/wechat/penguin.jpg`, the path the READMEs already used.
- `scripts/blog-image-sizes.mjs` and `scripts/check-post-jumps.mjs` took the same directory, and a test held both to `blogAssetUrl`.
- The development and writing skills' authoring and release notes named `assets/blog-assets/` as the place new screenshots go.
