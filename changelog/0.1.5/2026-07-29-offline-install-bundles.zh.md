# 多平台离线安装包

- **Date:** 2026-07-29
- **Type:** feature
- **Scope:** `tooling`, `ci`
- **PR:** [#131](https://github.com/Prism-Shadow/penguin-harness/pull/131)

[English](2026-07-29-offline-install-bundles.md)

- 发布构建现在把 Windows、Linux 与 macOS 的每个平台压缩包连同其校验和与原生安装脚本一并打包，产出五个自包含的离线安装包。
- `install.sh` 与 `install.ps1` 可以在无网络的情况下安装一个经校验的本地 Release 压缩包，同时保留它们既有的在线行为。
- POSIX 离线包使用专门的入口点，显式传入其载荷，因此在线安装脚本绝不会信任那些恰好摆在临时脚本旁边的压缩包。
- 平台包携带一份目标清单，使显式指定的本地压缩包路径可以被重命名，而不必依赖文件名来做兼容性检查。
- Windows 离线包包含 `install.cmd` 作为双击入口；Linux 与 macOS 包则保持 `install.sh` 的可执行位。
