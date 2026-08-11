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

The agent settings page's Tools tab turns the MCP Servers block from a read-only JSON dump into vault-style management: a table of configured servers plus an Add/Edit form — transport tabs on top (http by default — url / headers; stdio: command / args / env / cwd; shared budget fields prefilled with their effective defaults), deletion behind a confirmation, and immediate persistence — unknown config keys of an entry survive editing. Connectivity testing mirrors the models page: a standalone "Test connection" button in the form probes the current values through the new `POST …/config/mcp-test` route (server-side connect + tool discovery, nothing saved; result as a toast with tool count and latency), and a section-level button tests every configured server sequentially behind a confirm dialog, landing a tone-colored result badge on each row. The server-side PUT now validates every entry through the core transport resolver plus a duplicate-name check, so a broken entry is rejected with a precise 400 at save time instead of being warned-and-skipped at the next Session start.

## Visible connect phase + protocol split (breaking)

Session creation no longer blocks on MCP connects — the first send used to freeze silently while servers connected. The toolset now resolves lazily at the start of the first run, streamed as protocol:

- `session_meta` **drops its `tools` field**; the full schemas follow as a new `tool_list_ready` event once discovery completes, rewritten next to the meta on every post-compaction Trace file. **Explicitly incompatible with pre-split Traces** (deliberate, no compat code kept): their embedded tool record is no longer read or displayed — everything else about old Traces renders unchanged, and no action is required.
- The connect + discovery wait is bracketed by one `mcp_connect_begin` / `mcp_connect_end` pair — the end carries an overall compaction-style `status` (completed / failed / aborted) plus per-server results (servers connect in parallel; the wall time is the pair's timestamp difference). In the Trace the pair and `tool_list_ready` land right after the run's input, inside the new turn — a resumed session's reconnect included. The web chat renders the phase as a unified step row (the reasoning-&-tools group-header shell, sticky title bar included, shared with the compaction row): running/success/failure keep one shape, the settled row leads with the discovered-tool count and names unavailable servers, and expands into one group per server — status, tool count and that server's connect time — each opening into its tool list or failure detail; the CLI prints paired `[mcp]` lines (failure reasons inline on the end line); the analysis timeline renders an "mcp connect" span under its own "other" legend category (not a tool execution). Aborting mid-connect cancels the attempt — the next send reconnects; continuing a conversation never reconnects (the engine survives across tasks). Trace event rows render tool parameter schemas as a property table instead of raw JSON.
- Credential validation stays at Session-creation time (the server's `model_credential_missing` 400 is preserved); a resumed session no longer blocks on MCP either, at the price of trace-corruption errors surfacing on the first run instead of at resume.

Existing configs are unaffected: `mcpServers` defaulted to `[]` and the inner `config` object was never interpreted before, so no stored shape changes and no migration is involved. Docs: the tools, configuration, interfaces, web-app and omni-message pages (zh + en) document the schema, events and semantics.
