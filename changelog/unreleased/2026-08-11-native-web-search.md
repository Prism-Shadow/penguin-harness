# Native web search and web-access roadmap

PenguinHarness now ships a native `web_search` tool backed by SearXNG. It sends a bounded search
request to a host-configured endpoint and returns normalized titles, HTTP(S) URLs, snippets, and
publication dates. Search output is explicitly labeled as untrusted external content. The model can
choose the query, result count, language, safe-search level, and freshness window, but cannot choose
the provider endpoint or turn the tool into an arbitrary URL fetcher.

The endpoint resolves in this order: an injected SDK service override, the Agent Vault's
`SEARXNG_ENDPOINT`, the process environment's `SEARXNG_ENDPOINT`, then
`http://127.0.0.1:8080`. SearXNG must have JSON enabled in `search.formats`.

`web_search` uses the existing read-only (`r`) permission, so the CLI and Server automatically allow
it in `read-only` mode. The tool-permission model remains the existing `r` / `rw` pair.

New and reset Agents receive `web_search` in their default tool list. Existing Agents retain their
persisted list and must restore defaults or add the definition manually. The follow-on native web
roadmap is: static `web_fetch`, an optional Playwright fallback for dynamic
pages, and a tightly bounded `web_crawl`. Firecrawl remains an optional integration rather than a
required runtime dependency. Installer-managed local SearXNG provisioning and health checks remain
a separate planned phase; this release supplies the native client and defaults its endpoint, but
does not start a search daemon.
