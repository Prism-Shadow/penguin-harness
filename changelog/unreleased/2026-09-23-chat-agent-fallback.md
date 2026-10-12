# A conversation whose Agent this server does not list still renders

- **Date:** 2026-09-23
- **Type:** fix
- **Scope:** `web`
- **PR:** [#834](https://github.com/Prism-Shadow/penguin-harness/pull/834)

[中文版](2026-09-23-chat-agent-fallback.zh.md)

Opening an organization's desk whose Agent lives on a machine left the chat page on its
Agent placeholder for good — no error, no warning, and a reload did not help.

## Details

- The chat page renders under the routed Session's own Agent id. It used to render under the
  current Agent, which it adopts from the Session only when this server's Agent list carries
  that Agent; a machine-only Agent never is, and only the direct-lookup path refetched the
  list, which a Session already listed never reaches.
- When the Session's Agent is not adopted as the current one, a `console.warn` names the
  Agent and the Session, once per Session.
