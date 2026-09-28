# 向后兼容：machines 线戳到 14 的数据根

- **Date:** 2026-09-28
- **Type:** process
- **Scope:** `server`
- **PR:** [#PR](https://github.com/Prism-Shadow/penguin-harness/pull/PR)

[English](2026-09-28-numbering-fork-adoption.md)

machines 线的迁移 9–14 依次是 `sessions-sandbox`、`machines-columns`、`sessions-surface`、`user-profile-adoption`、`port-forwards`、`browser-sites`。本线把 `model-promotions`、`model-provider-auth-tokens` 放在 9 和 10，其余顺延两位。所以被那条线戳到 14 的数据根遇到本构建时，会出两个问题：

- **推送被拒。** 迁移 15（`port-forwards`）碰到那条线建的第一版 `port_forwards`，表里没有 `direction` 列，它在 `direction` 上建的部分索引因此失败：`migration 15 (port-forwards) failed: no such column: direction`。能重建这张表的迁移 17 排在 15 之后，轮不到。在本构建上重启 runtime 也一样失败，而且更早，在 SCHEMA_SQL 那一步就挂了。
- **两张表永远建不出来。** 戳记 14 让 9、10 被当成已经跑过，`model_promotions` 和 `model_provider_auth_tokens` 都不会建。服务能起来，但计价和 Penguin Go 令牌刷新会返回 500。

迁移 19 `numbering-fork-adoption` 按表的实际形状判断，不看戳记。它的形状修复 `adoptFirst`（迁移上新加的可选字段）在待跑列表开始前执行，runtime 打开数据库时则在 SCHEMA_SQL 之前执行。没有 `direction` 的 `port_forwards` 按迁移 17 的做法重建，原有的行都保留为 `in` 转发。之后它的 `up` 用 9、10 冻结的 DDL 建出那两张表。它是 swap-safe 的，下一次推送就会跑，不需要手工操作。这些都已按原位跑过的数据根，会发现活已经做完，什么也不改。已有迁移的 DDL 一个字符没动。

## 兼容性

等没有数据根还可能带着 machines 线的戳记（也就是那条线发布的时候），删掉迁移 19 和 `adoptFirst` 字段。戳到 19 的数据根仍能在 machines 线的 runtime 上打开：那边在 19 没有待跑的迁移，写重建后的 `port_forwards` 时不写 `direction` 也照样能写入。
