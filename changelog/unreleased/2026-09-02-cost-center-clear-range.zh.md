# 清空错误记录时点出范围，并删掉面板所列的全部记录

- **Date:** 2026-09-02
- **Type:** fix
- **Scope:** `server`, `web`, `docs`
- **PR:** [#590](https://github.com/Prism-Shadow/penguin-harness/pull/590)

[English](2026-09-02-cost-center-clear-range.md)

成本中心的**清空**确认框现在按范围选择器的叫法点出范围——「近 7 天内」「最近一小时内」——只有自定义范围才写起止日期。其背后，一次清空现在删除的正是面板列出的那些行：两个滑动档位（最近一小时、最近一天）对异常表的读取与清空一并收窄到其瞬时窗口，而不再是整天；管理员的清空同时带走其面板所示的无归属记录——没有 Project 归属的登录失败与进程崩溃——它们正是 Project 范围的清空过去留下的那部分。

## 细节

- `GET` 与 `DELETE /api/projects/:projectId/usage/errors` 接受 `fromTs` / `toTs`（同给或同不给、须有序，与看板一致）；看板上的异常统计同样遵循这一对参数。两端均为闭区间。清空另外要求 `from` 与 `to` 必填（缺一即 400），与面板此前提供该操作的前提一致——开区间等于整段历史，而非一次筛选。
- 删除的触及范围与调用者的读取范围相同：管理员的清空包含无归属记录，成员（其读取从不显示这些行）的清空从不包含。原先用于表示两者之差的 `UsageErrors.clearable` 已移除——`total` 即一次清空会删掉的数量。
- 新增字符串 `usage.errorsClearRangePreset` / `usage.errorsClearRangeCustom` 供 `usage.errorsClearScope` 与 `usage.errorsClearScopeAgent` 使用，后两者现在以一个短语接收范围。
- Web App 与服务端 API 文档描述了清空的触及范围。
