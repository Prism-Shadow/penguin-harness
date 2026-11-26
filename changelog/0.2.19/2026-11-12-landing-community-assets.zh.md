# 网站媒体改从 Community 仓库的 `assets/` 目录加载

- **Date:** 2026-11-12
- **Type:** fix
- **Scope:** `landing`
- **PR:** [#1408](https://github.com/Prism-Shadow/penguin-harness/pull/1408)

[English](2026-11-12-landing-community-assets.md)

网站的博客配图、首页演示视频和微信群链接改为指向 Community 仓库的 `assets/` 目录。该仓库在 community [#14](https://github.com/Prism-Shadow/penguin-harness-community/pull/14) 中把 `blog-assets/`、`videos/` 和 `wechat/` 移到了 `assets/` 下，此后这些地址全部返回 404；之后又上传到旧的顶层 `blog-assets/` 的 55 张配图，在 community [#69](https://github.com/Prism-Shadow/penguin-harness-community/pull/69) 中移到了 `assets/blog-assets/`。

## 细节

- `blogAssetUrl` 和 `demoVideoUrl` 从 `src/lib/links.ts` 移入单独的 `src/lib/community-assets.ts`，解析到 `assets/blog-assets/` 和 `assets/videos/`。文章仍写 `/blog-assets/<name>`。
- `scripts/blog-image-sizes.mjs` 和 `scripts/check-post-jumps.mjs` 改为导入 `blogAssetUrl`，不再各自写死目录。
- 社区区块和介绍文章里的微信群二维码链接改为 `assets/wechat/penguin.jpg`，与 README 已用的路径一致。
- 开发与写作 skill 的撰写、发布说明，以及截图脚本里的上传说明，把 `assets/blog-assets/` 写为新截图的存放位置。
