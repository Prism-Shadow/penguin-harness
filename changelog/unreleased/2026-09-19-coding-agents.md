# Coding agents: drive external ACP agents from the Web App

- **Date:** 2026-09-19
- **Type:** feature
- **Scope:** `server`, `web`

The server can now run external coding agents — Claude Code, Codex, Gemini CLI, or any command
that speaks the [Agent Client Protocol](https://agentclientprotocol.com) v1 over stdio — as
subprocesses, and the Web App gains a **Coding agents** section that configures them, starts
sessions against a workspace folder, and watches them live: streamed text and thinking,
per-tool-call cards with input and output, permission asks answered in place, mode switches,
and context-usage-driven turn ends.

- A new kernel package, `@prismshadow/penguin-coding-agents`, owns the protocol: it spawns the
  agent command, negotiates the ACP handshake, and maps `session/update`, permission requests
  and elicitation onto a protocol-neutral event vocabulary. It knows nothing about HTTP,
  storage or Penguin's domain; the official `@agentclientprotocol/sdk` dependency appears
  nowhere else.
- The server wires that kernel in as a `CodingAgents` mechanism with routes under
  `/api/coding-agents`: agent definitions (admin-managed, persisted as the
  `coding_agent_servers` server setting — absent rows keep the default, so no migration),
  session lifecycle, a per-session SSE channel on the existing ChannelHub (Last-Event-ID
  replay and `resync_required` come for free), and one `202` prompt endpoint whose turn
  streams like a session task. Spawned agents get an allow-list of the server's environment —
  path/locale/proxy plumbing plus the definition's own vars and a per-agent data folder under
  `<data root>/coding-agents/<id>` — never a wholesale `process.env`. Reading agents and
  running sessions requires only a signed-in account, the same trust level as creating a
  Session in an arbitrary workspace.
- The page follows the app's standing patterns: tone tokens for every status mark, folding
  tool-call details, formatting hints kept visible in the field hints, and every string in the
  English dictionary.

Coding-agent sessions are deliberately not core Sessions yet: they keep no Trace, no usage
accounting and no model config, and they live for the server process's lifetime. Making them
first-class — a session `source`, Trace adoption, resume — is the natural follow-up, as is
relaying agent elicitation (login forms) to a human instead of auto-cancelling it with a
notice.
