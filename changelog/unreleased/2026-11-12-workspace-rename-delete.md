# Every Workspace group can be renamed and deleted

- **Date:** 2026-11-12
- **Type:** feature
- **Scope:** `web`, `server`
- **PR:** [#1542](https://github.com/Prism-Shadow/penguin-harness/pull/1542)

[中文版](2026-11-12-workspace-rename-delete.zh.md)

In the sidebar grouped by Workspace, every group that is one directory now has Rename workspace and Delete workspace in its More menu, whether it was added by hand or formed by its conversations, on this server or on a machine. The merged Temporary workspaces group has neither.

## Details

- Renaming a group that was never added by hand registers it under that name, on its machine; it then stays in the list without active conversations. A blank name shows the directory name again.
- Delete workspace asks first. The confirmation names how many active conversations will be archived, says the files on disk are not touched, and says that unarchiving any of them brings the Workspace back.
- Confirming archives every active conversation of the group on the server that holds it, the ones the sidebar has not loaded included, in one request. A running conversation is archived and keeps running. The group and its name leave the sidebar at once, a toast says how many were archived, and an open conversation of the group gives way to a new chat.
- A group with no active conversations is removed without asking the server. A failed request keeps the dialog open and changes nothing; a machine whose PenguinHarness predates the route is named as too old to delete a workspace.
- Unarchiving any of those conversations brings the group back under its directory name; its pin, fold and manual order apply again.
- Added `POST /api/projects/:projectId/sessions/archive` with `{workspaceGroup}` (a path, or `temp`), answering `{done}`. It archives the rows the Session list serves for `category=active&excludeOrg=1&workspaceGroup=…` over every Agent of the Project, each as `PATCH archived: true` does, with one `session_archived` per Session. A missing or blank `workspaceGroup` is a 400.
- A tab that holds none of the archived rows now reloads its list when another tab archives them, so a Workspace deleted elsewhere does not stay behind as an empty group.
- The English label is Delete workspace (was Remove workspace).
