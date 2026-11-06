# Copy an agent

- **Date:** 2026-11-04
- **Type:** feature
- **Scope:** `server`, `web`, `cli`, `docs`
- **PR:** [#1456](https://github.com/Prism-Shadow/penguin-harness/pull/1456)
- **Issue:** [#1451](https://github.com/Prism-Shadow/penguin-harness/issues/1451)

[中文版](2026-11-04-copy-an-agent.zh.md)

An agent can now be copied in one step, without exporting a snapshot and creating a new agent from it. Running the same baseline under several self-evolution methods is one use. The copy starts from the agent's current Agent State, on the same server or machine: its configuration, prompt, Skills, hooks, memory, schedules, workbenches, description and version. It gets none of the vault, Sessions, Traces, API keys or workbench version history, and nothing is written to the agent being copied, not even a snapshot.

## Where

- **Web App:** an agent's settings page has **Copy agent** in its **Agent State** section, beside **Export snapshot**. The dialog asks for the copy's name (prefilled as "<name> copy") and id, then opens the copy. Any member of the Project can copy.
- **CLI:** `penguin agent create --agent-id <id> --from <agent-id>`.
- **Server API:** `POST /api/projects/:p/agents` takes `copyFrom`, which is refused beside `dataBase64` (`copy_with_snapshot`) and beside seeding (`copy_with_plugins`).
