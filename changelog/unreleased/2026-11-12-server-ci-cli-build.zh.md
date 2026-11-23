# Server CI 构建 CLI 时不再重复运行其测试

- **Date:** 2026-11-12
- **Type:** fix
- **Scope:** `ci`
- **PR:** [#1484](https://github.com/Prism-Shadow/penguin-harness/pull/1484)

[English](2026-11-12-server-ci-cli-build.md)

将 server 测试需要的 CLI 构建与测试分组分开处理。

## 细节

- 在 Linux、macOS 和 Windows 的 server 测试任务中保留 CLI 构建。
- 让 CLI 测试继续在原有任务中运行，修复仅修改 CLI 时错误创建 server 测试任务的问题。
- 增加构建输入和测试分组的回归检查。
