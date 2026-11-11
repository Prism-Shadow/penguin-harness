# Agent 以其目录的 zip 往来

- **Date:** 2026-11-09
- **Type:** feature
- **Scope:** `server`, `cli`, `web`, `ui-gallery`, `skills`, `docs`
- **PR:** [#594](https://github.com/Prism-Shadow/penguin-harness/pull/594)
- **Breaking:** yes — 移除 `GET`/`POST …/agents/:agentId/export|import` 与创建请求的 `dataBase64`

[English](2026-11-09-agent-zip-export-import.md)

Agent 的导出与导入改为磁盘上 Agent 目录的 zip：`<agentId>/agent_state/…`，以及所选 Session 的 `<agentId>/traces/<date>/<session>_<NNN>.jsonl`。导入沿用快照导入的校验、备份与换入，只新增了解包一步。

## 服务端

- `GET /api/projects/:projectId/agents/:agentId/archive`（任意成员）返回 `<agentId>-<yyyymmdd>.zip`。查询参数 `skills`、`hooks`、`memory`、`workbenches`、`workbenchData` 与 `schedules` 取 `0` 或 `1`（除 `schedules` 外缺省为 `1`），`traces` 取 `none`、`last:<N>`（1~500，按最近活跃，Subagent 会话随其父）或日期目录范围。快照排除的内容不进包，Trace 中不少于 8 个字符的 vault 值替换为 `[vault:<KEY>]`，超出导入上限时返回 413 `archive_too_large`。
- `POST /api/projects/:projectId/agents/import?agentId=<id>&overwrite=1` 接收原始文件，请求体上限单独定为 64MB。zip 解包为 tar.gz 快照解出的同一布局，按中央目录核对上限，拒绝链接、越出顶层目录的条目、控制字符以及只差大小写的名字。id 未被占用时新建 Agent（任意成员）；已被占用时返回 409 `agent_exists`（`details.agentId`），`overwrite=1`（仅 owner）先写备份快照再替换 State，保留 vault、Session、API 密钥以及包里没有的部件。响应为 201 `{agent, mode, version, backup?, sessions: {imported, skipped}}`。
- 缺 `system_prompt` 的 `system_config.yaml` 叠加在模板配置之上，并按配置写入的校验检查。
- Trace 导入推广到一个 Session 的全部文件：各文件按原序号落入其日期目录，Session 只登记一次；本安装已有的 Session id 跳过并报告。
- 快照导入去掉了版本确认（409 `version_conflict`），创建路由去掉了快照种子。

## CLI

- 新增 `penguin agent export <agent-id>` 与 `penguin agent import <file|directory>`。目录以其名称为顶层打成 zip，所用的打包函数即 `penguin plugin install <dir>` 的那一个，已移到 `zip-folder.ts`。

## Web App

- Agent 卡片新增导出图标，设置页概览新增**导出…**，两者打开同一个导出弹窗：技能、钩子、记忆、工作台（含其数据）与定时任务（缺省不勾）的复选框，对话的**不含**、**最近 N 条**（缺省 20）或**日期范围**，以及一行说明保险柜从不进包。**导出**经既有的「先取再存」下载助手保存 zip。
- 智能体页头新增**导入 Agent**。其弹窗分两节：**从其他框架迁移**选择来源框架（Claude Code、Codex、DeepSeek Harness、Qoder、Qwen Code、WorkBuddy 或其他）与路径，折叠展示完整 Prompt 并可复制，**打开新对话**经「用 AI 创建」的同一座桥，以 Project 默认 Agent 开新对话并预填 Prompt；该 Agent 缺 `agent-porting` Skill 时先为它安装 `skill-porting` 插件。**导入文件**接受 `.zip`（或旧的 `.tar.gz`），按文件名预填 id，原样上传文件。409 `agent_exists` 时提供**改用其他 id**，仅 owner 另有**覆盖现有 Agent**，经危险色调确认。导入成功后以 toast 说明结果并重新读取 Agent 列表。
- 设置页概览的**从文件替换…**（仅 owner）以只有文件一节、主按钮为**替换**的形式打开导入弹窗，经同一确认。它取代了**导出快照**与**导入快照**，版本冲突提示随之移除。
- 创建弹窗去掉了**从快照初始化**，页脚提示指向**导入 Agent**。
- ui-gallery 的演示 API 应答新的 archive 下载与 import 上传。

## Skill

- `skill-porting` 插件新增纯说明的 `agent-porting` Skill：写明 Claude Code、Codex、DeepSeek Harness、Qoder、Qwen Code 与 WorkBuddy 的指令、Skill、命令、MCP 服务器、钩子、子 Agent 与记忆所在位置，以及各自如何映射到 zip 布局——指令合成 `AGENTS.md`，Skill 与命令进 `skills/`，MCP 服务器写进只含所改键的 `system_config.yaml`、凭据写作 `${KEY}`，`Stop`、`PreToolUse` 与 `UserPromptSubmit` 上的 `command` 钩子成为由包装脚本组成的钩子包，自动记忆进 `memory/user/`。它只读取来源、绝不复制密钥值，在运行 `penguin agent import <目录> --project-id <p>` 之前检索输出中的密钥，并报告 id、映射了什么、没映射的及其原因、须填写的 vault 键。

## 文档

- Server API、Agent、自我进化与 CLI 页面写明了 archive 与 import 路由及这两条命令。
- Agent 页面写明了两个弹窗与迁移，Web App 页面写明了 owner 的权限与导入弹窗的两条路径，Skill 页面的插件库表格写明了 `agent-porting` Skill。

## 兼容性

- 调用 `GET …/agents/:agentId/export`、`POST …/agents/:agentId/import` 或带 `dataBase64` 的 `POST …/agents` 的客户端，改用 `GET …/agents/:agentId/archive` 与 `POST …/agents/import`，以文件本身为请求体。
- 此前导出的 `.tar.gz` 快照包仍可导入，见[向后兼容](2026-11-09-backward-compatibility.zh.md)。
