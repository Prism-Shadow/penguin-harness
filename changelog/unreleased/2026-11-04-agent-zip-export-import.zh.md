# Agent 导出为 zip，并可从 zip 导入

- **Date:** 2026-11-04
- **Type:** feature
- **Scope:** `server`, `trace-index`, `docs`
- **PR:** [#594](https://github.com/Prism-Shadow/penguin-harness/pull/594)
- **Breaking:** yes — 移除了 `GET …/agents/:agentId/export`、`POST …/agents/:agentId/import` 和 `POST …/agents` 的 `dataBase64` 字段

[English](2026-11-04-agent-zip-export-import.md)

Agent 现在以一个 zip 离开服务端，其中包含调用方选定的部分；也可以从这样的 zip 导入，成为新 Agent，或替换现有 Agent 的 State。原先的 `.tar.gz` 快照导出及其导入路由被取代。

## zip 格式

- 顶层只有一个以 Agent 命名的目录，其中包含 `manifest.json`（`format: "penguin-agent-zip/1"`）、与磁盘布局一致的 `agent_state/`，以及选择了 Session 时的 `traces/<date>/<sessionId>_NNN.jsonl` 和 `traces/sessions.json`。
- 配置总会导出：`system_config.yaml`、`AGENTS.md` 和 `tools/`。Skill、钩子、记忆、工作台（可选是否含 `state.json`）和定时任务各自可选；定时任务默认不选。
- 字面写出的 MCP `env` 或 `headers` 凭据会被清空，并记入 `manifest.redacted`；以 `${KEY}` 引用密钥保险柜的值原样导出。密钥保险柜从不导出，只导出键名（`manifest.vaultKeys`）。工作台的 `.build/`、`.harness/`、`.plugin.json` 和 `node_modules/`、任何 `.git` 路径、暂存残留、已过期的定时任务和链接都不会导出。
- Session 可选择不导出、最近活跃的 N 个（1–500）或按 Trace 日期目录选取的日期范围。每个 Session 整体导出，并带上同一 Agent 下的子 Agent Session 以及 sessions 表中的信息。含有超过 256 MiB 文件的 Session 不导出，并会列出。

## 路由

- `GET /api/projects/:p/agents/:a/archive?<parts>` 流式输出 zip（`<agentId>-<yyyymmdd>.zip`）；`GET …/archive/preview?<parts>` 报告它将包含的内容。任何成员都可以调用。
- `POST /api/projects/:p/agents/import?agentId=&overwrite=1` 以原始 `application/octet-stream` 请求体接收 zip 或旧的 `.tar.gz` 包，返回 201，附带 Agent 卡片、导入了什么、跳过的 Session、需要补填的内容和说明。id 已被占用时返回 409 `agent_exists`，并带 `details.agentId`；`overwrite=1` 仅限 Project owner。
- 上限：上传 100 MiB、50,000 个条目、单个条目 256 MiB、解压后共 1 GiB；在解压任何内容之前按中央目录检查，并在写入时按实际字节再次计数（413 `archive_too_large`）。文件名、链接、忽略大小写后的重名、Skill 的 `SKILL.md`、钩子包的 `hooks.json` 和工作台 id 都在改动任何 Agent 之前检查；Agent 创建之后的失败会把它删除。
- 新 id 会先按模板创建 Agent，再换入归档中的 State。不含 `system_config.yaml` 的手写 zip 携带 `definition`（MCP Server、模型设置、内置工具名），经配置服务写入。
- 覆盖时先写入导入备份，保留 Agent 的身份、Session、密钥保险柜、API 密钥和雇佣关系；zip 未包含的部分、已过期的定时任务、zip 未携带数据时工作台的数据以及 State 中的其他内容都保留 Agent 自己的版本，被清空的 MCP 值从 Agent 自己的配置中补回。保留的部分以重命名移动，换入失败时移回原处。
- 导入的 Session 保留其标题、时间、归档或保留标记、审批模式、思考等级和客户端。本安装已有的 Session id 以 `exists` 跳过。

## 兼容性

- 调用已移除路由的 API 客户端改用 `GET …/archive` 与 `POST …/agents/import?agentId=<id>&overwrite=1`；带 `dataBase64` 的 `POST …/agents` 改用 `POST …/agents/import`。版本冲突确认已取消：`overwrite=1` 即为确认。`penguin` CLI 从未调用被移除的路由，Web App 在同一版本中一并更新。
- 旧的 `.tar.gz` 包仍可导入，见[向后兼容](2026-11-04-backward-compatibility.zh.md)。
