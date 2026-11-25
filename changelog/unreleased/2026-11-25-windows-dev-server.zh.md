# 在 Windows 下使用 Node 原生监听启动开发后端并构建完整工作区依赖闭包

- **Date:** 2026-11-25
- **Type:** fix
- **Scope:** `tooling`, `server`
- **Issue:** [#1834](https://github.com/Prism-Shadow/penguin-harness/issues/1834)

[English](2026-11-25-windows-dev-server.md)

将 Windows 下的 `scripts/dev-server.mjs` 改为通过 Node 内置的 `--watch` 配合 `tsx` 的 ESM 加载器（`--import`）启动后端入口，并将 `scripts/dev-prebuild.mjs` 扩展为在启动开发服务前按依赖拓扑完整构建 `@prismshadow/penguin-server...` 与 `@prismshadow/penguin-cli...` 的工作区依赖图。

## 细节

- 在 `win32` 平台将 `scripts/dev-server.mjs` 从 `tsx/cli watch` 切换为 `node --watch --import <tsx> ...`，使 Windows 下运行 `pnpm dev` 与 `pnpm dev:server` 能正常监听 `7368` 端口，不再于启动前卡死在 `tsx watch` 中。
- 在 POSIX 平台继续使用带数据目录 `--exclude` 规则的 `tsx/cli watch`。
- 将 `scripts/dev-prebuild.mjs` 中手写的包过滤列表替换为 `--filter @prismshadow/penguin-server... --filter @prismshadow/penguin-cli... --filter !@prismshadow/penguin-ui`，确保服务端、CLI 与 Web 应用导入的工作区包（包括 `@prismshadow/amsp` 与 `@prismshadow/penguin-library-*`）在全新检出环境下按依赖顺序完成构建。
