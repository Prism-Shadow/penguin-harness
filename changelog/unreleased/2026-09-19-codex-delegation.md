# Codex subscription delegation plugin

- **Date:** 2026-09-19
- **Type:** feature
- **Scope:** `skills`, `core`, `cli`, `desktop`
- **PR:** [#8](https://github.com/nicolaepocroianu/penguin-harness/pull/8)

Added the opt-in Use Codex plugin with MCP tools backed by an ACP client and the maintained Codex ACP adapter. Penguin retains the parent task while Codex handles explicitly delegated coding work.

## Details

- Added project-scoped ChatGPT device sign-in, sign-out and model discovery through an unprompted ACP session.
- Added task start, resumable session IDs, cursor-based progress, cancellation and human permission/form responses.
- Kept credentials under the project's Codex home and excluded host API keys and desktop credentials from the subprocess environment.
- Packaged the ACP runtime and dependencies separately from the installed skill, with setup through existing Agent MCP settings.
- Delegated tasks use workspace-write and on-request human approvals. Ordinary workspace edits may proceed without a prompt. No read-only execution guarantee, automatic approval mode or unrestricted mode is offered.
- Subscription limits are unavailable through this integration; no dollar cost is assigned to subscription work.
