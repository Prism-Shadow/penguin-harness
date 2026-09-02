# 会话列表标出仍有后台任务的对话

- **Date:** 2026-09-02
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `docs`

[English](2026-09-02-session-background-indicator.md)

起了 dev server 或后台子智能体的对话，现在会在侧栏里说明这一点：会话行在原有状态字形旁多一枚小小的层叠标记，对话页头部以一枚小胶囊显示同一数量，二者都随服务端实时变化——命令超过 yield 窗口转入后台或以后台方式启动时标记出现，最后一项后台任务结束的那一刻标记消失，无需刷新列表。

## 细节

- `SessionInfo` 新增可选字段 `backgroundTasks: { processes, subagents }`，读自已加载运行时的内存注册表——仍在运行的命令会话，以及持有 `subagent_id`、正在跑一轮的子会话。只在至少一项非零时出现；未加载的 Session 与没有任何后台任务的 Session 都省略该字段。列表行与单条查询携带同一字段。
- 新增用户级事件 `session_background`：Session 的计数发生变化（转后台、退出、停止、子智能体开始或结束一轮、释放）时经 `GET /api/events` 推送，携带此刻的计数——归零同样推送——发往该 Project 的拥有者与成员，受众与 `session_state` 相同。
- core 的 `Environment` 新增单一的后台状态监听器（`setBackgroundStateListener`，由 `Session.onBackgroundState` 转发），由后台注册表的成员变化、已登记命令进程的退出与子会话轮次状态共同触发，宿主只需一次订阅即可听到「后台还在跑什么」的全部变化。
- 侧栏会话行以 `busy` 色调绘制该标记，数量放在悬停提示与可访问名里（「2 个后台任务」/ "2 background tasks"），与运行中 / 压缩中 / 未读字形**并存**而非替代：dev server 还开着的空闲、已读对话照样带着它。对话页头部原先的「运行中的服务」计数改为这枚胶囊：现在把后台子智能体一并计入，并读取会话行的实时数字而不是进程轮询结果；计数变化时也会立即重读一次进程列表。
- Web App、服务端 API 与设计文档补充了该标记、字段与事件的说明。
