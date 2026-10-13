# Agents panel: each subagent shows its own call's description

- **Date:** 2026-10-13
- **Type:** fix
- **Scope:** `web`

[中文版](2026-10-13-subagent-card-binding.zh.md)

When one reply started several subagents at once, a child could be attached to another call. Its node in the agents panel then showed that call's description and thinking level, and its row in the transcript sat under the wrong `run_subagent` card. A child now lands on the call whose `prompt` it was started with, both live and after a reload.

## Details

- A child still shows as soon as it appears. Its opening prompt then moves it onto the call that carried that prompt; if a sibling had taken that card, the two swap.
- Calls with the same prompt are told apart by the `agent_id`, `model_id` and `provider` they name. Among calls identical in all of these, the earliest one still running takes the child.
- A denied call never takes a child, even with the same prompt.
