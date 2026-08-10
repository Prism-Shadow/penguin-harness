# MCP Server support: stdio, Streamable HTTP and SSE transports

`tools.mcpServers` in `system_config.yaml` — until now a reserved, empty seam — is wired to a real MCP (Model Context Protocol) client, built on the official TypeScript SDK v2 (`@modelcontextprotocol/client` 2.0.0, spec revision 2026-07-28). Each entry keeps the spec's `{ name, config }` shape; `config` describes one of three transports (#242):

- `stdio` — spawn a local server process (`command` / `args` / `env` / `cwd`);
- `http` — Streamable HTTP, the current spec's remote transport (`url` / `headers`);
- `sse` — the legacy HTTP+SSE transport for servers that have not migrated (`url` / `headers`).

`transport` may be omitted when inferable (`command` → stdio, `url` → http); `sse` stays explicit. Entries share optional `connectTimeoutMs` (connect + discovery budget, default 10 s) and `timeoutMs` / `maxOutputLength` bounds applied to every tool of that server.

## Behavior

- The first `listTools()` (Session assembly) connects all servers in parallel and discovers tools once; the result is a Session-lifetime snapshot (`tools/list_changed` is ignored). Invalid entries and unreachable servers are skipped with a stderr warning — Session creation is never blocked.
- Discovered tools join the flat tool namespace as `mcp__<server>__<tool>` and run through the existing Environment execution contract unchanged: framing, per-tool timeout, front-truncation, interruption and the approval flow all apply.
- Read-only approval mode: a tool the server annotates `readOnlyHint: true` maps to permission `r`; everything else is `rw` (annotations are untrusted hints, so the default takes the restrictive direction).
- stdio server processes see "SDK safe inherited env → Agent vault → entry `env`" (later wins), so secrets live in the vault rather than the YAML; `cwd` defaults to the Session Workspace. `Environment.dispose()` closes every client, stdio child processes included.
- Results map as: text blocks → output text; image blocks → data-URL images; audio and binary resources → placeholder lines; `structuredContent` serialized only when no text block exists; a server-reported `isError` lands as `stop_reason: "failed"`.

Existing configs are unaffected: `mcpServers` defaulted to `[]` and the inner `config` object was never interpreted before, so no stored shape changes and no migration is involved. Docs: the tools, configuration and interfaces pages (zh + en) document the schema and semantics.
