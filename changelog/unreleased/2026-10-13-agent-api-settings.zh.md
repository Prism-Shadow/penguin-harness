# Agent API 会话设置与 SDK 方法命名

- **Date:** 2026-10-13
- **Type:** feature
- **Scope:** `server`, `web`, `amsp`, `docs`
- **PR:** [#1111](https://github.com/Prism-Shadow/penguin-harness/pull/1111)
- **Breaking:** yes — SDK 流式方法改为 `stream()`，`run()` 返回完成后的结果

[English](2026-10-13-agent-api-settings.md)

Agent API 标签页增加了模型、思考等级和工作区设置，复用了现有选择器。选择后立即保存，只影响之后新建的 API 会话。审批说明收进了标签旁的问号提示。

## SDK 方法

将流式 `AgentClient.run()` 改为 `stream()`，将返回完整结果的 `ask()` 改为 `run()`。同步更新了示例、SDK 参考和客户端测试。

## 兼容性

原来读取事件流的 `client.run(...)` 调用需改为 `client.stream(...)`，`client.ask(...)` 调用需改为 `await client.run(...)`。现有会话保留原设置。数据库升级保留 API 设置和密钥，见[兼容性处理](2026-10-13-backward-compatibility.zh.md)。
