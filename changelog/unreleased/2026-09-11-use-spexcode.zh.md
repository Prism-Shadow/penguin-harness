# 新增 SpexCode 图集插件

- **Date:** 2026-09-11
- **Type:** feature
- **Scope:** `skills`, `core`, `docs`

[English](2026-09-11-use-spexcode.md)

插件库现在包含 `use-spexcode`，无需在本地安装 SpexCode，就能把 SpexCode 图集工作流带到 PenguinHarness。

## 细节

- 插件提供 `atlas` Skill、图标、双语元数据，以及日期版本 `2026.09.10.1`。
- loader 在 core、CLI 与 desktop 的依赖入口中解析它，插件列表和 Skills 文档也将它列在软件开发分类下。
- 插件采用按需安装（`preinstall: false`），因为 Agent 使用时会通过 `npx` 下载 SpexCode。
