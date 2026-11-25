# 修复 `pnpm dev` 下开发后端无法启动

- **Date:** 2026-11-25
- **Type:** fix
- **Scope:** `tooling`
- **PR:** [#1854](https://github.com/Prism-Shadow/penguin-harness/pull/1854)
- **Issue:** [#1834](https://github.com/Prism-Shadow/penguin-harness/issues/1834)

[English](2026-11-25-dev-server-stdin-deadlock.md)

`scripts/dev-server.mjs` 现在只在 stdin 是终端时才把它传给 tsx，否则给子进程 `ignore`。`pnpm dev` 通过 concurrently 把两端都接到管道上，而这条共享管道会让服务端在 Windows 上死锁：tsx watch 在它上面监听回车键，服务端又继承了同一个句柄，于是启动过程卡在加载 `node:process`，始终不绑定 `127.0.0.1:7368`——每个 `/api` 请求都被 Vite 代理以 `ECONNREFUSED` 返回，App 报 `not_the_server`。

## 细节

- 本仓库中走进卡死的入口是 core 的 MCP provider 加载 `@modelcontextprotocol/client`，日志里最后一个加载项是 `node:process`。机制出自 tsx 的说明：tsx [#623](https://github.com/privatenumber/tsx/issues/623)。
- stdin 是终端时仍原样传入，因此在终端里直接跑 `pnpm dev:server` 仍可用 tsx 的回车重跑；`pnpm dev` 下该按键关闭。
- 数据根目录的 `--exclude` 参数——保留 `tsx watch` 而非裸监听器的原因——保持不变。
