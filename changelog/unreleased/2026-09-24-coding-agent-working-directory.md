# Coding agents start outside the server's own folder

- **Date:** 2026-09-24
- **Type:** fix
- **Scope:** `coding-agents`

A coding agent launched through `npx -y <adapter>` (Codex CLI, and Claude Code without
its adapter installed globally) could fail with "the agent exited before the ACP
handshake completed". The agent process inherited the server's working directory, and
when that directory sat in a project whose dependencies already included the adapter
package (this repository does, through the use-codex plugin), npx treated the package as
installed and ran a command that was never linked there.

Agent processes now start in the system temporary directory. Each session still works
in its own directory, which is sent to the agent when the session opens.
