# Use Codex

Verified against Codex CLI 0.146.0 and its generated app-server v2 schema. The bridge rejects protocol errors rather than retrying with weaker approval settings.

Install **Use Codex** from Penguin's Plugins library onto an agent. Open the installed **codex** skill for the MCP setup snippet, then connect your ChatGPT account using its device code. Requires Node 24+ and the official Codex CLI on the Penguin server machine; on Windows configure the absolute `codex.exe` path if it is not on PATH.

The plugin adds an explicit delegated-agent workflow through Penguin's existing MCP configuration. Penguin keeps the parent task, approvals for its tools, and final review. Codex owns its delegated thread, edits, and execution. It does not appear in the model picker and does not change AgentHub.

Tools: `codex_status`, `codex_connect`, `codex_disconnect`, `codex_models`, `codex_run`, `codex_poll`, `codex_cancel`, `codex_respond`. Progress is reported by cursor-based polling. Each MCP connection runs one task at a time. Closing the connection interrupts work; save the returned Codex thread ID to resume later. Pending human requests expire after five minutes; tasks are limited to thirty minutes.

Sign-in is stored by Codex in `<Penguin project data directory>/coding-agents/codex`, shared by sessions using that project's connection. The bridge does not inherit your desktop Codex credentials or host API keys. Keep this directory private; ordinary OS account permissions still apply. The initial sandbox is read-only; editing must explicitly select workspace-write. Command/file approvals and user questions are relayed for human responses. Other server request types are rejected.

This is an opt-in plugin with MCP setup, not a dedicated Coding Agents page. It does not migrate existing configuration. Sign-in and a live subscription task need validation with your account after installation.
