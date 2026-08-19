# 开发 skill 记录了博客图片的存放位置

- **Date:** 2026-08-19
- **Type:** process
- **Scope:** `skills`

[English](2026-08-19-dev-skill-blog-media.md)

`.agents/skills/penguin-harness-dev/SKILL.md` 新增「Blog posts, and where their images live」一节，涵盖 `packages/landing/content/blog/` 下成对的文章文件、托管图片的 community 仓库、文章中应当书写的 `/blog-assets/<name>` 路径而非托管地址，以及发布截图的采集方式。

## 细节

- 截图与演示视频存放在同级的 `Prism-Shadow/penguin-harness-community` 仓库的 `blog-assets/` 与 `videos/` 下，而不在本仓库；该节写明了这样安排的原因，以免后来者把它当成疏漏而擅自改回来。
- 文章引用 `/blog-assets/<name>`，由 `packages/landing/src/lib/links.ts` 中的 `blogAssetUrl` 与 `src/pages/blog-post.tsx` 中的 `img` 适配器在渲染时解析。把托管原始 URL 直接粘进文章被明确列为不应做的事。
- 发布截图通过 `packages/web/e2e/` 的 Playwright 测试设施与其 mock 模型驱动，使用独立的 `PENGUIN_HOME`，以 `deviceScaleFactor: 2` 拍摄，并检查画面中是否混入了家目录路径、API key 和 mock 模型的填充文本。
- 该 skill 的 frontmatter 描述现在也把博客文章与截图列入触发场景。
