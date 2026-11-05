# `penguin chat` 在第一条消息时才创建 Session

- **Date:** 2026-10-12
- **Type:** feature
- **Scope:** `cli`, `docs`
- **PR:** [#1037](https://github.com/Prism-Shadow/penguin-harness/pull/1037)

[English](2026-10-12-chat-session-at-first-message.md)

新开的 `penguin chat` 不再在启动时创建 Session，而是在发出第一条消息时才创建，因此打开后随即离开的对话不会在服务器上留下任何东西：没有 Session，没有 Trace，侧栏里也没有条目。

## 细节

- 第一条消息之前，开场横幅显示这个 Session 将使用的 Agent、Workspace 和模型（对话未指定模型时，显示从服务器读取的 Project 默认模型），并有一行说明对话会在第一条消息时创建。
- 第一条消息之前输入的 `/thinking <level>` 与 `/switch-model <provider> <model_id>` 决定 Session 创建时的设置，不带参数的 `/thinking` 与 `/switch-model` 显示这些设置。`/compact` 与 `/clear` 会说明还没有对话，格式错误的 `/goal` 也不会创建任何东西。
- `/clear` 不再自己创建新的 Session，而是由下一条消息创建，沿用原来的 Workspace、模型、审批模式和思考等级。
- 创建 Session 失败时（例如服务器没有运行或登录已失效），错误照常显示，消息保留：在终端里回到输入行，从管道输入时空行即重新发送。
- `--resume` 与 `penguin run` 不变。
- CLI 参考文档写明了对话的 Session 何时创建。
