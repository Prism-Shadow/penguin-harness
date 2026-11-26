# 调用被装载两次时 http 模块的 socket 流应答仍能命中

- **Date:** 2026-11-25
- **Type:** fix
- **Scope:** `server`

[English](2026-11-25-socket-stream-answer-symbol.md)

socket 上的流式调用（history、trace body）把应答挂在请求对象的一个 `penguin-library-http` 模块级 symbol 上。一次安装可能把该包链接两份——直链与 pnpm 虚拟存储副本——两份实例各持一个 symbol，socket 层挂上的应答因此永远查不到，这类流全部退化为读取端无法消费的普通 Response。symbol 改为注册表键（`Symbol.for("penguin-harness.stream-answer")`），模块的每一份副本共享同一个键，挂载与查找必然命中。
