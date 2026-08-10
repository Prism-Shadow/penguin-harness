# MCP Server support: stdio, Streamable HTTP and SSE transports

`tools.mcpServers` in `system_config.yaml` — until now a reserved, empty seam — is wired to a real MCP (Model Context Protocol) client, built on the official TypeScript SDK v2 (`@modelcontextprotocol/client` 2.0.0, spec revision 2026-07-28). Each entry keeps the spec's `{ name, config }` shape; `config` describes one of three transports (#242, closing #239 and #229):

- `stdio` — spawn a local server process (`command` / `args` / `env` / `cwd`);
- `http` — Streamable HTTP, the current spec's remote transport (`url` / `headers`);
- `sse` — the legacy HTTP+SSE transport for servers that have not migrated (`url` / `headers`).

`transport` may be omitted when inferable (`command` → stdio, `url` → http); `sse` stays explicit. Entries share optional `connectTimeoutMs` (connect + discovery budget, default 10 s) and `timeoutMs` / `maxOutputLength` bounds applied to every tool of that server.

## Behavior

- The first `listTools()` (Session assembly) connects all servers in parallel and discovers tools once; the result is a Session-lifetime snapshot (`tools/list_changed` is ignored). Invalid entries and unreachable servers are skipped with a stderr warning — Session creation is never blocked.
- Discovered tools join the flat tool namespace as `mcp__<server>__<tool>` and run through the existing Environment execution contract unchanged: framing, per-tool timeout, front-truncation, interruption and the approval flow all apply.
- Read-only approval mode: a tool the server annotates `readOnlyHint: true` maps to permission `r`; everything else is `rw` (annotations are untrusted hints, so the default takes the restrictive direction).
- stdio server processes see the SDK's safe inherited env plus the entry's own `env` — the Agent vault is deliberately **not** injected into MCP server processes (unlike command subprocesses); a variable a server needs must be listed in its entry. `cwd` defaults to the Session Workspace. `Environment.dispose()` closes every client, stdio child processes included.
- Results map as: text blocks → output text; image blocks → data-URL images; audio and binary resources → placeholder lines; `structuredContent` serialized only when no text block exists; a server-reported `isError` lands as `stop_reason: "failed"`.

## Web App

The agent settings page's Tools tab turns the MCP Servers block from a read-only JSON dump into vault-style management: a table of configured servers plus an Add/Edit form whose fields follow the chosen transport (stdio: command / args / env / cwd; http & sse: url / headers; shared budget fields), deletion behind a confirmation, and immediate persistence — unknown config keys of an entry survive editing. The server-side PUT now validates every entry through the core transport resolver plus a duplicate-name check, so a broken entry is rejected with a precise 400 at save time instead of being warned-and-skipped at the next Session start.

Existing configs are unaffected: `mcpServers` defaulted to `[]` and the inner `config` object was never interpreted before, so no stored shape changes and no migration is involved. Docs: the tools, configuration and interfaces pages (zh + en) document the schema and semantics.
