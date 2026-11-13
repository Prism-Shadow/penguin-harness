# 工单看板支持分组、筛选与排序

- **Date:** 2026-10-18
- **Type:** feat
- **Scope:** `web`
- **PR:** [#1202](https://github.com/Prism-Shadow/penguin-harness/pull/1202)

[English](2026-10-18-ticket-board-grouping.md)

公司工单看板的列上方新增工具条：快捷筛选 chips（全部 / 待审批 / 阻塞 / 逾期 / 我的，
各自带命中数）、搜索框、优先级 chips、列内分组与列内排序。列内可按负责人、优先级或父工单
分组（也可不分组），按优先级、到期日或等待时长排序；两个选择都写进地址
（`?group=`、`?sort=`、`?quick=`），旧的 `?blocked=1` / `?queue=approve` 深链仍按同名 chip 读入。

同时新增：多选模式 + 批量操作条（移动 / 指派 / 附言，移入 Rejected 必须写理由）、审批队列
（每张待审批卡片下直接挂批准 / 打回按钮）、各列在各自表头下独立滚动（五列始终并排），以及
两个裸键——`/` 聚焦搜索、`N` 新建工单，Escape 先退多选再清搜索。

## Details

- 分组与三种排序收口到纯函数 `groupTickets`（单测覆盖）；页面裸键收口到
  `lib/shortcuts/page-keys.ts`，只读无修饰键——所有组合键仍归设置页可见的快捷键注册表。
