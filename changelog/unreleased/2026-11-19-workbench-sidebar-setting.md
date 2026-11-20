# Choose which workbenches appear in the sidebar

- **Date:** 2026-11-19
- **Type:** feature
- **Scope:** `server`, `web`
- **PR:** [#1624](https://github.com/Prism-Shadow/penguin-harness/pull/1624)

[中文版](2026-11-19-workbench-sidebar-setting.zh.md)

A workbench's row on an Agent's **Plugins → Workbenches** sub-page gained **Show in the sidebar**, a checkable row in its **More** menu, on by default. The setting belonged to the installation: a `.hidden-from-sidebar` marker in the workbench's folder, beside `.disabled`, so every member of the Project saw the same choice, changing it recorded no version, and a plugin update or an archive import kept it. The workbench tabs beside the chat followed it, and **Open** on a hidden workbench opened its full page. The App Center was unaffected.

## Details

- `PATCH /api/projects/:p/agents/:a/workbenches/:id/sidebar { show }` wrote or removed the marker, for any member of the Project. `WorkbenchInfo.showInSidebar` reported it, and the menu row was left out for an Agent whose server did not report it.
- `GET /api/projects/:p/agents/:a/workbenches?view=sidebar` answered `{ apps }`: one App Center shortcut for each workbench that ran, had a tab and was not hidden, declared for the App Center or not. It read the manifests and load status with the App Center's reader and compiled nothing.
- On a machine's Agent, the setting was written on that machine.
