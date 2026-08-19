# Harness 自己的端口不再冲突：移出 Agent 环境，也移出开发服务器

- **Date:** 2026-07-29
- **Type:** fix
- **Scope:** `core`, `tooling`
- **PR:** [#100](https://github.com/Prism-Shadow/penguin-harness/pull/100)

[English](2026-07-29-harness-env-and-dev-ports.md)

有两处地方，PenguinHarness 的监听端口到达了它本不该到达的位置。

## `PORT` 不再泄漏进 Agent 运行的命令

`penguin web` 把 `PORT` 与 `HOST` 写进自己的 `process.env`，以此作为与 server 模块通信的通道，而命令 Environment 是直接从 `process.env` 构建子进程环境的。于是每一次 `exec_command` 都继承了 `PORT=7364`——而 `npm run dev`、Vite、Next 以及大多数 Express 模板都会读 `PORT`，因此被要求启动开发服务器的 Agent 会试图绑定 **Harness 自己的端口**，而不是另选一个。

子进程环境现在会丢弃 `PORT`、`HOST`，以及内部的 `PENGUIN_CLI_ENTRY` / `PENGUIN_WEB_DIST`。这些键是被移除而不是置空，因为程序可能只检测 `PORT` 是否存在而不看取值。即便该值来自用户的 shell（`PORT=3000 penguin web`），剥离同样适用：它依然意味着「PenguinHarness 所在的端口」，而这正是被派生的服务器必须避开的那个端口。Agent 的 vault 在此之后应用，因此在那里刻意设置 `PORT` 仍然能到达命令。

`PENGUIN_HOME` 与其他面向用户的 `PENGUIN_*` 设置被刻意保留——一个正在开发 PenguinHarness 本身的 Agent 完全可能正当地需要同一个数据根目录，这属于配置决定而非泄漏。

## 开发用后端从 7364 迁走

`pnpm dev:server` 与已安装的 `penguin web` 绑定同一个端口，而这两者经常同时运行。结果要么是开发服务器绑定失败，要么——更安静也更糟——Vite 代理连的是**已安装**的那个服务器而不是正在开发的这个，于是代码改动看起来毫无效果。

开发用后端现在监听 **7368**；7365、7366 与 7367 已分别是 web、landing 与 docs 的开发服务器。`pnpm dev:web` 仍在 7365 且仍是要打开的地址——变的只是它代理到哪里。完整的端口分配记录在 `core/internal/ports.ts` 中，那是读者会去查的地方，尽管开发端口本身不得不在 vite 配置与 package.json 脚本里写成字面量。

覆盖依然有效，而且现在会一起移动：开发脚本只在 `PORT` 未设置时才施加它，而 Vite 代理读取 `PORT` 并以 7368 作为回退，因此改动后端端口会带着代理一起走，而不是把它留在旧地址上。

开发用**数据根目录**当初正是为了同样的理由与已安装的分离；这次是把端口这一半也做完。
