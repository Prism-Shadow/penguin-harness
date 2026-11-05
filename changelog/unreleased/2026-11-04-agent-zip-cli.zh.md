# `penguin agent export` 与 `penguin agent import` 以 zip 迁移 Agent

- **Date:** 2026-11-04
- **Type:** feature
- **Scope:** `cli`, `docs`
- **PR:** [#594](https://github.com/Prism-Shadow/penguin-harness/pull/594)

[English](2026-11-04-agent-zip-cli.md)

CLI 新增 Agent zip 的两端：`penguin agent export <agent-id>` 把 Agent 写成 Agents 页面导出对话框所产出的 zip；`penguin agent import <path>` 从这样的 zip、旧版 `.tar.gz` Agent State 包，或按 zip 布局组织的目录创建 Agent。`agent-porting` Skill 正是用目录这种方式把其他编程工具中的 Agent 迁移进来的。

## 细节

- `export` 按对话框的缺省值选择各部分：`--no-skills`、`--no-hooks`、`--no-memory`、`--no-workbenches` 与 `--no-workbench-data` 去掉某一部分，`--schedules` 加上定时任务，`--traces none|last:<N>|<from>..<to>` 选择 Session。每个部分都显式写入 `GET …/agents/:a/archive` 的查询参数，格式不对的 `--traces` 在发出任何请求之前报错。zip 经临时文件流式写入磁盘，下载中断时不留下任何文件；`--out` 可以是文件或目录，服务器给出的文件名只取最后一段。`--json` 打印 `{agentId, projectId, file, bytes}`。
- `import` 把文件作为原始请求体（`application/octet-stream`）上传到 `POST …/agents/import`，`--agent-id` 与 `--overwrite` 作为查询参数。目录的根部须有 `manifest.json`；CLI 在内存中把它打包成 manifest 位于 zip 根部的 zip，不含 `.git`、链接与特殊文件，因此无需 `zip` 程序。超过 100 MiB 的文件或打包后的目录在发送任何内容之前即被拒绝。
- 文本报告列出创建或替换的 Agent 及其 Agent State 版本、替换前写下的备份、导入的内容、未导入的 Session 及原因、待填写的 vault 密钥与被清空的 MCP 值，以及服务器给出的说明。id 已被占用时报服务器的 `agent_exists`，并附一行说明 `--agent-id` 与 `--overwrite` 的用法。`--json` 打印完整响应。
- `ServerClient` 新增 `download`（把二进制 GET 流式写入磁盘，文件名取自 `Content-Disposition`）与 `upload`（以 `duplex: "half"` 发送原始请求体）；它重试的请求（刷新 token、改用已保存的登录）会重新发送请求体。
- 接受 `.tar.gz` 包属于向后兼容，见[向后兼容](2026-11-04-backward-compatibility.zh.md)。
- CLI 参考文档补充了这两条命令。
