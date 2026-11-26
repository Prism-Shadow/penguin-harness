# 插件提供的系统应用所需的服务端接缝

- **Date:** 2026-11-20
- **Type:** feature
- **Scope:** `core`, `server`, `docs`
- **PR:** [#1675](https://github.com/Prism-Shadow/penguin-harness/pull/1675)

[English](2026-11-20-plugin-app-server-seams.md)

服务端新增了插件提供的系统应用所需的通用接缝：它在 Project 中自己的文件夹，以某个人的名义发起的 Agent 任务，Project 的只读视图，它页面的文件，以及 Project 创建、语义 id 与开始页三个数据槽（设计：[PRFC-0036](https://github.com/Prism-Shadow/penguin-harness-design/pull/503)）。它们都经 `@prismshadow/penguin-server/plugin` 取得。仓库内的评估中心不变，只是它的 `benchmark` 语义 id 种类改为以这种方式贡献。

## 细节

- **`AppData`**。`dataPaths(projectId, appId)` 返回 `{ dataDir, cacheDir, stateDir }`：系统 Agent 以该应用为键的 agent 级文件夹，即 `agents/system_agent/app/{data,cache}/<appId>/` 与 `run/` 下的一个状态文件夹，交出前即已建好。系统 Agent 出现之前建的 Project 先补上系统 Agent。
  - `benchmark` 应用的数据就是该 Project 的 Benchmark 所在的文件夹。
  - Project 的 `system_agent` 是用户自己的 Agent 时，其他应用一律 409 `system_agent_held`，不向那个 Agent 写入任何内容。
  - id 不是单个普通路径段时 400，服务端没有该 Project 时 404 `project_not_found`。
- **`AgentTasks`**。`start({ userId, projectId, agentId, prompt, approvalMode, skills?, model?, thinkingLevel?, title? })` 建一个对话并发起任务，步骤与 Web App 的「发送」相同：
  - 此人进不了该 Project 或 Agent 不存在时 404，系统 Agent 409 `system_agent_no_sessions`；
  - 新建临时 Workspace，Skill 以 `[use_skills]` 块放在此人的正文之前；
  - 本轮的驱动者为此人，来源为 `user`，所以对话出现在其侧栏，带审批角标与完成通知；
  - 审批模式取给定的值，为新建对话可选的四种之一。

  `status(userId, sessionId)` 返回 `{ status, title, pendingApprovals }`，`status` 为 `running`、`completed` 或 `failed`；Session 已不在或此人读不到时为 null。
- **只读视图**。`AgentSkills`（`installedSkills(projectId, agentId)`：一个 Agent 已装 Skill 的名称；Project 没有该 Agent 时 404 `agent_not_found`）是新增的宿主节点。`ProjectModels`（`getModels`）与 `ProjectMachines`（`projectApis`）是门面上新增的接口，宿主的 `Access`、`WorkspaceFiles` 与 `MachineApi` 类型一并导出。内核按结构匹配依赖，所以插件也可以在自己的包里声明同样的视图。
- **门面上的函数**。
  - `containedFile` 与 `uiFileResponse` 提供包自己的页面文件。`containedFile` 拒绝越界的路径与任何链接，不论链接指向文件夹内外。
  - `unzipBounded`、`assertSafeEntryPath`、`assertDistinctPaths`、`specialEntries`、`CONTROL_CHARACTER` 与压缩包上限是服务端自己的 zip 防护。
- **`ProjectsModule.appSeeds`** `{ app, path }`。新建 Project 时，以及首位所有者接管 `default_project` 时，包内 `<path>/` 下的每个文件夹以原名复制进该应用的数据文件夹，名称已被占用的不动。
  - 只读取该 Project 为本服务端列入的内置包。宿主读它们的 `ifaces.json`，不运行其中任何代码。
  - 每个种子先暂存在 `.seeding/` 下，再改名就位。这由 core 新增的 `placeFolder` 完成，`placeBenchmark` 也改为经它写入。
  - 复制不了的种子记入日志，不会让 Project 创建失败。种子内的链接不复制。
  - 此后不再写入种子：删掉的不再回来，已有的 Project 不会得到它们。
- **`SemanticIdModule.kinds`** `{ kind, access? }`，代码半为 `{ takenIds(projectId) }`。`POST …/suggest-id` 在 `project`、`agent`、`org` 与 `channel` 之外接受贡献的种类，没有模块贡献的种类答 400。
  - 贡献的种类的 id 是 kebab-case，占位 id 为 `<kind>-<yyyymmdd>`。`access: "owner"` 时仅限 Project 的所有者。
  - 评估中心以这种方式贡献 `benchmark`，它的提议与此前相同。
- **`StartPageModule.metrics`** `{ key, title, titleZh?, icon?, order, value, app? }`：构建包时即已确定的计数。`GET /api/contributions` 以 `startMetrics` 交出这些计数，每项带贡献的 `id` 与模块名 `from`。
- **较小的改动**。Session 标题的规则移入 `http/session-title.ts`，重命名与任务标题共用。core 导出 `slotEntries`，不运行包即可从它的表中读出一个槽的条目。
- **文档**。插件页列出服务端模块经门面能拿到的内容，服务端 API 页补充贡献的 id 种类与 `startMetrics`。
