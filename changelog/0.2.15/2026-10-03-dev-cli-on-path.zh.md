# 开发实例自己的 CLI 应答 `penguin`：Agent 命令与终端皆然

- **Date:** 2026-10-03
- **Type:** fix
- **Scope:** `server`, `tooling`, `docs`
- **PR:** [#955](https://github.com/Prism-Shadow/penguin-harness/pull/955)

[English](2026-10-03-dev-cli-on-path.md)

Web App 开发服务器（`pnpm dev`）与桌面端开发运行（`pnpm desktop`）现在把自己构建的 CLI 同时交给 Agent 的命令和终端面板。此前开发实例里这个 CLI 加载即失败，新开的终端运行的则是机器上装的那个 `penguin`。

## 开发预构建

- `scripts/dev-prebuild.mjs` 在 core 与 CLI 之间构建 `packages/hmr` 和 `packages/server` 的 JavaScript。CLI 在运行时导入服务器的模块（锁、Token 铸造、版本报告）；开发服务器以 `tsx` 直跑源码，从不构建它们，于是 `<root>/bin/penguin` 停在 `penguin-server/dist/…` 的 `ERR_MODULE_NOT_FOUND`。
- `PENGUIN_BUILD_JS_ONLY=1` 让服务器构建跳过类型声明，并保留此前完整构建留下的声明。预构建在 24 核机器上约 7 秒（此前 3.6 秒；带服务器声明则 15 秒）。
- 服务器的构建脚本同时重新生成 `src/ifaces.json`，开发服务器因此以最新的接口表启动。
- `pnpm desktop` 本就构建全部包，其 CLI 照常加载。

## 终端

- 终端面板打开的每个终端，都在用户自己的启动文件运行之后，把服务器 CLI 垫片所在目录（即 Agent 命令拿到的那个）放到 PATH 最前：bash 经 `--rcfile`，zsh 经一个 `ZDOTDIR`（其中的文件转而加载用户自己的），fish 经 `--init-command`，PowerShell 经 `-NoExit -Command`，cmd 经 `/K`，sh、dash 与 ash 经 `ENV`。其余 shell 只把该目录放到继承来的 PATH 最前。
- 这些启动文件位于 `<root>/shell-startup/`，内容变化时才重写，不输出任何内容。用户的别名、提示符和历史都保留，macOS `path_helper` 排出的顺序也保留，只是排在垫片之后。
- bash 终端现在是自行运行登录文件的交互式非登录 shell：`logout` 会提示改用 `exit`，`~/.bash_logout` 不再读取，Debian 系系统上 `/etc/bash.bashrc` 会运行两次。
- 配置、对话与 CLI 快速开始文档相应补充了说明。

## 兼容性

未加兼容代码：`<root>/shell-startup/` 是新目录，旧版服务器不会读取。
