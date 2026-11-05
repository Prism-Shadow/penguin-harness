# Agent 的 `penguin` 就是正在运行它的那套 harness

- **Date:** 2026-09-09
- **Type:** feature
- **Scope:** `core`, `server`, `desktop`, `tooling`, `docs`
- **PR:** [#658](https://github.com/Prism-Shadow/penguin-harness/pull/658)

[English](2026-09-09-agent-cli-on-path.md)

Agent 执行的每一条命令，现在都会在 PATH 最前面先找到本安装自己的 `penguin`。服务端会在其数据根目录写下一个启动脚本 `<root>/bin/penguin`——它用服务端自己的 Node 运行本安装启动时所用的那个 CLI 入口——每个 Session 则把该目录置于它所派生命令的 PATH 最前。于是一条要求 harness 做事的命令，触达的就是它正运行其中的那套 harness，而不是机器上恰好全局安装的那个版本。

## 细节

- CLI 入口在环境中带有 `PENGUIN_CLI_ENTRY` 时即取该值——`penguin server` / `penguin web` 会导出自身入口，桌面外壳现在也会把应用内置的 CLI 传给它 fork 出的服务端进程。否则由服务端解析它被加载自的那个检出：向上走到存放 `pnpm-workspace.yaml` 的目录，若其 `packages/cli/dist/penguin.js` 存在则取之。启动时会用一行日志点名该入口，或说明未找到任何入口。
- 该启动脚本在每次启动时重写，因此安装位置的变动会在下次启动被跟上。没有可指向的入口时，则删除早先启动留下的脚本：指向一个已不存在的路径，比根本没有 `penguin` 更糟。在 Windows 上还会一并写出 `<root>/bin/penguin.cmd`——那里的命令既可能跑在 `cmd`/PowerShell 里，也可能跑在内置的 bash 里。
- 该目录被前置了两次：一次在子进程环境中，一次作为命令字符串前的一条语句（Bourne 系 shell 用 `export PATH=…`，PowerShell 用 `$env:PATH = …`，`cmd` 用 `set "PATH=…"`）。命令经由登录 shell 执行，而登录 profile 往往会在子进程环境设定之后重写 PATH；只有这条语句执行得足够晚，才真正说了算。PATH 语法不属于这三种的 shell——`fish`，或 `PENGUIN_SHELL` 所指的任何东西——只得到环境那一半。除此之外命令原样不动，退出状态亦然，宿主为后台进程列出的命令仍是 Agent 自己写的那一条。
- Hook 脚本的 PATH 最前面也会得到同样的目录。它们是被直接派生的，中间没有 shell，因此能设置的就只有环境。
- `scripts/dev-prebuild.mjs` 现在会与 `packages/core` 一同构建 `packages/cli`，好让开发版 server 有一个当前的 CLI 可指向。改动 CLI 源码后仍需 `pnpm --filter @prismshadow/penguin-cli build`——`tsx watch` 不会重建它。
