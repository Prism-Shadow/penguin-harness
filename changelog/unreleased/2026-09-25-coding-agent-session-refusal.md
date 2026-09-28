# A coding agent that refuses a session says why

- **Date:** 2026-09-25
- **Type:** fix
- **Scope:** `coding-agents`

When a coding agent started but would not open a session, the Models page showed only
"the agent refused to open a session". The agent's own reason now follows it, as it
already did for a refused handshake — for example Gemini CLI's "This client is no longer
supported for Gemini Code Assist for individuals", which Google now returns for the
**Log in with Google** sign-in. Opening a session sends the agent no user content, so its
answer is safe to show.
