# Deleting a company can delete its Agents, and the Agents page sees the change at once

- **Date:** 2026-11-04
- **Type:** feature
- **Scope:** `server`, `web`, `docs`
- **PR:** [#1481](https://github.com/Prism-Shadow/penguin-harness/pull/1481)
- **Breaking:** yes — `DELETE /api/projects/:projectId/organizations/:orgId` answers 200 with a report instead of 204 with no body

[中文版](2026-11-04-company-delete-agents.zh.md)

Deleting an organization gained a choice to delete its employees' Agents with it, on by default. After an organization was deleted, created, or an employee was hired or left, the Web App read the Agent list again, so the Agents page's delete button, the sidebar and the Agent pickers saw the new employments at once instead of after a reload.

## Server

- `DELETE /api/projects/:projectId/organizations/:orgId` accepted `?deleteAgents=1&agentIds=a,b`, the Agents the caller's confirmation listed for deletion, and answered 200 with a report: `deletedAgents` (each with its background deletion), `keptAgents` and `failedAgents` (with the error's code and message). `deleteAgents=1` without `agentIds` was refused with 400 before anything was touched. The organization still went to the Project's trash first.
- Each listed employee's Agent, the CEO's included, was deleted exactly as `DELETE …/agents/:agentId` deletes one. Every other employee was kept with its reason: `builtin`; `employed_elsewhere` when another organization employs it too; `employment_unknown` for every employee while another organization's `org_chart.yaml` could not be read, the report naming those organizations in `unreadableCharts`; `not_confirmed` when it was not in `agentIds`, such as an Agent hired after the confirmation read the list. A listed id that was no employee of the organization was ignored. An Agent whose delete was refused, such as one whose folder could not be moved, was reported and the rest were still deleted.
- The Agent list (`GET /api/projects/:projectId/agents`) named the organizations whose chart could not be read, as `unreadableCharts`.
- The deleted Agents' runs were aborted together and shared one wait of at most five seconds, and each Agent then cost a folder rename and its rows; their files were removed in the background, so the answer did not wait on the size of their folders.
- The Agent delete chain moved from the Agents route into `services/agent-deletion.ts`, shared by both routes; a single Agent delete behaved as before.

## Web App

- The delete confirmation in the organization settings read the Agent list afresh when it opened and named the Agents to be deleted for good and the ones kept with their reason, under the checkbox **Also delete this company's agents**, which was on by default. Until that list arrived the delete could not be confirmed; when it could not be read, the checkbox stayed off, the organization alone could still be deleted, and Retry read the list again. While another organization's chart could not be read, the confirmation said so and listed every employee as kept. The typed id still armed the delete, and the confirmation could not be closed while the delete ran.
- The request named the Agents the confirmation listed. Afterwards each deleted Agent's background removal was followed on the usual progress card; an Agent kept against what the confirmation said was named in the toast with its reason (changed after the confirmation, or another organization's chart could not be read), and an Agent that could not be deleted in an error toast. When the answer failed, the organization was read again: if it was gone, the dialog closed and left its pages as after a delete.
- The Agent list was read again after an organization was deleted (either way, and also when the answer failed) or created, and after a hire or a leave.
- The confirmation's text, the delete row's help and the pause help no longer said that an organization is never deleted.

## Compatibility

- An API client that deletes an organization and expects `204` with no body now gets `200` with a JSON report; it should accept any 2xx. The route without `deleteAgents` deletes the organization alone, as before. The Web App was updated in the same release, and the `penguin` CLI has no organization delete.
