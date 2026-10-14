# 打包服务中的 Agent 命令使用随附的 CLI

- **Date:** 2026-10-14
- **Type:** fix
- **Scope:** `server`, `ci`
- **Issue:** [#1119](https://github.com/Prism-Shadow/penguin-harness/issues/1119)

[English](2026-10-14-packaged-cli-shim.md)

修复了打包服务将 `pnpm deploy` 随附的 `pnpm-workspace.yaml` 误认成源码仓库标记、向 `<data root>/bin/penguin` 写入报错脚本的问题。

## 细节

- 在未设置 `PENGUIN_CLI_ENTRY` 时查找安装包中的 CLI，恢复了 Agent 和终端里的 `penguin` 命令，包括 `penguin browser`。
- 保留了显式 CLI 覆盖和源码仓库的选择逻辑。服务启动时会将已有的报错脚本替换为可用的启动器。
- 将 Docker 启动命令改为安装路径的绝对路径，避免 `PATH` 首位的旧报错脚本阻止服务启动。
