# 新增 Keenable 搜索插件

- **Date:** 2026-11-08
- **Type:** feature
- **Scope:** `plugins`, `docs`

[English](2026-11-08-use-keenable.md)

`use-keenable` 加入插件库的办公效率分类，排在 `use-firecrawl` 旁边。它带一个 MCP 服务器和一个 Skill。`keenable` 服务器是指向 `https://api.keenable.ai/mcp-public` 的 Streamable HTTP 条目，不需要 key 或请求头，插件装上即可连接；它的两个工具 `search_web_pages` 与 `fetch_page_content` 声明了 `readOnlyHint`，在默认的 `auto` 权限下无需审批即可运行。`keenable` Skill（`2026.11.08.1`）让 Agent 优先使用这两个工具；没有这些工具时用 curl 调 REST API：`/v1/search/public` 与 `/v1/fetch/public` 带 `X-Keenable-Title` 请求头，或 `/v1/search` 带 Vault 中的 `KEENABLE_API_KEY`，key 只用于提高免 key 调用的限额（每个 IP 每秒 10 次、每小时 1000 次）。

## 细节

- 卡片标记 `preinstall: false`：`default_agent` 不会预装此插件，Agent 默认使用的搜索方式也不变，需要时从插件库安装。
- 服务器、CLI、桌面应用与官网与其他内置插件一样，把 `@penguinharness/use-keenable` 列为依赖。
