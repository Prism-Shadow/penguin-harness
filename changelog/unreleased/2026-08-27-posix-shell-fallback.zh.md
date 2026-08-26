# 智能体 Shell 不再假定 macOS 与 Linux 上一定有 bash

- **Date:** 2026-08-27
- **Type:** fix
- **Scope:** `core`
- **PR:** [#484](https://github.com/Prism-Shadow/penguin-harness/pull/484)

[English](2026-08-27-posix-shell-fallback.md)

Shell 解析器在 POSIX 上补齐了 Windows 分支早已具备的回退链。没有它时，`PATH` 中没有 `bash` 的机器上每条命令都会在真正执行前失败。

## 细节

- POSIX 分支无条件解析为裸 `bash`，既不检查其是否存在，也没有替代方案。从图形界面启动的桌面应用继承的是桌面会话的 `PATH` 而非登录 Shell 的 `PATH`，一个被裁剪过的会话 `PATH`——或一个不安装 bash 的发行版——会让每条命令在真正执行前就失败，且应用的每个入口都是如此。
- POSIX 上的解析顺序现在是：`PENGUIN_SHELL`，然后是 `PATH` 中的 `bash`（仍以裸名启动，由子进程按自己的 `PATH` 解析），然后依次是 `/bin/bash`、`/usr/bin/bash`、`/usr/local/bin/bash` 与 `/opt/homebrew/bin/bash`，然后是指向已存在 Shell 的 `$SHELL`，最后是 `sh`。探测走的是 `PATH` 目录遍历而非子进程，因此进程仍不为此付出代价。
- 通过非 bash 步骤解析出的 Shell 会以自身名称告知模型——`zsh`、`sh`——因为那才是它需要书写的语法。
