# 服务器的终端与 Agent 命令运行它自己的 `penguin`，并连接这台服务器

- **Date:** 2026-10-11
- **Type:** fix
- **Scope:** `server`, `cli`, `docs`
- **PR:** [#1037](https://github.com/Prism-Shadow/penguin-harness/pull/1037)

[English](2026-10-11-dev-terminal-cli.md)

用 `pnpm dev` 或 `pnpm desktop` 启动的开发实例里，在终端输入的 `penguin` 可能运行的是已安装的 CLI，或是这个检出的 CLI 却连着已安装的服务器。`<root>/bin/penguin` 启动脚本、终端的环境和 shell 钩子都做了修改，服务器的终端与 Agent 命令现在运行这台服务器自己的 CLI，连接的也是这台服务器。

## 细节

- 启动脚本为它启动的 CLI 把 `PENGUIN_HOME` 设为本服务器的数据根目录，调用方已设置时保持不动；服务器的数据库不在 `<root>/web.db` 时一并设置 `PENGUIN_WEB_DB`（取绝对路径）。`--root`、`--server` 和 `PENGUIN_API_URL` 仍然优先。运行脚本的 shell 不会被导出任何变量。
- 终端不再继承服务器进程的 `PENGUIN_*`、`PORT` 和 `HOST` 变量，core 早已从 Agent 命令中剥除这些变量。继承来的 `PENGUIN_API_URL` 或 `PENGUIN_HOME` 曾让 `penguin` 连到另一台服务器，继承来的 `PENGUIN_CLI_ENTRY` 曾让从终端启动的服务器换用别的 CLI，继承来的 `PENGUIN_HOME` 或 `PORT` 曾让在终端里运行的 `pnpm dev` 与运行中的实例相撞。用户自己的启动文件导出的变量照常设置。没有启动脚本指明数据根目录时（服务器不提供 CLI、启动脚本缺失，或热推送的平台运行在更早的运行时上），终端照旧保留 `PENGUIN_HOME` 和 `PENGUIN_WEB_DB`。
- bash、zsh 和 fish 除了在启动文件之后执行 PATH 语句，还把它注册为最后一个提示符钩子（`PROMPT_COMMAND`、`precmd_functions`、`fish_prompt` 事件），因此把另一个 `penguin` 放到最前的提示符钩子不再从第一个提示符起占上风。钩子不改动上一条命令的退出码，自身也从不失败，所以开了 `set -e` 的 shell 与 ERR、ZERR trap 的表现与没有钩子时一样；钩子加进已导出的 `PROMPT_COMMAND` 的那一项，在终端里再启动的 bash 中什么也不做。5.1 之前的 bash 遇到数组形式的 `PROMPT_COMMAND` 时，钩子并入它的第一个元素。在这样的终端里，用完整路径或名为 `penguin` 的 alias、函数，仍可运行别的 `penguin`。
- 从 TypeScript 源码运行的服务器（`pnpm dev`）用检出自己的 tsx 运行检出的 CLI 源码，改了 CLI 或拉了新提交都不必重启。以构建产物运行的服务器（`pnpm desktop`、`node packages/server/dist/index.js`）使用检出构建出的 CLI；两者互为后备，Electron 只用构建产物。
- 从检出运行、而检出的 CLI 两种方式都跑不起来的服务器，会写入一个打印原因并以 1 退出的启动脚本，而不是删掉启动脚本、任由 PATH 上的其他 `penguin` 顶替。服务器日志也会写明。
- 从检出运行的服务器，其每个终端的第一行写明 `penguin` 运行的是哪份 CLI、连接哪个数据根目录，或者它为什么跑不起来；安装版的终端没有这一行。无论哪种，启动脚本缺失的终端都会在第一行说明这里的 `penguin` 由 PATH 决定。
- `penguin chat` 与 `penguin run` 的开场横幅显示 `penguin --version` 打印的构建标识（源码构建带提交号），以及所连接的服务器；经数据根目录找到服务器时一并写出该目录。
- CLI 参考文档、配置页与 CLI 快速开始页补充了启动脚本的数据根目录、终端的环境，以及在终端里如何运行别的 `penguin`。
