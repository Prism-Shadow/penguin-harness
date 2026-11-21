# 向后兼容：`port_forwards` 表的两种形态

- **Date:** 2026-09-22
- **Type:** process
- **Scope:** `server`

[English](2026-09-22-backward-compatibility.md)

`port_forwards` 表被不止一条构建线承载过，其最初部署的形态没有 `direction` 列。两个小迁移把每一个这样的数据根带到当前形态；都不需要任何手工操作。

## 持有迁移记录但没有表的数据根

一个数据根可能持有 `2026-10-11-port-forwards` 迁移的账本记录、却没有这张表本身——在机器与构建线之间流转过的数据库，可能带着一条其表已被某个本构建看不见的构建落下的记录。端口转发模块在 App 启动时就要列这张表，于是没有表的数据根在监听之前就退出。

`2026-10-11-port-forwards-adoption`：表不存在就建——用的是 `2026-10-11-port-forwards` **第一版**的 DDL，全部 `IF NOT EXISTS`，冻结不改：它记录的就是那些数据根实际有的形态。无需手工操作：下一次启动或推送时自动执行；已有表的数据根，它什么也不改。

## 持有 `port_forwards` 第一版形态的数据根无法新建转发

`port_forwards` 的 DDL 在有数据根跑过它的第一版之后被原地加宽（加 `direction` 列、按方向去重）——已记录的迁移不会重跑，这样的数据根于是留着一张平台再也写不进去的表：`POST /api/port-forwards` 答 500，`no such column: direction`。上面的 adoption 在它收养的数据根上建出的也是这同一版形态。

`2026-10-11-port-forwards-direction`：把这样的表重建为当前形态——既有行保留为 `in` 转发，`direction` 缺省 `in`，回滚后的前一代仍能写入——已有该列的表不动。swap-safe，随下一次推送生效。无需手工操作。

## 兼容性

等到每个数据根都跑过 `2026-10-11-port-forwards-direction`，两项都可以删——从 `MIGRATIONS` 里删两项。`2026-10-11-port-forwards` 的 DDL 不再改动。
