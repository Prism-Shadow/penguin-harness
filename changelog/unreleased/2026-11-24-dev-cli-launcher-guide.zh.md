# 说明开发服务器使用的 CLI

- **Date:** 2026-11-24
- **Type:** process
- **Scope:** `tooling`, `docs`

[English](2026-11-24-dev-cli-launcher-guide.md)

贡献指南说明了开发服务器何时直接运行 CLI 源码。

## 细节

当服务器从源码启动且能找到 `tsx` 时，启动脚本运行当前检出的 TypeScript 源码。
指南也说明了何时回退到 CLI 构建产物，以及何时需要重新构建。
