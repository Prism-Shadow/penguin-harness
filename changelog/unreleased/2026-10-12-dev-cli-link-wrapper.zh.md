# 全局链接的 `penguin` 使用开发版 CLI 的数据根目录

- **Date:** 2026-10-12
- **Type:** fix
- **Scope:** `cli`, `tooling`
- **PR:** [#1065](https://github.com/Prism-Shadow/penguin-harness/pull/1065)

[English](2026-10-12-dev-cli-link-wrapper.md)

`pnpm build` 链接到 PATH 上的 `penguin` 与 `penguin-hmr` 运行构建出的 CLI 时没有 `pnpm penguin` 设置的那组环境变量，因此使用正式安装版的数据根目录 `~/.penguin/data` 与端口 7364，并把正式版的 Project 配置改写成它读不了的名称。`pnpm link:cli` 现在用 `pnpm add --global` 链接一个小的包装包（`scripts/dev-cli-link`）——pnpm 11 已去掉 `pnpm link --global`。它的命令在同一进程内运行构建出的 CLI：`PENGUIN_HOME` 默认 `~/.penguin/dev-data-cli`，`PENGUIN_PROFILE` 默认 `dev`，`PORT` 默认 `7369`（都只在未设置或为空时生效），并清掉继承来的 `PENGUIN_CLI_ENTRY`。同一次运行会删除早先的 `link:cli` 留下的、指向本检出 `packages/cli` 的链接。

## 贡献者需要做的

- 运行一次 `pnpm link:cli`（或 `pnpm build`）。若 pnpm 提示其全局 bin 目录不在 PATH 中，先运行一次 `pnpm setup` 并打开新的 shell。
- 需要有意使用正式安装版的数据根目录时，为那条命令单独指定：`PENGUIN_HOME=~/.penguin/data penguin <args>`。
