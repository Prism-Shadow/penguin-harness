# 依赖：MCP SDK 2.3、hono 4.13、smol-toml 1.9 与工作区 override，覆盖 82 条 Dependabot 告警

- **Date:** 2026-10-22
- **Type:** fix
- **Scope:** `core`, `server`, `cli`, `web`, `tooling`
- **PR:** [#1293](https://github.com/Prism-Shadow/penguin-harness/pull/1293)

[English](2026-10-22-deps-security-overrides.md)

117 条未关闭的 Dependabot 告警中，有 82 条背后的依赖已移到首个修复版本或更新的版本，手段是直接调整版本范围、刷新 lockfile 中的传递依赖，以及八行工作区 override。`pnpm audit` 的发现从 99 条降到 17 条：Electron 的 11 条与 vitest 系列的 5 条留给各自的改动处理；KaTeX 的一条通告则有意保留——`packages/ui` 继续使用 katex 0.16，因为 rehype-katex、micromark-extension-math 与 mermaid 11 只接受 0.16，而 0.18 重命名了 KaTeX 的内部 class。

## 直接依赖范围

- `@modelcontextprotocol/client` `^2.3.1`（core、cli）；`@modelcontextprotocol/server` `^2.3.1` 与 `@modelcontextprotocol/node` `^2.1.1`（core 的测试 fixture）。
- `smol-toml` `^1.9.1`（core、cli、server）。
- `hono` `^4.13.11` 与 `undici` `^7.29.1`（server）。
- `vite` `^7.3.7`（docs、landing、ui-gallery、web）。
- `concurrently` `^10.0.6`（根目录），随之带来 `shell-quote` 1.12.0。

## 传递依赖刷新

在现有范围内刷新：dompurify 3.4.17（mermaid，进入 Web 构建产物）、axios 1.20.0 与 follow-redirects 1.16.1（飞书 SDK）、proxy-addr 2.0.8（`@prismshadow/mmsp` 之下的 express）、js-yaml 4.3.2（electron-updater）、browserslist 4.29.4、baseline-browser-mapping 2.11.30 与 source-map-js 1.2.2。hono 收敛为一份副本，4.13.13。

## 工作区 override

`pnpm-workspace.yaml` 中每一行都附上对应的通告与移除条件，沿用 [@hono/node-server 与 nanoid override](../0.2.2/2026-08-11-deps-hono-node-server-nanoid.zh.md) 的写法。它们覆盖的是父包固定在有漏洞范围内、或 `pnpm update` 触及不到（electron-builder 子树）的副本：

- `qs` `^6.16.0`——express 4 与 body-parser 1.20 固定在 `~6.15.1`。
- `brace-expansion@1` / `@2` / `@5`——electron-builder 与 `@vitest/coverage-v8` 之下的 minimatch；每个大版本一行。
- `fast-uri` `^3.1.8`——app-builder-lib 之下的 ajv。
- `@xmldom/xmldom` `^0.8.15`——app-builder-lib 之下的 plist。
- `undici@6` `^6.28.1`——`@electron/rebuild` 之下的 node-gyp。
- `http-cache-semantics` `^4.3.0`——electron-builder 下载 Electron 的组件。该通告没有给出修复版本；4.3.0 位于其 `<= 4.2.0` 范围之外。

## 升级带来的行为变化

- **MCP client 2.3。** HTTP 传输只在请求的同源范围内跟随重定向（同一主机由 http 转 https 也算同源），且要求请求方法不变、最多五次。其他重定向会让连接失败并报 “Redirect to … not followed; use that URL as the endpoint”，因此会重定向到另一主机的 MCP Server URL 需要直接配置为最终地址。
- **MCP client 2.2。** `listTools()` 自行跟随 `nextCursor` 翻页；provider 的单次请求超时仍然约束每一次请求。
- **MCP server 2.3。** 一个 `McpServer` 只服务一个连接，无状态的 Streamable HTTP 传输只服务一个请求。`packages/core/test/mcp-tools.test.ts` 中的两个 HTTP fixture 改为每个测试各建一个 server 与会话模式的传输。
- **smol-toml 1.7–1.9。** `parse()` 返回无原型对象。
