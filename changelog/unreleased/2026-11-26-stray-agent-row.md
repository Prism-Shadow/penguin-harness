# No agent row for a Session a stop hook spawned

- **Date:** 2026-11-26
- **Type:** fix
- **Scope:** `web`

[中文版](2026-11-26-stray-agent-row.zh.md)

Removed the agent row that appeared under the last reply whenever a stop hook answered with a `subagent` request, as the `continual-learning` plugin does after a long Task. The row opened the Agent panel, which had nothing to show for it: the Session a hook spawns runs detached and is not one of the conversation's subagents.

## Details

- The conversation's stream model remembered the Session id a `stop` hook event names in `output.session_id` and dropped the records that Session sends into the parent's stream, so it got no row in the conversation and no nested conversation.
