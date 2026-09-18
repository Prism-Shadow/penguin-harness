# Experimental Copilot subscription connection

- **Date:** 2026-09-19
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `model-catalog`, `docs`

[中文版](2026-09-19-copilot-subscription.zh.md)

Added a project-scoped GitHub Copilot device sign-in flow on the Models page. The connection imported accessible tool-capable Chat Completions models and stored the credential through the existing model configuration.

## Details

- Kept model transport in AgentHub and tool execution, approvals, context, and history in Penguin.
- Added server-side polling limits, ownership checks, expiry, cancellation, reconnect, and local credential removal.
- Required an explicitly configured GitHub OAuth App through `PENGUIN_COPILOT_CLIENT_ID`; no other application's identity was reused.
- Left subscription prices unknown and deferred Responses-only models, expiring GitHub App credentials, ChatGPT subscriptions, and ACP.
- Included a pinned development dependency patch pending an AgentHub release. npm distribution and live access with a custom OAuth App remained unverified.
