# 新增仓库 Skill：文字由网关模型撰写

- **Date:** 2026-10-19
- **Type:** process
- **Scope:** `skills`
- **PR:** [#1216](https://github.com/Prism-Shadow/penguin-harness/pull/1216)

[English](2026-10-19-writing-skill.md)

在 `.agents/skills/` 下新增开发用 Skill `penguin-harness-writing`，记录 penguin.ooo 上的文字怎样产出，博客文章、文档页和 landing 文案都适用。读者能看到的每一个字都由 TokenDance 网关上的模型撰写，每一步单独调用一次 API。Agent 负责调研、整理事实、编写提示词、按模型给出的文字画图、检查和发布。密钥从 `TOKENDANCE_API_KEY` 或 `TOKENDANCE_KEY_FILE` 读取，不进入仓库。

## 细节

- `scripts/prose.mjs` 提供 API 步骤 `outline`、`write`、`translate`、`polish`、`fix`、`review`，默认模型为 `seed-2.1-pro`。
  - 每一步都保存模型的回答和原始响应。回答被截断时报错，触及密钥并发上限时退避重试。
  - 加 `--dry-run` 则只打印拼好的消息，不发起调用。
  - `review` 输出供 `fix` 使用的编号问题清单，不改写原文。
- `reference/profile-<name>.md` 存放随文字类型而变的部分：结构、读者、篇幅，以及 `check` 据以检查的结构规则。目前提供观点文章、文档页和 landing 文案三种，各自配有输出约定。
- 图里的每一个字都来自模型：`write` 为每张图输出一个 figure 块，`translate` 负责翻译。绘制的图以内联 SVG 嵌入正文，`check` 会把其中的文字逐条与 figure 块比对。
- 同一脚本的本地步骤不联网检查文字：
  - `check` 检查 frontmatter、结构、figure 块与图表清单、绘制的图与其 figure 块、Sources 页脚、事实标记与事实文件，并按语言检查禁用词表。
  - `pair` 比对中英两版。
  - `strip` 去掉事实标记并内联绘制的图。
- `prompts/` 存放每个步骤的一对提示词、各类输出约定和可复用的片段。`reference/en-style.md` 与 `reference/zh-style.md` 存放发给模型的文风要求和禁用词表，以及 `check` 用来匹配的模式。
- 开发 Skill 的阅读表和 `reference/authoring.md` 都加了指向新 Skill 的入口。
