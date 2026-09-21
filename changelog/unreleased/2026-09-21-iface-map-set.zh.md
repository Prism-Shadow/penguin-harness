# 接口可以带 Map 与 Set，按元素类型核对

- **Date:** 2026-09-21
- **Type:** feature
- **Scope:** `core`, `server`
- **PR:** [#817](https://github.com/Prism-Shadow/penguin-harness/pull/817)

[English](2026-09-21-iface-map-set.md)

接口表新增两种类型表达式：`{ map: [K, V] }` 与 `{ set: T }`。此前生成器直接拒绝 `Map` 与
`Set`，持有它们的节点只能写成 `Opaque<…>`，而 `Opaque` 只按名字比较。

## Details

- `scripts/gen-ifaces.mjs` 把 `Map<K, V>` / `ReadonlyMap<K, V>` 投影为 `{ map: [K, V] }`，把
  `Set<T>` / `ReadonlySet<T>` 投影为 `{ set: T }`。键、值与元素的类型照常投影，所以一个装着活对象的
  Map 会经接口表连到这些对象的接口。
- core kernel 的 `extendsExpr` 按比较数组的方式比较它们：Map 比键与值，Set 比元素。Map 不是
  Set，两者也都不是数组。
- `WeakMap` 与 `WeakSet` 仍然拒绝：它们的键是对象身份，两份独立编译的产物无从比较。
- 接口页（`pnpm ifaces:page`）能渲染这两种表达式。
- 第一个使用者是服务端新增的 `AgentState` 节点：它持有 Session 运行时的内存状态——活动表、
  每 Session 的锁、两个删除窗口集合、Agent 配置代次与 live tail——`SessionManager` 保留逻辑，
  节点保留内存。它的接口逐成员核对，其中没有 `Opaque`。
