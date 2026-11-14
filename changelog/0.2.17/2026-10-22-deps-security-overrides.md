# Dependencies: MCP SDK 2.3, hono 4.13, smol-toml 1.9 and workspace overrides for 82 Dependabot alerts

- **Date:** 2026-10-22
- **Type:** fix
- **Scope:** `core`, `server`, `cli`, `web`, `tooling`
- **PR:** [#1293](https://github.com/Prism-Shadow/penguin-harness/pull/1293)

[中文版](2026-10-22-deps-security-overrides.zh.md)

Moved every dependency behind 82 of the 117 open Dependabot alerts to its first patched release or later, through direct range bumps, a transitive lockfile refresh and eight workspace override lines. `pnpm audit` went from 99 findings to 17: Electron's 11 and the vitest family's 5 are left to their own changes, and KaTeX's one advisory was left open on purpose — `packages/ui` stays on katex 0.16, because rehype-katex, micromark-extension-math and mermaid 11 accept only 0.16 and 0.18 renamed KaTeX's internal classes.

## Direct ranges

- `@modelcontextprotocol/client` `^2.3.1` (core, cli); `@modelcontextprotocol/server` `^2.3.1` and `@modelcontextprotocol/node` `^2.1.1` (core's test fixtures).
- `smol-toml` `^1.9.1` (core, cli, server).
- `hono` `^4.13.11` and `undici` `^7.29.1` (server).
- `vite` `^7.3.7` (docs, landing, ui-gallery, web).
- `concurrently` `^10.0.6` (root), which brings `shell-quote` 1.12.0.

## Transitive refresh

Within the existing ranges: dompurify 3.4.17 (mermaid, in the web bundle), axios 1.20.0 and follow-redirects 1.16.1 (the Lark SDK), proxy-addr 2.0.8 (express under `@prismshadow/mmsp`), js-yaml 4.3.2 (electron-updater), browserslist 4.29.4, baseline-browser-mapping 2.11.30 and source-map-js 1.2.2. hono resolves to one copy, 4.13.13.

## Workspace overrides

Each line in `pnpm-workspace.yaml` carries its advisories and a removal condition, in the convention of [the @hono/node-server and nanoid overrides](../0.2.2/2026-08-11-deps-hono-node-server-nanoid.md). They cover copies whose parents pin a vulnerable range, or that `pnpm update` does not reach (the electron-builder subtree):

- `qs` `^6.16.0` — express 4 and body-parser 1.20 pin `~6.15.1`.
- `brace-expansion@1` / `@2` / `@5` — minimatch under electron-builder and `@vitest/coverage-v8`; one line per major.
- `fast-uri` `^3.1.8` — ajv under app-builder-lib.
- `@xmldom/xmldom` `^0.8.15` — plist under app-builder-lib.
- `undici@6` `^6.28.1` — node-gyp under `@electron/rebuild`.
- `http-cache-semantics` `^4.3.0` — electron-builder's Electron downloader. The advisory names no patched release; 4.3.0 lies outside its `<= 4.2.0` range.

## Behaviour carried by the upgrades

- **MCP client 2.3.** HTTP transports follow a redirect only within the request's origin (http to https on the same host counts), only when the method is kept, and at most five times. Any other redirect fails the connection with "Redirect to … not followed; use that URL as the endpoint", so an MCP server URL that redirects to another host has to be configured as its final URL.
- **MCP client 2.2.** `listTools()` follows `nextCursor` pages on its own; the provider's per-request timeout still bounds each request.
- **MCP server 2.3.** A `McpServer` serves one connection and a stateless Streamable HTTP transport one request. The two HTTP fixtures in `packages/core/test/mcp-tools.test.ts` build a server and a session-mode transport for each test.
- **smol-toml 1.7–1.9.** `parse()` returns null-prototype objects.
