# Route CLI config and version commands over HTTP and harden client credential boundaries

- **Date:** 2026-11-21
- **Type:** feature
- **Scope:** `cli`, `library/cli`, `server`

[中文版](2026-11-21-cli-config-version-http.zh.md)

`penguin config` (`model`, `set`, `list`, `unset`) and `penguin version --json` now execute through the server's HTTP endpoints (`/api/projects/:projectId/models`, `/api/projects/:projectId/agents/:agentId/vault`, and `/api/version`), and the CLI client preserves explicit `--root` token isolation and prevents Agent subprocesses from falling back to human session cookies.

## Details

- Added `PUT /api/projects/:projectId/agents/:agentId/vault/entries/:key` and `DELETE /api/projects/:projectId/agents/:agentId/vault/entries/:key` to `vaultRoutes` and `AgentConfigService` so single-key vault writes and removals run over HTTP.
- Updated `penguin config` (`set`, `list`, `unset`), `penguin config model` (`add`, `default`, `vision`, `list`, `remove`), and `penguin version --json` to talk to the server's HTTP routes via `ServerClient`.
- Updated `resolveConnection` (`library/cli/src/connection.ts`) so an explicit `--root` combined with a loopback `--server` prefers `<root>/api-token` over ambient `PENGUIN_API_TOKEN`, and updated `ServerClient` (`library/cli/src/client.ts`) so `tokenSource === "env"` or Agent subprocess environments (`PENGUIN_AGENT_ID` / `PENGUIN_SESSION_ID`) never retry `403 human_required` with a human login cookie.
