# 会话行的定时任务标记覆盖所有 Agent

- **Date:** 2026-09-16
- **Type:** fix
- **Scope:** `web`, `server`, `docs`
- **PR:** [#743](https://github.com/Prism-Shadow/penguin-harness/pull/743)

[English](2026-09-16-schedule-mark-every-agent.md)

绑定了还有下一次触发的定时任务时，会话行会佩戴一枚闹钟标记，此前它时隐时现：侧栏只读当前 Agent 的任务，
而会话列表画的是所有 Agent 的 Session，于是打开另一个 Agent 的对话，其余行上的标记就被摘掉，切回来又戴上。
服务端新增了一个 Project 级的列表接口，Web App 改读它，于是每一行都佩戴自己的标记，不论属于哪个 Agent、
列表按什么分组。

## 细节

- 新增路由 `GET /api/projects/:projectId/schedules`，返回 `ProjectSchedulesResponse`：所有 Agent 的任务，
  每条带上持有它的 `agentId`，Agent 按 id 排序；解析失败的文件同样带上所属 Agent。任意成员都可读取，与
  按 Agent 的列表同一条规则。
- 定时任务 store 改为按 Project 缓存一份列表，不再按 Agent 各缓存一份；两个读者——会话行上的标记与 Dock
  的定时任务面板——都读这一份。面板把它收窄到当前打开的对话，其编辑、启停与删除都指明任务所属的 Agent。
- `schedule_fired` / `schedule_queued` 事件、窗口重新获得焦点、对话一轮结束以及面板的轮询，刷新的都是
  这份 Project 级列表。
- 服务端 API 参考补上了该路由；Web App 指南也改写为：不论对话属于哪个 Agent、列表按什么分组，标记都会
  出现。中英两份文档同步更新。
