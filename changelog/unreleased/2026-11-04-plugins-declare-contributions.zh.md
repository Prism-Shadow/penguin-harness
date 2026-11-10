# 内置内容插件以模块贡献声明自己携带的内容

- **Date:** 2026-11-04
- **Type:** refactor
- **Scope:** `plugins`
- **PR:** [#1471](https://github.com/Prism-Shadow/penguin-harness/pull/1471)

[English](2026-11-04-plugins-declare-contributions.md)

`plugins/` 下的 25 个内容插件（没有代码入口的包）各自新增 `src/index.ts`：一个空的 `@Component` 类，其 `contributes` 字面量按插件统一设计（penguin-harness-design [#421](https://github.com/Prism-Shadow/penguin-harness-design/pull/421)）中插件库模块的各个槽，逐槽声明包所携带的内容。这些槽是 `PluginLibraryModule.cards`（卡片）、`.skills`、`.hooks`（钩子包）、`.mcpServers` 与 `.workbenches`。包的 `build` 运行 `scripts/gen-ifaces.mjs`，把这份声明写进它的 `ifaces.json`。

## 细节

- 卡片承载 `penguin` 块的显示字段，改用 camelCase：`title`、`titleZh`、`descriptionZh`、`shortDescription`、`shortDescriptionZh`、`category`、`icon`、`preinstall`、`quickStart`（`prompt`、`promptZh`、`skills`、`goal`）与 `references`。钩子点保留 `hooks.json` 的拼写：`stop`、`pre_tool_use` 与 `user_prompt`。
- 每个 Skill、钩子包与 Workbench 应用都以它在包内的路径点名（`skills/<name>`、`hooks`、`workbenches/<name>`）。贡献 id 以插件名开头：`<plugin>.card`、`<plugin>.skill.<name>`、`<plugin>.hooks`、`<plugin>.workbench.<name>`。
- 每个包新增 `tsconfig.json`、`build` 脚本、为使用装饰器而对 `@prismshadow/penguin-core` 的 devDependency，并把 `ifaces.json` 列入 `files`。
- `penguin` 块与 `skills/`、`hooks/`、`workbenches/` 目录原样保留，插件库照旧读取它们。安装写入 Agent State 的内容不变，日期版本号均未变动。
- 四个沙箱后端未作改动。
