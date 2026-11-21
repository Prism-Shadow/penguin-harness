# 工作台自己的文件夹：Agent、服务器与机器三级

- **Date:** 2026-11-17
- **Type:** feature
- **Scope:** `core`, `server`, `plugins`, `docs`
- **PR:** [#1579](https://github.com/Prism-Shadow/penguin-harness/pull/1579)

[English](2026-11-17-workbench-data.md)

`WorkbenchHost.dataPaths(level?)` 返回工作台自己的三个文件夹 `{ dataDir, cacheDir, stateDir }`，分别存放长期保留的文件、可重新生成的文件，以及 socket、管道与锁。级别决定由谁共用：

- `agent`（缺省）：该 Agent 上的这一份应用；
- `server`：本数据根上同一插件工作台的所有副本，跨 Project；
- `machine`：这台电脑上本 OS 用户的所有 PenguinHarness。

工作台的服务端代码现在按 Node 的类型声明检查，处理器因此可以用 `node:fs` 读写这些文件夹，并提供自己的路由。Agent 级的数据文件夹随「含其数据」进入 Agent 导出，Agent 级的文件夹随工作台一并删除。新建的 Project、Agent、Skill、钩子包与工作台 id 不得再取 Windows 保留的名称；磁盘上已有的 id 照常可以打开。

## 细节

- **各级位置：**
  - agent：`<agentDir>/app/{data,cache}/<workbenchId>/`，状态在 `<root>/run/<project>/<agent>/<workbench>/`，每一级是其 id 的 10 位哈希；
  - server：`<root>/app/{data,cache}/<plugin>/<workbenchId>/`，状态在 `<root>/run/server/<hash>/`；
  - machine：`~/.penguin/machine/{data,cache}/<plugin>/<workbenchId>/`（可用 `PENGUIN_MACHINE_HOME` 另指位置），状态在其下的 `run/<hash>/`。
- **共享级别：**只有从插件安装的工作台才有 server 与 machine 级；就地创建的工作台会得到一个报错，提示改用 agent 级。
- **名为 `app` 或 `run` 的 Project：**已有的 Project 占用这两个名称之一时，宿主不在它的目录里建任何工作台文件夹；文件夹会落在其中的请求报错并说明原因：`app` 对应 server 级的数据与缓存，`run` 对应 agent 与 server 级的状态与 socket 路径。machine 级不受影响。
- **建立文件夹：**`dataPaths()` 返回前建好该级的三个文件夹。其中任何一个所在的位置，以及它到所在根之间的任何一级，若是链接或文件即拒绝。
- **`socketPath(name, level?)`**：返回 `<stateDir>/<name>`。该路径超过 Unix socket 路径的 103 字节上限（macOS 含结尾符为 104，Linux 为 108）时报错并说明上限；在 Windows 上返回命名管道 `\\.\pipe\penguin-<hex>-<name>`。
- **Node 类型：**工作台编译时带上 `@types/node`，不带其他任何 `@types` 包。`@types/node` 改为服务端的运行时依赖，桌面版构建与热推送把它与编译器放在一起携带。
- **沙盒：**在 `workspace-write` 沙盒下，Agent 级的 `<agentDir>/app` 与该 Agent 在 `<root>/run/` 下的文件夹作为真实目录存在后，Agent 的命令可以写入；server 与 machine 级不能写入。启动命令时从不创建它们。
- **导出与导入：**Agent 导出的「含其数据」（`workbenchData`）带上随包各工作台 Agent 级的 `app/data/<id>/`，从不带缓存、状态与共享级别。覆盖导入时：
  - 包里带了数据的工作台，替换其数据文件夹；
  - 包里没带数据的工作台，保留现有的；
  - 新 State 里已没有的工作台，其 Agent 级的数据、缓存与状态一并删除。

  导入前的备份包含它替换或删除的每个数据文件夹。
- **删除：**
  - 移除工作台或卸载其所属插件时，删除它 Agent 级的文件夹。
  - 删除 Agent 或 Project 时，删除其 `run/` 文件夹。
  - server 与 machine 级从不随工作台、Agent 或 Project 删除。
- **新建 id：**新建 Project、Agent 或组织时，拒绝 `con`、`prn`、`aux`、`nul`、`com1`–`com9` 与 `lpt1`–`lpt9`（带不带扩展名均同）以及以点结尾的名称；以新名称导入 Skill、钩子包或工作台，以及把插件工作台装进新文件夹时同此。新建的 Project 也不得命名为 `app` 或 `run`，这是数据根为工作台保留的文件夹。读取 id 的规则不变，已有的名为 `aux` 的 Agent、名为 `report.v2` 的工作台或名为 `app` 的 Project 照常打开。
- **文档：**`penguin-plugin` Skill（2026.11.19.3）、工作台的 `.harness/README.md`、CLI 的 `--no-workbench-data` 帮助与文档站页面说明了这些文件夹及其级别。
