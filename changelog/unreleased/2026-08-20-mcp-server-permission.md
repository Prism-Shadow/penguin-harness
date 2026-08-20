# Per-server permission for MCP Servers

- **Date:** 2026-08-20
- **Type:** feature
- **Scope:** `core`, `web`, `docs`

[中文版](2026-08-20-mcp-server-permission.zh.md)

An MCP Server entry gained an optional `permission` key with three states — `auto` (the
default), `r` and `rw` — that fixes the approval level of every tool that server exposes.
Under `auto` each tool keeps the level its own `readOnlyHint` annotation implies, which is
what shipped before. `readOnlyHint` is optional in the MCP spec and many servers never set
it, so their whole toolset landed on `rw` and stopped for approval on every call; an
explicit `r` or `rw` now overrides the annotation for all of them at once.

## Details

- `tools.mcpServers[].config.permission` sits alongside `connectTimeoutMs`, `timeoutMs`
  and `maxOutputLength`, and like them applies to every tool of that server. A value that
  is not `auto`, `r` or `rw` makes the entry invalid: the resolver reports a warning and
  skips that server, so a typo in hand-edited YAML costs one server rather than the Agent.
- The level is per server, not per tool — the setting is made when a server is added,
  before any tool has been discovered.
- The Web App's Add/Edit MCP Server modal carries the control, with the same three-way
  option menu the builtin tool table uses plus the `auto` state, and the server table lists
  each entry's effective level. Saving `auto` writes no key, so an entry that was never
  given an explicit level keeps following the default.

## What the flag governs

`permission` decides which of a server's tool calls PenguinHarness stops for human
approval. That is the whole of it. It is not a sandbox: it does not restrict what the
server's tools do once they run, it is never sent to or verified against the server, and
the server keeps whatever capabilities its transport gives it. Marking a server `r` that
can in fact write removes the prompt that would have caught the write.
