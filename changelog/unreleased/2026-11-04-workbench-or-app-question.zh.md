# 网页需求先问做成 Workbench 还是独立应用

- **Date:** 2026-11-04
- **Type:** feature
- **Scope:** `skills`
- **PR:** [#1489](https://github.com/Prism-Shadow/penguin-harness/pull/1489)

[English](2026-11-04-workbench-or-app-question.md)

`software-development` 插件的 `web-design` Skill（`2026.11.04.1`）新增一个先问的问题。用户在没有现成项目的 Workspace 中要做网页、Web 应用、看板或工作台，且请求没有说明要做成哪种时，Agent 用一个 A2UI `choice` 块问做成 Workbench 还是独立应用，并结束本轮回复。

## 细节

- 「没有现成项目」指 `CWD` 及其在 Workspace 内的上级目录都没有 `.git`，`CWD` 也没有项目清单（`package.json`、`pyproject.toml`、`Cargo.toml`、`go.mod`、`pom.xml`、`*.csproj`、`Gemfile`、`composer.json`）。有现成项目时直接在其中构建，不询问。
- 四个选项为「是，做成 Workbench」（推荐）、「否，做独立应用」、「每次都是」与「每次都否」，各带一行说明、以卡片呈现；所选项的完整句子作为下一条用户消息回来。
- 选 Workbench 即按 `penguin-plugin` Skill 编写，并沿用本 Skill 的视觉语言；选独立应用即在 Workspace 中新建项目。
- 「每次」的答案先写入用户记忆 `workbench-or-app.md`，并在其 `MEMORY.md` 索引加一行，此后照它构建、不再询问。不能写记忆的会话说明一句，只按本次的选择构建。
