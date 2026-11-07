# `penguin chat` 可以接上仍在运行的 Session

- **Date:** 2026-11-07
- **Type:** fix
- **Scope:** `cli`, `docs`

[English](2026-11-07-cli-resume-running-session.md)

对一个 Task 仍在运行的 Session 执行 `penguin chat --resume`，下一条消息不再得到 `409 task_in_progress`。例如启动 Task 的终端已经关闭时，就会出现这种情况。现在对话会从 Task 当前的位置接上：先显示历史和已经流式输出的回复，再跟随这个 Task 直到结束，然后才给出提示符。在此期间，输入即插话，Ctrl-C 中断 Task，Task 等待的审批也在对话里询问。流中与历史重复的内容只显示一次；正在进行的压缩写出的摘要不会出现在屏幕上，与对话自己发起的轮次一致。

如果发消息时 Session 正在运行别处（Web App 或另一个终端）发起的 Task，这条消息会作为插话发给它；对话先打印这个 Task 已有的内容，再同样跟随到结束。如果那个 Task 恰好刚结束，这条消息就作为一个新的 Task 发出。
