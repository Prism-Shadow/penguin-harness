# glibc 低于 2.42 的 Linux 机器上终端恢复可用

- **Date:** 2026-11-26
- **Type:** fix
- **Scope:** `release`, `desktop`, `ci`, `server`
- **Issue:** [#1900](https://github.com/Prism-Shadow/penguin-harness/issues/1900)

[English](2026-11-26-linux-pty-old-glibc.md)

0.2.19 与 0.2.20 的 Linux 安装包所带的 node-pty 终端绑定是在 `ubuntu-latest` 运行器上编译的，而该标签已指向 Ubuntu 26.04，因此绑定需要 GLIBC_2.42（用于 `cfsetispeed` 与 `cfsetospeed`）；0.2.4 至 0.2.18 需要的是 2.34。桌面端推送给机器的安装镜像则完全不带 Linux 绑定。于是在 glibc 更旧的 Linux 机器上，所有终端都以 `terminal_spawn_failed` 失败。现在 node-pty 的 Linux 绑定在 manylinux_2_28 容器中构建，只需 glibc 2.28，与随附的 Node 相同；需要更高版本的绑定会让发布失败，而不是被发出去。

## 细节

- `scripts/build-linux-pty.sh` 以 lockfile 锁定的 node-pty 源码，在 `quay.io/pypa/manylinux_2_28_<machine>`（钉在 `2026.11.07-1`）中构建 linux-x64 与 linux-arm64 绑定，经新的可复用工作流 `.github/workflows/linux-pty.yml` 每次运行构建一次。此前在 `node:<version>-bookworm` 中构建、需要 2.34 的 arm64 绑定也改在这里构建。
- `scripts/stage-linux-pty.mjs` 把它们写入 node-pty 安装目录的 `prebuilds/linux-x64` 与 `prebuilds/linux-arm64`，并替换安装时编译的 Linux `build/Release/pty.node`。发布任务暂存工作区与 `lib/`，npm 任务与 CI 的 npm packaging 暂存工作区，桌面端构建在三个系统上都于构建前暂存工作区。安装包的 `lib/` 与随带存储、npm 包的随带存储、桌面端自身的 node-pty，以及每个桌面端推送给机器的安装镜像，都带上了两个绑定。
- `scripts/check-native-glibc.mjs` 读取发布内容中每个 Linux `*.node` 绑定的符号版本——目录、tarball 及其中的归档、安装镜像——当某个绑定需要高于 2.28 的 glibc、放在不符的 `linux-<arch>` 目录下，或缺少应有的绑定时即失败。它在发布前检查每个 payload tarball，并检查 npm 包的随带存储、桌面端的 `dist/` 与插件，以及 CI 的 npm packaging 任务。
- 机器检查不再提示终端需要 glibc 2.34：`TERMINAL_GLIBC` 改为 2.28。
