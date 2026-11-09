# Keenable Search plugin

- **Date:** 2026-11-08
- **Type:** feature
- **Scope:** `plugins`, `docs`

[中文版](2026-11-08-use-keenable.zh.md)

`use-keenable` joined the plugin library under Office Productivity, beside `use-firecrawl`. It carries one MCP server and one Skill. The `keenable` server is a Streamable HTTP entry for `https://api.keenable.ai/mcp-public`, which needs no key or header, so it connects as soon as the plugin is installed; its two tools, `search_web_pages` and `fetch_page_content`, advertise `readOnlyHint`, so they run without approval under the default `auto` permission. The `keenable` Skill (`2026.11.08.1`) tells the agent to use those tools and, without them, to call the REST API with curl: `/v1/search/public` and `/v1/fetch/public` with an `X-Keenable-Title` header, or `/v1/search` with `KEENABLE_API_KEY` from the vault, which only lifts the keyless rate limits (10 requests per second and 1000 per hour per IP).

## Details

- The card carries `preinstall: false`: `default_agent` does not get the plugin, and nothing else changes which search an agent uses. It is installed from the library on demand.
- The server, the CLI, the desktop app and the landing site list `@penguinharness/use-keenable` as a dependency, as they do every built-in plugin.
