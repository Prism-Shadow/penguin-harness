# 沙盒自带 bubblewrap，并不再依赖 PATH

- **Date:** 2026-09-16
- **Type:** fix
- **Scope:** plugins, build
- **PR:** [#771](https://github.com/Prism-Shadow/penguin-harness/pull/771)

[English](2026-09-16-bwrap-vendored.md)

Linux 上的封禁不再依赖主机装了 bubblewrap。多数发行版并不预装它，各机器版本也不一致，而一套没人执行过 `apt install bubblewrap` 的部署，沙盒其实就是关着的。

- **插件自带 `bwrap`**，按架构各一份（`linux-x64`、`linux-arm64`），连同它加载的 libcap 与两份许可证一起随包发出。`scripts/vendor-bwrap.mjs` 在构建时从 conda-forge 取回，按确切 URL 与 sha256 钉死——哈希对不上即构建失败，绝不发出没钉死的二进制。该二进制通过 `$ORIGIN/../lib` 的 rpath 找到自己的库，因此只改写 argv、无从设置环境变量的后端也能直接用它。
- **每次启动命令时的取用顺序：** 插件自带的，其次才是 PATH 上的 `bwrap`。两者皆无的主机仍然 fail closed，并且提示去看 `kernel.unprivileged_userns_clone`，而不再问「装没装 bubblewrap」。
- **macOS 没有可自带的东西，现在也不再依赖什么。** `sandbox-exec` 属于操作系统本身、且发行权在 Apple，因此 Seatbelt 后端改为以绝对路径 `/usr/bin/sandbox-exec` 指名它，而不再走 PATH 查找：PATH 里没有 `/usr/bin`、或有另一个同名程序排在前面，都不再决定谁来封禁命令。
- 该后端的实机封禁测试——工作区可写而外部不可写、`read-only` 连工作区也拒绝、后台子进程一并受限、`network: none` 只剩回环、被屏蔽目录读起来是空的——现在是在一台自身没有 bubblewrap 的主机上、针对自带二进制跑通的。
