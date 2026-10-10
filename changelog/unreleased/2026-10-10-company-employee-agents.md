# An employee's agent cannot be deleted, and a deleted one no longer opens another conversation

- **Date:** 2026-10-10
- **Type:** fix
- **Scope:** `server`, `web`, `ui`, `docs`

[中文版](2026-10-10-company-employee-agents.zh.md)

Deleting an agent that an organization employed left the employee in the org chart with a desk pointing at a Session that no longer existed. Clicking that desk in company mode opened whichever development conversation was most recent instead. An employed agent can no longer be deleted, an employee whose agent is gone anyway is marked and cannot be opened, and a link to a missing conversation now says so in place. Development mode lists employees apart from the other agents, and the org chart can set an employee's thinking level.

## Details

- **Server**: `DELETE /api/projects/:p/agents/:a` answers `409 agent_employed` while any organization of the Project employs the agent, naming each organization and title. Paused organizations count. For an organization whose `org_chart.yaml` does not parse, only its CEO (`<org_id>_ceo`) is protected.
- **Server**: `GET /api/projects/:p/agents` gives each agent `employments` (organization id and name, title, status), absent for an agent that is no employee.
- **Server**: an org chart entry whose agent no longer exists carries `agentMissing`. A desk whose Session is gone is left out of the chart's `desk` and the organization's sessions list until the reconcile pass opens a new one. Nothing in the organization's files is rewritten.
- **Web**: the **Agents** page lists employees in a **Company employees** section, each card naming its organization and title, with its delete button off and a tooltip saying why. The new-chat and `/agent` pickers list employees last under the same label. The sidebar's agent grouping leaves out an employee with no development conversation.
- **Web**: in company mode, an employee whose agent was deleted is marked **Agent deleted** on the org chart and in the **Desks** group, its desk cannot be opened, and its menu keeps only what needs no agent; **Leave the organization** removes it. When the CEO's agent is the one deleted, the org chart says to create an agent with that id again.
- **Web**: a conversation link the server answers with 404 shows **This conversation does not exist or was deleted** with **New chat**, or **Back to the overview** in company mode, instead of opening the most recent conversation. Deleting the conversation on screen still moves to the most recent one.
- **Web**: the org chart's employee menu has **Set thinking level**, which writes `model.thinking_level` to the employee's agent config. The dialog says when the current desk Session is pinned to a level of its own. A level picked inside the desk conversation still pins only that Session.
- **UI**: `PickerList` takes an optional `groupLabel` that names a run of rows above its first row.
- **Docs**: the company mode page describes employees as agents, the delete protection, the **Agent deleted** marking and the thinking level; the agents page notes that an employee cannot be deleted.

Organizations that already have an entry whose agent was deleted need no action: the entry shows **Agent deleted** until someone makes the employee leave.
