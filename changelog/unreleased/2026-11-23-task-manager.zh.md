# 任务管理器：查看正在运行的任务树

- **Date:** 2026-11-23
- **Type:** feature
- **Scope:** `task-manager`, `web`, `server`, `amsp`, `core`, `workbench`, `ui-gallery`

[English](2026-11-23-task-manager.md)

「任务管理器」页把正在运行的东西列成一棵树：每个 Agent 工作台页面、页面开出的会话，以及这些会话启动的后台进程。每个页面带上它那些会话的 Token 总开销；每个进程显示当前的 CPU 与内存占用。附带的 Skill 让 Agent 能在 shell 里通过 `GET /api/me/tasks` 读到同一棵树。

工作台页面现在有自己的 id，在页面第一次打开时生成；页面开出的会话把这个 id 记为来源，因此页面与它的会话始终关联。
