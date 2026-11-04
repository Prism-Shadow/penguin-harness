# 插件库成为服务端模块树的节点，沙箱后端带上卡片

- **Date:** 2026-11-04
- **Type:** refactor
- **Scope:** `server`, `plugins`
- **PR:** [#1478](https://github.com/Prism-Shadow/penguin-harness/pull/1478)

[English](2026-11-04-plugin-library-module.md)

服务端新增 `PluginLibraryModule`：平台根的子节点，声明插件投放内容的五个数据槽——`cards`、`skills`、`hooks`、`mcpServers`、`workbenches`——并提供 `PluginLibrary`（penguin-harness-design [#421](https://github.com/Prism-Shadow/penguin-harness-design/pull/421)）。插件路由、Agent 服务与 Agent 预装改为经它读取插件库，不再直接调用 core 的读取器。

## 细节

- `PluginLibrary` 列出插件库、按分类分组、按名称查找插件，并回答预装集合、插件的 README 与包所在位置。它每次调用都经 core 的读取器读取磁盘上的包，不启动任何内容插件；已启动的模块以磁盘读取中没有的插件名贡献 Skill、钩子包、MCP Server 或 Workbench 时，服务端记一次日志。
- `PluginLibrary` 与 `PluginLibrarySlots` 以类型从 `@prismshadow/penguin-server/plugin` 导出。
- 四个沙箱后端在沙箱提供者之外各贡献一张卡片：名称、描述、分类、图标与 `preinstall: false`。服务端内置索引中它们的条目与这些卡片相互核对，卡片由测试以各后端构建所用的生成器从源码生成。
- 插件 loader 改用 core 的读取器（`readPluginTable`、`packageEntry`）读取包的表与代码入口，不再保留自己的一份。
