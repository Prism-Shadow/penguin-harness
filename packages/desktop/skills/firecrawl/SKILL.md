---
name: firecrawl
description: Search the web and scrape pages into clean markdown with the Firecrawl API — query-based discovery, single-URL extraction including public PDFs, driven by curl with a vault-stored API key.
short_description: Web search and page scraping via Firecrawl.
short_description_zh: 用 Firecrawl 做网络搜索与页面抓取。
version: 1
updated: 2026-07-20T14:00:00Z
---

# Firecrawl

Firecrawl turns the live web into agent-ready markdown over a plain REST API (`https://api.firecrawl.dev/v2`, `Authorization: Bearer $FIRECRAWL_API_KEY`). Two calls cover most web work: `/search` to discover pages by query, `/scrape` to extract clean content from a URL you already have. Use it whenever a task needs current web information or the content of a specific page.

## Before you start

If the user's message only invokes this skill (e.g. "use firecrawl skill") without a concrete task, ask what they want to search or scrape. When the task is concrete, check the credential first:

```bash
[ -n "$FIRECRAWL_API_KEY" ] && echo ok || echo missing
```

If missing (also visible in your Vault Keys section), ask the user to add `FIRECRAWL_API_KEY` to this agent's **key vault** — gear icon on the agent card → settings → key vault tab; keys come from the Firecrawl dashboard (https://www.firecrawl.dev/signin). Vault values reach your shell environment on the next task. Only fall back to the keyless tier (below) when the user cannot provide a key right now.

## Search

```bash
curl -sS -X POST https://api.firecrawl.dev/v2/search \
  -H "Authorization: Bearer $FIRECRAWL_API_KEY" -H "content-type: application/json" \
  -d '{"query": "<what you are looking for>", "limit": 5}' \
  | jq '[.data.web[] | {url, title, description}]'
```

- Results live in `.data.web[]`, each with `url` / `title` / `description`; `limit` defaults to 10 (per source).
- Adding `"scrapeOptions": {"formats": ["markdown"]}` returns each result's page content inline — prefer the two-step search → scrape flow instead when only a hit or two matters; content-included search costs far more credits and context.
- Useful filters: `"sources": [{"type": "news"}]` (or `images`), `"includeDomains": ["docs.example.com"]`, `"categories": ["github"]` (or `research` / `pdf`), `"tbs"` for time-bounded queries.

## Scrape

```bash
curl -sS -X POST https://api.firecrawl.dev/v2/scrape \
  -H "Authorization: Bearer $FIRECRAWL_API_KEY" -H "content-type: application/json" \
  -d '{"url": "<page url>"}' \
  | jq -r '.data.markdown' > <topic>.md
```

- Markdown is the default format; the page's main content only (`onlyMainContent` defaults to true). Metadata sits in `.data.metadata` (`title`, `sourceURL`, `statusCode`).
- Public document URLs (PDF, DOCX, …) scrape to markdown the same way.
- JS-heavy pages that come back empty: retry with `"waitFor": 2000`.

## Workflow and context economy

Search first for discovery, scrape once you have the URL. Never dump full page markdown into your context or reply: pipe it to a file (as above) and read the relevant parts with shell (`grep`/`sed`), then cite `metadata.sourceURL` for every claim you take from a page.

## No key available

The keyless free tier only works through official Firecrawl clients and is rate-limited:

```bash
npx -y firecrawl-cli@latest search "<query>"
npx -y firecrawl-cli@latest scrape <url> -o page.md
```

Use it as a stopgap and tell the user to add a real key to the vault — accounts unlock the full API and higher limits.

## Errors

- `401` — missing/invalid key: re-check the vault entry name `FIRECRAWL_API_KEY`.
- `402` / `429` — out of credits or rate-limited: report to the user; do not retry-loop.
- Anything else: `https://docs.firecrawl.dev` is the source of truth for request/response schemas.
