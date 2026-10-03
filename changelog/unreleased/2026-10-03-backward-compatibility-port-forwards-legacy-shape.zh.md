# 向后兼容：编号时代数据根上没有 direction 的 port_forwards

- **Date:** 2026-10-03
- **Type:** fix
- **Scope:** `server`
- **PR:** [Myriad-Dreamin/penguin-harness#PRNUM](https://github.com/Myriad-Dreamin/penguin-harness/pull/PRNUM)

[English](2026-10-03-backward-compatibility-port-forwards-legacy-shape.md)

由编号迁移构建留下、`port_forwards` 表没有 `direction` 列的数据根——例如 agent-state hand-over 线留下、戳记为 14 的数据根——在本线上无法启动：热推送返回 `migration port-forwards failed: Error: no such column: direction`，冷启动也停在同一个错误上。新增迁移 `port-forwards-legacy-shape`，声明在 `port-forwards` 紧前，先把这样的表重建为当前形态。

## 旧形态：首版 `port_forwards`，没有台账

表中没有 `direction` 列，`local_port` 唯一。收编该数据根时执行全部迁移，`port-forwards` 跳过已存在的表，随后在建立基于 `direction` 的索引时失败。

- `port-forwards-legacy-shape` 按 `port-forwards-direction` 的方式重建该表：已保存的转发全部保留为 `in` 转发，两个索引都会建立。表不存在或已有该列时什么也不做；它的 `down` 同样什么也不做。
- runtime 自身打开数据库时，在执行 schema 声明之前先做同样的重建——该声明中基于 `direction` 的索引在冷启动时以同样方式失败。
- 已执行过后续迁移的数据根会执行它一次，记为台账的最后一项，库中不发生任何变化。

**用户无需做任何事。**

## 何时可以移除

与台账对编号数据根的收编一并移除：当所有受支持的数据根都已有台账时，该迁移与 runtime 打开时的那次调用同时删除。参见[编号迁移戳记](2026-10-02-backward-compatibility-named-migrations.zh.md)。
