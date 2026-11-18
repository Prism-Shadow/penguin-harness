# 持久应用存储规范与 `WorkbenchHost.dataPaths()`

- **Date:** 2026-11-17
- **Type:** feature
- **Scope:** `server`, `plugins`, `docs`
- **PR:** [#1579](https://github.com/Prism-Shadow/penguin-harness/pull/1579)

[English](2026-11-17-workbench-files.md)

Workbench 宿主接口新增 `host.dataPaths(opts?)`，返回持久应用存储目录（`{ appId, level, dataDir, cacheDir, stateDir }`，默认为 `agent` 层级下的 `<agentId>.<workbenchId>`，并支持 `project`、`server`、`machine` 层级），同时在 `penguin-plugin` 技能中补充配置与四层持久数据存储规范。

## 细节

- `WorkbenchHost.dataPaths(opts?)` 返回 `<scope>/app/{data,cache,state}/<app_id>` 下的 `{ appId, level, dataDir, cacheDir, stateDir }`，支持 `agent`（默认）、`project`、`server` 与 `machine` 四个层级。
- `SandboxService.confinerFor` 在 `workspace-write` 模式下默认将当前 Agent 的 `agent` 级 `<scope>/app` 存储根目录与会话 `scratchpad` 一并作为可写根目录挂载。
- `penguin-plugin`（`SKILL.md`）新增 `Data and storage` 章节，涵盖 `Adding configuration`（`PluginConfigProvider.groups`、`PluginConfig`、Agent Vault）与 `Managing persistent data`（`agent`、`project`、`server`、`machine` 四层作用域、反向域名 `app_id` 与 `<agentId>.<workbenchId>`，以及默认使用 `agent` 作用域、共享存储须征得用户同意的原则）。
