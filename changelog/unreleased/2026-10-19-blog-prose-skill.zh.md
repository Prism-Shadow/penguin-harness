# 新增仓库 Skill：博客文章由网关模型撰写

- **Date:** 2026-10-19
- **Type:** process
- **Scope:** `skills`

[English](2026-10-19-blog-prose-skill.md)

在 `.agents/skills/` 下新增开发用 Skill `penguin-harness-blog`，记录 penguin.ooo 博客文章的生产方式：读者能看到的每一个字都由 TokenDance 网关上的模型撰写，每一步单独调用一次 API；Agent 负责调研、整理事实、编写提示词、画图、检查和发布。密钥从 `TOKENDANCE_API_KEY` 或 `TOKENDANCE_KEY_FILE` 读取，不进入仓库。

## 细节

- `scripts/blog-prose.mjs` 提供 API 步骤 `outline`、`write`、`translate`、`polish`、`fix`、`review`，默认模型为 `seed-2.1-pro`。每一步都保存模型的回答和原始响应；回答被截断时报错；触及密钥并发上限时退避重试。加 `--dry-run` 则只打印拼好的消息。
- 同一脚本的本地步骤不联网检查草稿。`check` 检查 frontmatter、结构、图片路径、Sources 页脚，核对事实标记与事实文件、figure 块与图表清单、绘制的图源与其 figure 块，并按语言检查禁用词表。`pair` 比对中英两版，`strip` 去掉事实标记并把 figure 块转成图片行。
- 图里的每一个字都来自模型：`write` 为每张图输出一个 figure 块，`translate` 负责翻译。
- `prompts/` 存放每个步骤的一对提示词、共用的 Markdown 约定和可复用的片段。`reference/en-style.md` 与 `reference/zh-style.md` 存放发给模型的文风要求和禁用词表，以及 `check` 用来匹配的模式。
- 开发 Skill 的阅读表和 `reference/authoring.md` 都加了指向新 Skill 的入口。
