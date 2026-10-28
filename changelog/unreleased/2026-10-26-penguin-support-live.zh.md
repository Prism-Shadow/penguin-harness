# PenguinHarness 客服边写边显示回答

- **Date:** 2026-10-26
- **Type:** feature
- **Scope:** `plugins`
- **PR:** [#1352](https://github.com/Prism-Shadow/penguin-harness/pull/1352)

[English](2026-10-26-penguin-support-live.md)

`penguin-support` 插件的客服工作台改为实时跟随问题的对话，不再只靠轮询拿结果。它的版本升到 `2026.10.26.1`，已安装的副本会出现插件更新标记；默认 Project 里的内置副本不会自动更新。

## 细节

- 处理器订阅每个查阅中问题的 Session（`host.subscribe`）：Workbench 加载时订阅一次，每次提问、追问或重试开始前也订阅。主任务结束后，它等 Session 转为 idle，保存回答或失败原因，然后取消订阅，所以页面没打开也能存下回答。`GET /tickets` 仍会核对查阅中的问题，用来兜住服务器重启或 Workbench 重新加载期间结束的任务。在 Workbench 宿主没有 `subscribe` 的服务器上（0.2.17 及更早），处理器不订阅，回答照旧全由 `GET /tickets` 保存。
- 查阅中的问题打开对话框时，页面导入 `../sdk/workbench.js`，用 `followSession` 跟随该 Session。当前 Request 的文字作为草稿显示在「回答撰写中」之下，另有一行用日常用语描述正在调用的工具（「正在阅读文档和代码…」「正在搜索文档和代码…」）。子 Agent 的记录（带 `origin`）一律忽略。每个打开的对话框只用一个 reader，对话框关闭或页面隐藏时关掉。
- 任务结束时页面立即刷新列表；列表轮询由每 2.5 秒一次改为每 5 秒一次。
- 新增「停止」按钮，在对话框内确认后通过 `abortSession` 停止正在查阅的问题。主 Session 的 `abort` 记录带有用户中断的错误码时，处理器把该问题保存为 `stopped: true`，页面随之显示「这个问题在回答完成前已停止。点击『重试』可以重新提问。」，不再显示服务端的错误文本。`stopped` 是新增的可选字段，此前保存的状态照常加载。
- 列表和对话框里的状态改用带色调的 `wb-badge` 标签：待处理为 attention，查阅中和已回答为 success，已解决为 done，待重试为 danger。对话框改用主题的遮罩与弹窗阴影 token。
- SDK 无法加载时（服务器版本较旧，或构建损坏），页面恢复每 2.5 秒轮询，对话框只显示等待时间，没有草稿和停止按钮。
