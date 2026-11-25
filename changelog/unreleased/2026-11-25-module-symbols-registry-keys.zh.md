# 固定模块哨兵改为注册表键

- **Date:** 2026-11-25
- **Type:** fix
- **Scope:** `server`, `cli`

[English](2026-11-25-module-symbols-registry-keys.md)

一次安装可能把同一个包链接两份——直链与 pnpm 虚拟存储副本——两个模块实例不共享普通 `Symbol()` 的值，一个实例创建、另一个实例读取的固定哨兵会静默失效。四个固定模块哨兵改为注册表键（`Symbol.for`，`penguin-harness.*` 命名）：CLI chat 的 busy 标记、Agent API run-stream 的心跳 ping、npm-packlist 的两个规则集身份。作用域生成的符号——转义图层 id、未保存表单条目句柄、浏览器槽位与工作台分组 id、单次调用的停止哨兵——在同一个模块、同一次调用内生灭，保持普通 `Symbol()`。
