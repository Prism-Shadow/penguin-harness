# Agent 以其目录的 zip 往来

- **Date:** 2026-11-09
- **Type:** feature
- **Scope:** `server`, `cli`, `docs`
- **PR:** [#594](https://github.com/Prism-Shadow/penguin-harness/pull/594)
- **Breaking:** yes — 移除 `GET`/`POST …/agents/:agentId/export|import` 与创建请求的 `dataBase64`

[English](2026-11-09-agent-zip-export-import.md)

Agent 的导出与导入改为磁盘上 Agent 目录的 zip：`<agentId>/agent_state/…`，以及所选 Session 的 `<agentId>/traces/<date>/<session>_<NNN>.jsonl`。导入沿用快照导入的校验、备份与换入，只新增了解包一步。

## 服务端

- `GET /api/projects/:projectId/agents/:agentId/archive`（任意成员）返回 `<agentId>-<yyyymmdd>.zip`。查询参数 `skills`、`hooks`、`memory`、`workbenches`、`workbenchData` 与 `schedules` 取 `0` 或 `1`（除 `schedules` 外缺省为 `1`），`traces` 取 `none`、`last:<N>`（1~500，按最近活跃，Subagent 会话随其父）或日期目录范围。快照排除的内容不进包，Trace 中不少于 8 个字符的 vault 值替换为 `[vault:<KEY>]`，超出导入上限时返回 413 `archive_too_large`。
- `POST /api/projects/:projectId/agents/import?agentId=<id>&overwrite=1` 接收原始文件，请求体上限单独定为 64MB。zip 解包为 tar.gz 快照解出的同一布局，按中央目录核对上限，拒绝链接、越出顶层目录的条目、控制字符以及只差大小写的名字。id 未被占用时新建 Agent（任意成员）；已被占用时返回 409 `agent_exists`（`details.agentId`），`overwrite=1`（仅 owner）先写备份快照再替换 State，保留 vault、Session 与 API 密钥。响应为 201 `{agent, mode, version, backup?, sessions: {imported, skipped}}`。
- 缺 `system_prompt` 的 `system_config.yaml` 叠加在模板配置之上，并按配置写入的校验检查。
- Trace 导入推广到一个 Session 的全部文件：各文件按原序号落入其日期目录，Session 只登记一次；本安装已有的 Session id 跳过并报告。
- 快照导入去掉了版本确认（409 `version_conflict`），创建路由去掉了快照种子。

## CLI

- 新增 `penguin agent export <agent-id>` 与 `penguin agent import <file|directory>`。目录以其名称为顶层打成 zip，所用的打包函数即 `penguin plugin install <dir>` 的那一个，已移到 `zip-folder.ts`。

## 文档

- Server API、Agent、自我进化与 CLI 页面写明了 archive 与 import 路由及这两条命令。

## 兼容性

- 调用 `GET …/agents/:agentId/export`、`POST …/agents/:agentId/import` 或带 `dataBase64` 的 `POST …/agents` 的客户端，改用 `GET …/agents/:agentId/archive` 与 `POST …/agents/import`，以文件本身为请求体。
- 此前导出的 `.tar.gz` 快照包仍可导入，见[向后兼容](2026-11-09-backward-compatibility.zh.md)。
