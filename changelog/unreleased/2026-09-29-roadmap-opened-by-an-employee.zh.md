# 员工也能开路线图

- **Date:** 2026-09-29
- **Type:** fix
- **Scope:** `plugins`
- **PR:** [Myriad-Dreamin/penguin-harness#103](https://github.com/Myriad-Dreamin/penguin-harness/pull/103)

[English](2026-09-29-roadmap-opened-by-an-employee.md)

`POST …/roadmaps` 不再以 `403 people_only` 拒绝员工。人委托员工开一份路线图，现在开得出来：员工从自己的 Session 发出与页面上同样的请求，路线图照旧开出它的讨论室。

- 记录里的开设人与讨论室的创建者都是这名员工。
- 讨论室里是请求点名的那些员工；开房的员工只有把自己也列进去时才在房里。组织网关对「员工开房间」本来就是这么处理的。
- 开在已有频道上时，员工与人受同样的检查：点名的每名员工都必须已在该频道里。

讨论室的其余行为都不变：房间 Session、转发、工位通知、对其中点名的认领，都和原来一样。员工开的房间里没有需要先对话的人，所以不会让 moderator 先去找某个人开口。**Open a roadmap** 按钮和侧栏的 **+** 也不变，它们本来就是给人用的入口。
