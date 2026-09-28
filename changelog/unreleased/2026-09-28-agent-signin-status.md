# A coding agent whose sign-in fails no longer shows Ready

- **Date:** 2026-09-28
- **Type:** fix
- **Scope:** `coding-agents`, `server`

An agent's card on Models → Local CLI now shows **Needs sign-in**, with how to sign in, in three cases where it used to show Ready:

- A Test or a chat turn failed because the agent reported an authentication error, such as Claude Code's "OAuth session expired and could not be refreshed". The card keeps saying so until the agent next completes a turn, a Rescan finds it signed in, or its credentials file changes.
- Claude Code's credentials file exists but holds no sign-in token. The file also keeps MCP sign-ins, and Claude Code empties its own token when a refresh fails. Such a file now counts as "Sign-in unknown", not as signed in.
- A Rescan found the agent signed out. That answer used to give way after five minutes to the credentials file merely existing. It now holds until the credentials file changes.
