# 派发失败的一次性日程项在下一轮重新触发

- **Date:** 2026-10-10
- **Type:** fix
- **Scope:** `server`
- **PR:** [#852](https://github.com/Prism-Shadow/penguin-harness/pull/852)

[English](2026-10-10-calendar-one-shot-retry.md)

一次性日程项的派发返回 skipped——开不出工位，或 Task 无法入队——时，已消耗的时间槽现在会被释放，于是下一轮对账重新触发该事件，并带上随之重新入队的工位通知。此前该时间槽保持已消耗，员工的工单变化无限期留在队列里，只记下一次派发错误。这种情况下运行从未开始，重试不会让事件触发两次；持续的失败则在每一轮都以 `error` 结果显露出来。周期性日程项不变（下一槽照常触发）；因员工被预算暂停而跳过的一次性日程项仍按原规则消耗、不补发。`OrgCacheRepo.markCalendarSlot` 接受 `null`。
