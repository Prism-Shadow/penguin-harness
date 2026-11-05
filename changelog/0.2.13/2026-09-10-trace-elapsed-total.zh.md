# Trace 全局统计的用时只显示总计，明细移到悬停

- **Date:** 2026-09-10
- **Type:** fix
- **Scope:** `web`
- **PR:** [#676](https://github.com/Prism-Shadow/penguin-harness/pull/676)

[English](2026-09-10-trace-elapsed-total.md)

Trace 文件的全局统计此前把用时总计与 API／工具明细印在同一行，静止状态下一行就摆着三个时长。「用时」现在
只显示总计，明细留在悬停文本里——这正是旁边逐轮统计一直以来的读法，两处措辞由此一致。无从悬停的读者也不会
因此读不到它：该行在总计旁带着一段视觉隐藏的明细文本，屏幕阅读器就地读出。
