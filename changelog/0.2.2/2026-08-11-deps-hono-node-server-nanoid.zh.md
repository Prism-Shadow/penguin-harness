# 依赖：@hono/node-server ≥ 2.0.5 与 nanoid ≥ 3.3.17（工作区 override）

- **Date:** 2026-08-11
- **Type:** fix
- **Scope:** `server`, `tooling`
- **PR:** [#264](https://github.com/Prism-Shadow/penguin-harness/pull/264)

[English](2026-08-11-deps-hono-node-server-nanoid.md)

解决 Dependabot 告警 20——GHSA-frvp-7c67-39w9，`@hono/node-server` 的 `serve-static` 在 Windows 上经编码反斜杠（`%5C`）触发的中危路径穿越。server 包的直接依赖本已是 `^2.0.5`（解析到 2.0.12）；那个有漏洞的 1.19.17 副本是由 `@modelcontextprotocol/node` 传递引入的，它固定在 `^1.19.9` 且没有已修复的发布版本。`pnpm-workspace.yaml` 中的一条工作区 override（pnpm 11 只在这里认 override）强制所有副本 ≥ 2.0.5，并附注释写明移除条件；MCP 的 stdio / Streamable HTTP / SSE 传输测试在被强制的版本下全部通过。

同一轮清扫也解决了 `pnpm audit` 剩下的唯一一处发现：`nanoid` < 3.3.17（高危——自定义生成器在 size 为 0 时可能无限循环）。lockfile 中只存在 3.x 的副本，因此该 override 停留在同一大版本内。两条 override 之后，`pnpm audit` 报告**没有已知漏洞**（[#264](https://github.com/Prism-Shadow/penguin-harness/pull/264)）。
