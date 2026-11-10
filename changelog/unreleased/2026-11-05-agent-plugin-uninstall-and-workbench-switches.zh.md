# 在服务端从 Agent 整个卸载插件，Workbench 可以启用与禁用

- **Date:** 2026-11-05
- **Type:** feature
- **Scope:** `server`, `core`
- **PR:** [#1496](https://github.com/Prism-Shadow/penguin-harness/pull/1496)

[English](2026-11-05-agent-plugin-uninstall-and-workbench-switches.md)

penguin-harness-design [#430](https://github.com/Prism-Shadow/penguin-harness-design/pull/430)（PRFC-0025）的服务端部分。新接口一次请求卸载插件装进某个 Agent 的全部部件；每个 Workbench 有了自己的启停开关，另有一个 Agent 级的总开关。没有开关标记的目录照旧运行。

## 卸载插件

- `DELETE /api/projects/:p/agents/:a/plugins/:name`（仅 owner）依次删除：安装回执指向该插件的 Workbench、它的 MCP Server（`tools.mcpServers` 中带它名字的条目，一次写入 `system_config.yaml`）、它的钩子包 `agent_state/hooks/<name>/`，以及插件库中它贡献的每个 Skill 名对应的 Skill。已不在插件库的插件不删 Skill。每个 Workbench 的删除与 `DELETE …/workbenches/:id` 相同，因此记入它的版本历史。
- 响应为 `{ removed: { skills, hooks, mcpServers, workbenches } }`。某个部件删除失败时列入 `failed` 并写明原因，其余部件照常删除。该 Agent 没有这个插件的任何部件时返回 404 `plugin_not_installed`。删除完成后该 Agent 的运行时失效一次。
- core 新增 `uninstallPluginMcpServers`，从 `tools.mcpServers` 中删除一个插件的条目，保留用户自己的条目与文件中的注释。

## Workbench 启停

- 空文件 `agent_state/workbenches/<id>/.disabled` 禁用该 Workbench，`agent_state/workbenches/.disabled` 禁用该 Agent 的全部 Workbench；两者都不存在时 Workbench 才运行。`PUT …/workbenches/:id/enabled` 与 `PUT …/workbenches/enabled`（仅 owner，请求体 `{ enabled }`）设置这两个开关，所涉及的 Workbench 立即卸下或加载，Project 的用户收到 `workbench_updated`。
- 禁用的 Workbench 不会因列表、目录监视或请求而加载。卸下时它的订阅随模块树一并结束。它的页面、页面运行时、页面 SDK、API 与重载请求返回 409 `workbench_disabled`；历史、导出与移除照常可用。恢复版本只还原文件、不加载；导入归档写入源码，Workbench 保持未加载。
- `GET …/workbenches` 列出全部 Workbench，每项带自己的 `enabled`，响应顶层带 Agent 级的 `enabled`。禁用的 Workbench 按目录列出：源码的 `revision` 与 `uiRev`，`tabs` 与 `hints` 为空，`error` 与 `loadedAt` 为 `null`。`WorkbenchInfo.loadedAt` 因此改为 `string | null`。
- 标记是点文件，插件更新、重新安装与带 `overwrite` 的归档导入都会保留它；它不进入 Workbench 的版本历史与 zip 导出。
