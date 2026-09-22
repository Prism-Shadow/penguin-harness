# 向后兼容：`port_forwards` 表的两种形态

- **Date:** 2026-09-22
- **Type:** process
- **Scope:** `server`
- **PR:** [#806](https://github.com/Prism-Shadow/penguin-harness/pull/806)

[English](2026-09-22-backward-compatibility.md)

## 被已关闭的 #797 线盖过编号的数据根没有 `port_forwards` 表

有一套迁移编号比它所在的那条线活得更久：跑过已关闭的 [#797](https://github.com/Prism-Shadow/penguin-harness/pull/797) 那条线的数据根被盖到 13，在那条线上 13 是 `company-mode-org-caches-adoption`。本线的 13 是 `port-forwards`，这样的数据根会把它当作已执行，只跑 `browser-sites`（14），到达最新版本时没有 `port_forwards` 表——而端口转发模块在 App 启动时就要列这张表，于是启动即抛错，服务进程在监听之前退出。那条线上的服务把本构建交接过去的每一台机器都是这样。

15 号迁移 `port-forwards-adoption`：表不存在就建——用的是 13 号**第一版**的 DDL，全部 `IF NOT EXISTS`，冻结不改：它记录的就是那些数据根实际有的形态。无需手工操作：下一次启动或推送时自动执行；在正确位置执行过 13 的数据根，它什么也不改。

## 持有 `port_forwards` 第一版形态的数据根无法新建转发

13 号迁移的 DDL 在本分支上被原地修改（加 `direction` 列、按方向去重），而此前已有少数开发数据根跑过它的第一版（含 53531 与 53899）——已盖章的迁移不会重跑，这些数据根于是留着一张平台再也写不进去的表：`POST /api/port-forwards` 答 500，`no such column: direction`。15 号迁移在它收养的数据根上建出的也是这同一版形态。

16 号迁移 `port-forwards-direction`：把这样的表重建为当前形态——既有行保留为 `in` 转发，`direction` 缺省 `in`，回滚后的前一代仍能写入——已有该列的表不动。swap-safe，随下一次推送生效。无需手工操作。

## 兼容性

等到不再有数据根可能被 #797 那条线盖过编号、且本线的每个数据根都跑过 16，两项都可以删——从 `MIGRATIONS` 里删两项，连同 13 上的编号说明；machines 线发版即是时机。13 号迁移的 DDL 不再改动。
