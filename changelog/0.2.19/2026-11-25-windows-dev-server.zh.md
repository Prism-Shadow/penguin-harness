# 修复 Windows 上 `pnpm dev` 起不来开发后端，并补全预构建的工作区依赖

- **Date:** 2026-11-25
- **Type:** fix
- **Scope:** `tooling`, `server`
- **PR:** [#1855](https://github.com/Prism-Shadow/penguin-harness/pull/1855), [#1854](https://github.com/Prism-Shadow/penguin-harness/pull/1854)
- **Issue:** [#1834](https://github.com/Prism-Shadow/penguin-harness/issues/1834)

[English](2026-11-25-windows-dev-server.md)

Windows 上的 `pnpm dev` 能在 `7368` 端口启动开发后端了。`scripts/dev-prebuild.mjs` 也改为在开发服务启动前，按依赖顺序构建 `@prismshadow/penguin-server...` 与 `@prismshadow/penguin-cli...` 的完整工作区依赖图。

## 细节

- `scripts/dev-server.mjs` 只在 stdin 是终端时才交给 `tsx watch`，其余情况一律给空输入（`ignore`），`pnpm dev` 下 concurrently 给每条命令接的管道也在其中。在终端里直接运行 `pnpm dev:server`，仍能按回车让 tsx 重跑。
- `scripts/dev-prebuild.mjs` 原先手写的包过滤列表换成了 `--filter @prismshadow/penguin-server... --filter @prismshadow/penguin-cli... --filter !@prismshadow/penguin-ui`。全新克隆的仓库会按依赖顺序构建服务端、CLI 与 Web App 引用的全部工作区包，包括 `@prismshadow/amsp` 和 `@prismshadow/penguin-library-*`。
