# 修复工作台自动发现并提高服务端测试稳定性

- **Date:** 2026-10-14
- **Type:** fix
- **Scope:** `server`, `ui-gallery`
- **PR:** [#1133](https://github.com/Prism-Shadow/penguin-harness/pull/1133)

[English](2026-10-14-server-test-stability.md)

服务端测试最多使用两个并行工作进程。Workbench 编译场景独立运行，流式响应测试在收到第一块数据后才允许生产端继续输出。测试失败时也会生成覆盖率报告。

Skill 压缩包测试使用小体积 ZIP 验证声明的大小限制，避免重复压缩数十 MiB 的测试数据。

即使文件系统漏掉了目录创建通知，服务端也能发现 Agent 的第一个工作台。服务端会定期检查尚未创建的目录，目录出现后切换到常规文件监听。

组件展示页的模拟 API 补齐了 Agent 插件列表接口。
