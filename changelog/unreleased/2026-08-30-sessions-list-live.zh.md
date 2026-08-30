# Session 列表能得知不是它自己创建的 Session,本 server 与机器上皆然

- **Date:** 2026-08-30
- **Type:** fix
- **Scope:** `server`, `web`

[English](2026-08-30-sessions-list-live.md)

由 CLI(或另一个标签页、定时任务、agent 派生的子 Session)启动的 Session,要到刷新页面才会出现在列表里;运行在机器上的 Session 则一直停留在上次拉取时的状态——常常早已停止却仍显示"运行中",点进去才发现。

## 细节

- server 现在把每一次 Session 创建都通告到用户频道(`session_created`,发给 Project 的所有者与成员);通过 `PATCH /api/sessions/:id` 设置的标题——CLI 的 `--title`、另一个标签页的重命名——也和自动生成的标题一样通告(`session_title`)。此前只有定时任务触发会被通告,这正是定时 Session 能立刻出现而 CLI 的不能的原因。
- 列表收到 `session_created` 即重新加载:不是它创建的行只能拉取、无法凭空造出,因为一行需要标题、Workspace 和计数。
- 列表现在除本 server 外,还通过同源代理打开**每台可达机器**的用户事件流。机器上的 Session 是在那台机器的 server 上变化状态的,只有它的事件流会说;列表本来就汇总了每台机器,却只听其中一台。事件流跟随可达集合——机器掉线即关闭、上线即打开——并忽略机器的 `web_updated`:那是机器的 web,不是这个窗口的。
