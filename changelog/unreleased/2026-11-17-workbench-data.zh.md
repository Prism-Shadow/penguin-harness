# 工作台自己的文件夹：数据、缓存与状态

- **Date:** 2026-11-17
- **Type:** feature
- **Scope:** `core`, `server`, `plugins`, `docs`
- **PR:** [#1579](https://github.com/Prism-Shadow/penguin-harness/pull/1579)

[English](2026-11-17-workbench-data.md)

`WorkbenchHost.dataPaths()` 返回工作台自己的三个文件夹：

- `dataDir`，即 `<agentDir>/app/data/<workbenchId>/`，存放与其 Agent 共同读写的文件；
- `cacheDir`，即 `<agentDir>/app/cache/<workbenchId>/`，存放可重新生成的文件；
- `stateDir`，位于 `<root>/run/` 下的短路径，存放 socket、管道与锁。

工作台的服务端代码现在按 Node 的类型声明检查，处理器因此可以用 `node:fs` 读写这些文件夹，并提供自己的路由。数据文件夹随「含其数据」进入 Agent 导出，三个文件夹都随工作台一并删除。新建的 Project、Agent、Skill、钩子包与工作台 id 不得再取 Windows 保留的名称；磁盘上已有的 id 照常可以打开。

## 细节

- **`dataPaths()`**：返回前建好三个文件夹。它们之中任何一个所在的位置，以及 Agent 目录或数据根目录以下它们之上的任何一级，若是链接或文件即拒绝。
- **`socketPath(name)`**：返回 `<stateDir>/<name>`。该路径超过 Unix socket 路径的 103 字节上限（macOS 含结尾符为 104，Linux 为 108）时报错并说明上限；在 Windows 上返回命名管道 `\\.\pipe\penguin-<hex>-<name>`。
- **`stateDir`**：位于 `<root>/run/<project>/<agent>/<workbench>/`，每一级是其 id 的 10 位哈希，无论 Agent 目录多深，socket 路径都足够短。它从不导出，随所属的工作台、Agent 或 Project 一并删除。
- **Node 类型**：工作台编译时带上 `@types/node`，不带其他任何 `@types` 包。`@types/node` 改为服务端的运行时依赖，桌面版构建与热推送把它与编译器放在一起携带。
- **沙盒**：在 `workspace-write` 沙盒下，`<agentDir>/app` 与该 Agent 在 `<root>/run/` 下的文件夹作为真实目录存在后，Agent 的命令可以写入它们；启动命令时从不创建它们。
- **导出与导入**：Agent 导出的「含其数据」（`workbenchData`）带上随包各工作台的 `app/data/<id>/`，从不带缓存与状态。覆盖导入时：
  - 包里带了数据的工作台，替换其数据文件夹；
  - 包里没带数据的工作台，保留现有的；
  - 新 State 里已没有的工作台，其数据、缓存与状态一并删除。

  导入前的备份包含它替换或删除的每个数据文件夹。
- **删除**：移除工作台或卸载其所属插件时，删除它的三个文件夹；删除 Agent 或 Project 时，删除其 `run/` 文件夹。
- **新建 id**：新建 Project、Agent 或组织时，拒绝 `con`、`prn`、`aux`、`nul`、`com1`–`com9` 与 `lpt1`–`lpt9`（带不带扩展名均同）以及以点结尾的名称；以新名称导入 Skill、钩子包或工作台，以及把插件工作台装进新文件夹时同此。读取 id 的规则不变，已有的名为 `aux` 的 Agent 或名为 `report.v2` 的工作台照常打开。
- **文档**：`penguin-plugin` Skill（2026.11.19.2）、工作台的 `.harness/README.md`、CLI 的 `--no-workbench-data` 帮助与文档站页面说明了这些文件夹。

## 评审后重做（2026-11-19）

第一版只提供 `dataPaths()`，带 `project`、`server`、`machine` 三个存储层级，并收紧了读取 id 的规则；第二版加了宿主文件接口（`listFiles`、`readFile`、`writeFile`、`removeFile`、`filePath`）。两者都已重做：

- 去掉了共享层级、`env-paths` 依赖与宿主文件接口；
- 处理器改用 Node 自带的 `fs`；
- 恢复了位于短路径的 `stateDir`；
- 数据随 Agent 导出、随工作台删除；
- Windows 名称规则只在创建 id 时生效。
