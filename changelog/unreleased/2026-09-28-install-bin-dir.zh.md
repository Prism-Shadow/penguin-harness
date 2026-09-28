# install.sh：`penguin` 链接的落点可选

- **Date:** 2026-09-28
- **Type:** feature
- **Scope:** `tooling`, `docs`

[English](2026-09-28-install-bin-dir.md)

`install.sh` 的安装目录可由 `PENGUIN_INSTALL_DIR` 指定，`penguin` 符号链接却一律建在 `~/.local/bin`。现在链接目录也可设置，一份安装连同它的命令可以放进同一个可整体删除的目录——测试或并行的另一份实例不必再改 `HOME` 来保持 `~/.local/bin` 干净。

## 细节

- `PENGUIN_BIN_DIR=<dir>` 或 `--bin-dir <dir>` 指定放置 `penguin` 的目录，默认仍为 `~/.local/bin`。必须是绝对路径；相对路径在下载与暂存之前即被拒绝。
- 「不在 PATH 中」的提示给出所选目录；默认目录仍打印为 `$HOME/.local/bin`。
- `--no-modify-path` 优先于链接目录：不建链接也不建目录，因此继承来的 `PENGUIN_BIN_DIR` 不会改变机器安装的行为。
- `scripts/test-installer.sh` 以空 `HOME` 分别用两种写法安装，断言 `HOME` 下没有写入任何东西。
- CLI 快速开始文档（中英）列出了新选项。
