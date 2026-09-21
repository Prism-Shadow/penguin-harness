# Coding-agent sessions: pick an agent, pick a model, start

- **Date:** 2026-09-21
- **Type:** feature
- **Scope:** `coding-agents`, `server`, `web`
- **PR:** [#28](https://github.com/nicolaepocroianu/penguin-harness/pull/28)

Starting a coding-agent session now works like starting a chat: choose the agent, optionally choose a folder, start. The agent's own settings — the model dropdown above all — appear in the session as soon as it opens.

## Details

- The New Session dialog offers the saved agents in a dropdown and a folder browser that defaults to a temporary workspace: an empty folder means the server auto-creates one, the same contract chat sessions have (`agentHome/<agent>/workspaces/tmp-<8hex>`), so starting a session no longer requires typing an absolute path.
- Agents advertise their session settings over ACP as config options (`session/new`'s `configOptions` — the model selector lives there). The kernel projects them into the session view and the event log, applies changes via `session/set_config_option`, and relays the agent's live `config_option_update` pushes.
- The session toolbar renders each option next to the composer — selects as dropdowns (Model included), booleans as on/off pills — and updates in place from the session's stream.
