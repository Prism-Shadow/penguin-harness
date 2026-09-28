# A failed coding agent test says why

- **Date:** 2026-09-28
- **Type:** fix
- **Scope:** `coding-agents`, `server`

When a coding agent's **Test** fails because the agent itself returned an error, the card now shows the agent's own reason instead of "The agent ended its turn: failed." For example, Claude Code with an expired sign-in now reads "The agent stopped with an error: Failed to authenticate: OAuth session expired and could not be refreshed." Values the agent was started with, such as its API keys, are masked in the reason, and it is capped at 500 characters.
