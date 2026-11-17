# Core：沙盒文件助手支持映射 WSL UNC 路径

- **Date:** 2026-11-17
- **Type:** fix
- **Scope:** `core`

[English](2026-11-17-fix-fs-worker-wsl-unc.md)

在 WSL 沙盒后端（`#1570`）下，`toLinuxPath` 会把 `\\wsl.localhost\<distro>\...` 和 `\\wsl$\<distro>\...` 工作区映射为 bwrap 内的 POSIX 路径，但文件工具助手（`packages/core/src/environment/tools/fs-worker.ts` 中的 `FS_WORKER_SOURCE`）此前只处理盘符路径（`C:\...`），导致受封禁会话里的 `read_file`、`edit_file`、`write_file` 在 WSL UNC 工作区下全部因 `ENOENT` 失败。

## 细节

- `FS_WORKER_SOURCE` 中的 `toLocal` 与 `fromLocal` 现在会识别 `\\wsl.localhost\<distro>\...`、`\\wsl$\<distro>\...` 以及 `\\?\UNC\...` 形式的 WSL 路径：当 `<distro>` 不区分大小写匹配 `process.env.WSL_DISTRO_NAME` 时将其映射为 `/...`，并在 `realpath` / `readlink` 返回时还原为宿主 UNC 前缀。
- 指向其他发行版的 UNC 路径或未设置 `WSL_DISTRO_NAME` 时保持原样，不映射进当前根目录。
- 在 `packages/core/test/sandbox-fs-helper.test.ts` 中补充了 WSL UNC 路径与隔离分支的回归测试。
