# CLI：`penguin web` 报告就绪探测的失败原因

- **Date:** 2026-08-04
- **Type:** fix
- **Scope:** `cli`
- **PR:** [#169](https://github.com/Prism-Shadow/penguin-harness/pull/169)

[English](2026-08-04-cli-web-probe-diagnostics.md)

`penguin web` 此前会丢弃每一个就绪探测异常，并打印同一句笼统的「尚未响应」，读起来像是服务端启动慢——即便真实原因是防火墙在静默丢弃环回请求。该探测现在保留最后一个嵌套的 Node/undici 错误，对其分类（连接超时、被拒绝、重置/套接字、权限、DNS、未知），并在 stderr 上打印一条可操作、已本地化的诊断——超时那一种会请用户允许 PenguinHarness 在所配置的本地端口上通信，而不是叫人去关掉防火墙。任何 HTTP 响应仍然算作就绪，而这套分类由针对性的单元测试覆盖。
