# 提高服务端测试稳定性

- **Date:** 2026-10-14
- **Type:** fix
- **Scope:** `server` tests
- **PR:** [#1133](https://github.com/Prism-Shadow/penguin-harness/pull/1133)

[English](2026-10-14-server-test-stability.md)

服务端测试最多使用两个并行工作进程。Workbench 编译场景独立运行，流式响应测试在收到第一块数据后才允许生产端继续输出。测试失败时也会生成覆盖率报告。

Skill 压缩包测试使用小体积 ZIP 验证声明的大小限制，避免重复压缩数十 MiB 的测试数据。
