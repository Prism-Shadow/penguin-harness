# CLI 的会话命令移入 `penguin session`，并可重命名 Session

- **Date:** 2026-10-10
- **Type:** feature
- **Scope:** `cli`, `server`, `plugins`, `docs`
- **PR:** [#1013](https://github.com/Prism-Shadow/penguin-harness/pull/1013)
- **Issue:** [#813](https://github.com/Prism-Shadow/penguin-harness/issues/813)
- **Breaking:** yes — 移除了 `penguin ls`、`penguin logs` 与 `penguin input`，改为 `penguin session ls`、`penguin session log` 与 `penguin session input`

[English](2026-10-10-session-commands.md)

CLI 新增 `penguin session` 命令组，收拢作用于 Project 会话的命令：`ls`、`log`（原 `logs`）、`input`，以及新增的 `rename`。`penguin run --title` 在 `run` 新建或复用 Session 时为它命名。两条重命名路径都发送既有的 `PATCH /api/sessions/<id>`，其标题校验同时收紧。没有新增 Agent 工具：Agent 通过运行这条 CLI 命令重命名自己的 Session。

## 细节

- **CLI**：`penguin session ls`、`penguin session log` 与 `penguin session input` 取代了顶层的 `ls`、`logs` 与 `input`，选项、默认值与输出不变。提到这些命令的提示（仍在运行提示、输出流缺口提示、找不到会话的报错）随之更新。
- **CLI**：`penguin session rename [session_id] -t <title>` 设置 Session 标题，与 Web App 的「重命名对话」是同一种手动重命名。显式给出的 id 优先；省略时重命名调用它的 Session（`PENGUIN_SESSION_ID`），只有在 Session 之外才取该 Agent 最近一次会话，并在 stderr 上用一行暗色的 `[latest]` 标出。`-t/--title` 必填，缺少标题是用法错误，不会触发重命名。`--json` 打印 `{sessionId, title}`。
- **CLI**：`penguin run --title <title>` 在 Task 开始前重命名 Session，新建与 `--session` 复用两条路径都生效，`--background` 运行也会被命名。两条命令都在发出请求前折叠连续空白并检查 1–120 的长度范围，坏标题不会留下未命名的 Session。
- **Server**：`PATCH /api/sessions/<id>` 把标题中的连续空白（含换行与制表符）存为一个空格；标题含控制字符，或双向嵌入、覆盖、隔离字符（U+202A–U+202E、U+2066–U+2069）时答 `400` `invalid_title`。Web App 的重命名走同一路由。
- **插件**：`penguin-orchestration` 技能（`agent-development` 2026.10.10.1）以及 `company-employee`、`company-hr` 技能（`agent-company` 2026.10.10.1）改用新的命令名，`penguin-orchestration` 还介绍了 `session rename` 与 `run --title`。
- **文档**：CLI 参考新增 `penguin session` 一节，收入 `ls`、`log`、`input` 与 `rename`，并在 `penguin run` 下新增 `--title` 一行；CLI 快速上手与服务端 API 参考随之更新。

## 兼容性

- `penguin ls`、`penguin logs` 与 `penguin input` 已不存在，调用时按未知命令报错。脚本改用 `penguin session ls`、`penguin session log` 与 `penguin session input`，选项与输出不变。
- 本次发布的内置技能已使用新命令名。已安装旧版 `agent-development` 或 `agent-company` 的 Agent 会继续调用旧命令名，直到在**插件市场**页把该插件更新到 2026.10.10.1。
