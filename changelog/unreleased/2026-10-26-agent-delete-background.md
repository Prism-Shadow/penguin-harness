# Deleting a large agent no longer freezes the app, and shows its progress

- **Date:** 2026-10-26
- **Type:** fix
- **Scope:** `server`, `web`, `ui`, `docs`
- **PR:** [#1348](https://github.com/Prism-Shadow/penguin-harness/pull/1348)

[中文版](2026-10-26-agent-delete-background.zh.md)

Deleting an agent whose folder held many files, such as a temporary Workspace with installed dependencies, kept the server busy until the last file was gone. The Web App sat on the confirmation dialog, and every other page that read a file waited behind the delete. Restarting the app partway through left the agent on the Agents list, while opening or deleting it answered "This agent no longer exists."

## Details

- A delete moves the agent's folder into `agents/.deleting/` in one rename, drops its index rows and answers `202` with the deletion. From then on the agent is on no list, every route answers 404, and its id can be used again. The folder's contents are removed in the background with only a couple of filesystem calls in flight at a time, so the server keeps answering other requests.
- `GET /api/projects/:projectId/agent-deletions/:deletionId` reports the removal: `counting`, then `removing` with `removed` out of `total` entries, then `done`, or `failed` with the operating system's reason.
- Whatever a removal leaves behind, an entry it could not remove or the rest when the server stopped, is removed again at the next start under the same deletion id.
- Before the move the server stops the agent's runs, as before, and now also releases its workbench folder watcher, pending reloads and loaded workbenches. If the folder still cannot be moved because another program has a file in it open, the delete is refused with `409 agent_folder_busy` and nothing is deleted.
- The Agents list shows an agent only while its `agent_state/system_config.yaml` exists, the rule every agent route already applied, so a listed agent always opens and deletes. An agent that an earlier version left half-deleted is no longer listed; what is left of its folder stays on disk.
- When the removal takes noticeable time, a card in the bottom-right corner follows it: counting first, then items removed out of the total, then the result. Closing the card does not stop the removal, and the card stays on screen after you leave the Agents page. The card is `ProgressToasts` in the UI package, available to other long operations.
