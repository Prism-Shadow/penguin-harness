# 向后兼容

- **Date:** 2026-08-27
- **Type:** process
- **Scope:** `desktop`
- **PR:** [#480](https://github.com/Prism-Shadow/penguin-harness/pull/480)
- **Breaking:** yes — 对 0.2.7 之前那次一次性 `penguin` 询问回答的「Not Now」不会被沿用；命令会在下次启动时自行安装

[English](2026-08-27-backward-compatibility.md)

本批次涉及一处存量状态：桌面应用询问是否安装 `penguin` 命令时写下的标记文件——现在
[应用会自动安装该命令](2026-08-27-desktop-installs-cli.zh.md)。

## `cli-install-offered` 标记

0.2.2 至 0.2.6 的桌面版本会在 `userData` 下写一个空的 `cli-install-offered` 文件，只要它存在
就不再询问。该文件是在对话框弹出**之前**写入的，因此它记录的是「问过了」，而不是「答了什么」——
安装、点了「Not Now」、以及对话框始终没被回答，留下的文件完全相同。所以它不能被当作一次拒绝来读；
若当作拒绝，等于让所有存量安装都拿不到该命令。

选择：**不迁移该标记。**它被忽略，并在新状态文件第一次写入时删除。取而代之的是同一目录下的
`cli-command.json`，它记录最后一次尝试的结果，以及一个单独的决定字段——该字段只有在用户取消
macOS 管理员授权时才会被设置。只有这个决定会停止自动安装。

删除动作是每次写状态时的一次 `rmSync`。它保留到不再有 0.2.2–0.2.6 的安装能升级到当前构建为止；
由准备 0.3.0 的人负责删除，代码处也写有同样的说明。

## 兼容性

无需迁移，也无需任何手工操作。有两点需要知道：

对旧的询问回答过「Not Now」的用户，会在下次启动时被装上该命令，因为那个回答从未被记录下来。移除
只需一条命令——macOS 上删除 `/usr/local/bin/penguin`，Linux AppImage 上删除
`~/.local/bin/penguin`，Windows 上把应用的 `bin` 条目从用户 `Path` 中去掉——但再下一次启动时应用
会重新装上，因为只有被取消的 macOS 管理员授权才会被记为一个决定。

来自其他途径的 `penguin` 绝不会被动到。经 `install.sh` 安装的、全局 npm 包的、或手写的脚本都会
保留在 `PATH` 上，应用什么也不装；跳过的原因记录在 `cli-command.json` 中。
