# Deleting a company can delete its Agents, and the Agents page sees the change at once

- **Date:** 2026-11-04
- **Type:** fix
- **Scope:** `server`, `web`, `docs`

[中文版](2026-11-04-company-delete-agents.zh.md)

Deleting an organization gained a choice to delete its employees' Agents with it, on by default. After an organization was deleted, created, or an employee was hired or left, the Web App read the Agent list again, so the Agents page's delete button, the sidebar and the Agent pickers saw the new employments at once instead of after a reload.

## Server

- `DELETE /api/projects/:projectId/organizations/:orgId` accepted `?deleteAgents=1` and answered 200 with a report instead of 204: `deletedAgents` (each with its background deletion), `keptAgents` (`employed_elsewhere` or `builtin`) and `failedAgents` (with the error's code and message). The organization still went to the Project's trash first.
- With the flag, each employee's Agent, the CEO's included, was deleted exactly as `DELETE …/agents/:agentId` deletes one, one after another. An Agent another organization also employs and a built-in Agent were kept; an Agent whose delete was refused, such as one whose folder could not be moved, was reported and the rest were still deleted.
- The Agent delete chain moved from the Agents route into `services/agent-deletion.ts`, shared by both routes; a single Agent delete behaved as before.

## Web App

- The delete confirmation in the organization settings read the Agent list afresh when it opened and named the Agents to be deleted for good and the ones kept with their reason, under the checkbox **Also delete this company's agents**, which was on by default. The typed id still armed the delete. Afterwards each deleted Agent's background removal was followed on the usual progress card, and an Agent that could not be deleted was named in an error toast.
- The Agent list was read again after an organization was deleted (either way) or created, and after a hire or a leave.
- The confirmation's text, the delete row's help and the pause help no longer said that an organization is never deleted.
