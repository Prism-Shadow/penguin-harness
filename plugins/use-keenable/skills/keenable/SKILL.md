---
name: keenable
description: "Search the web and read pages as markdown with Keenable: the keyless keenable MCP server, or curl against the REST API, with an optional vault-stored API key for higher rate limits."
version: 2026.11.08.1
---

# Keenable

Keenable is a web search API built for agents. Two calls cover most web work: search to discover pages by query, fetch to read a page you already have as markdown. Both work without an account; an API key only lifts the rate limits. Use it whenever a task needs current web information or the content of a specific page.

## Before you start

If the user's message only invokes this skill (e.g. "use keenable skill") without a concrete task, ask what they want to search or read. No key is needed to start.

## MCP tools first

Installing this plugin adds the `keenable` MCP server (`https://api.keenable.ai/mcp-public`, no key needed). When its tools are in your tool list, use them:

- `mcp__keenable__search_web_pages`: `query` (describe the page you want, not bare keywords), optional `max_results` (1-50, default 10), `site` (e.g. `docs.python.org`), `published_after` (`7d`, `2026-01-01`) for recent results.
- `mcp__keenable__fetch_page_content`: `url`; returns the page as markdown.

## curl

Without the MCP tools (or from a script), call the REST API. The keyless endpoints need an `X-Keenable-Title` header naming the app:

```bash
curl -sS -X POST https://api.keenable.ai/v1/search/public \
  -H "X-Keenable-Title: PenguinHarness" -H "content-type: application/json" \
  -d '{"query": "<what you are looking for>", "max_results": 5}' \
  | jq '[.results[] | {url, title, snippet, published_at}]'
```

- Results live in `.results[]`, each with `url` / `title` / `snippet` / `published_at`; read `snippet`, `description` is always empty.
- Optional filters in the body: `"site": "docs.example.com"`, `"published_after": "7d"` (or a date).

```bash
curl -sS -G https://api.keenable.ai/v1/fetch/public \
  -H "X-Keenable-Title: PenguinHarness" --data-urlencode "url=<page url>" \
  | jq -r '.content' > <topic>.md
```

- The response carries `content` (markdown), `title` and `url`.

## Higher limits with a key

Keyless calls allow 10 requests per second and 1000 per hour per IP. If the user has a Keenable API key, it goes into this agent's **key vault** as `KEENABLE_API_KEY` (gear icon on the agent card → settings → key vault tab; keys from https://keenable.ai). Vault values reach your shell on the next task. With the key set, drop `/public` from the path and send the key instead of the title header:

```bash
[ -n "$KEENABLE_API_KEY" ] && echo ok || echo missing
curl -sS -X POST https://api.keenable.ai/v1/search \
  -H "X-API-Key: $KEENABLE_API_KEY" -H "content-type: application/json" \
  -d '{"query": "<what you are looking for>", "max_results": 5}'
```

## Workflow and context economy

Search first for discovery, fetch once you have the URL. Never dump full page markdown into your context or reply: pipe it to a file (as above) and read the relevant parts with shell (`grep`/`sed`), then cite the page URL for every claim you take from it.

## Errors

- `429`: rate-limited, wait for `Retry-After` and report to the user; do not retry-loop. A key in the vault lifts the limit.
- `401` on the keyed path: missing or invalid key, re-check the vault entry name `KEENABLE_API_KEY`.
- `400` on a keyless call without `X-Keenable-Title`: add the header.
- Anything else: https://docs.keenable.ai is the source of truth for request and response schemas.
