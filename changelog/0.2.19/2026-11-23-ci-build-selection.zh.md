# 缩短 CI 规划与 Windows 安装脚本测试的准备时间

- **Date:** 2026-11-23
- **Type:** process
- **Scope:** `ci`
- **PR:** [#1769](https://github.com/Prism-Shadow/penguin-harness/pull/1769)

[English](2026-11-23-ci-build-selection.md)

CI 规划器将构建时要排除的包直接交给 pnpm 处理。Windows 安装脚本测试从干净的源码检出开始，使用 PowerShell 测试套件自己创建的 ZIP 包。
