# Workbench 的数据文件夹，与其 Agent 共用

- **Date:** 2026-11-17
- **Type:** feature
- **Scope:** `core`, `server`, `plugins`, `docs`
- **PR:** [#1579](https://github.com/Prism-Shadow/penguin-harness/pull/1579)

[English](2026-11-17-workbench-data.md)

每个工作台有了自己的数据文件夹 `<agentDir>/app/data/<workbenchId>/`，与 Agent State 并列。处理器经带类型的宿主成员读写它，Agent 用自己的文件工具编辑同一批文件。该文件夹随「含其数据」进入 Agent 导出，并随工作台一并删除。新建的 Project、Agent、Skill、钩子包与工作台 id 不得再取 Windows 保留的名称；磁盘上已有的 id 照常可以打开。

## 细节

- `WorkbenchHost` 新增读写数据文件夹的 `listFiles()`、`readFile(path)`、`writeFile(path, data)`、`removeFile(path)` 与 `filePath(path?)`，以及返回 `{ dataDir, cacheDir }` 的 `dataPaths()`，均渲染进各工作台的 `.harness/plugin.d.ts`。路径不得越出该文件夹，从 `<agentDir>/app` 往下任何一级都不跟随链接；单个文件至多 50 MB，一次列表至多 5,000 个文件，写入先暂存再改名。`dataPaths()` 与 `filePath()` 交出路径前先建好数据文件夹。
- 在 `workspace-write` 沙盒下，`<agentDir>/app` 作为真实目录存在后，Agent 的命令可以写入它；启动命令时从不创建它。
- Agent 导出的「含其数据」（`workbenchData`）带上随包各工作台的 `app/data/<id>/`，从不带缓存。覆盖导入时，包里带了数据的工作台替换其数据文件夹，没带的保留现有的；新 State 里已没有的工作台，其数据与缓存一并删除。导入前的备份包含它替换或删除的每个数据文件夹。
- 移除工作台或卸载其所属插件时，删除其 `app/data/<id>/` 与 `app/cache/<id>/`。
- 新建 Project、Agent 或组织，以新名称导入 Skill、钩子包或工作台，以及把插件工作台装进新文件夹时，拒绝 `con`、`prn`、`aux`、`nul`、`com1`–`com9` 与 `lpt1`–`lpt9`（带不带扩展名均同）以及以点结尾的名称。读取 id 的规则不变，已有的名为 `aux` 的 Agent 或名为 `report.v2` 的工作台照常打开。
- `penguin-plugin` Skill（2026.11.19.1）、工作台的 `.harness/README.md`、CLI 的 `--no-workbench-data` 帮助与文档站页面说明了数据文件夹。

## 评审后重做（2026-11-19）

此改动的第一版只提供 `dataPaths()`，带 `project`、`server`、`machine` 三个存储层级，并收紧了 id 规则。重做后去掉了共享层级与 `env-paths` 依赖，恢复了带类型的文件成员；数据随 Agent 导出、随工作台删除；Windows 名称规则只在创建 id 时生效。
