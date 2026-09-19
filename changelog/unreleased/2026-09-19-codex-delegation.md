# Codex subscription delegation plugin

- **Date:** 2026-09-19
- **Type:** feature
- **Scope:** `skills`, `core`, `cli`, `desktop`

[中文版](2026-09-19-codex-delegation.zh.md)

Added the opt-in Use Codex plugin with an MCP bridge to the official Codex app-server. Penguin retained the parent task while Codex handled explicitly delegated coding work.

## Details

- Added project-scoped ChatGPT device sign-in and sign-out, account limits, and model discovery.
- Added task start, resumable thread IDs, cursor-based progress, cancellation, and human approval/input relay.
- Kept credentials under the project's Codex home and excluded host API keys and desktop credentials from the subprocess environment.
- Shipped setup instructions through the existing plugin library and Agent MCP settings, with read-only execution by default and explicit workspace-write selection for edits.
