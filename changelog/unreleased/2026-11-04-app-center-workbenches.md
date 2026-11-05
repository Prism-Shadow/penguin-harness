# The App Center is a home screen of workbench shortcuts

- **Date:** 2026-11-04
- **Type:** feature
- **Scope:** `server`, `web`, `plugins`, `docs`, `rfcs`
- **PR:** [#1488](https://github.com/Prism-Shadow/penguin-harness/pull/1488)

[中文版](2026-11-04-app-center-workbenches.zh.md)

The sidebar gained an **App Center** entry (`/apps`), pinned right after Agents. It shows one tile per workbench of the Project's agents on this server whose own `package.json` declares `penguin.appCenter.show: true`, and a tile opens the workbench full page, whose exit returns to the App Center.

## Details

- A workbench's manifest gained `penguin.appCenter { show, title?, titleZh?, icon?, tab? }`. Titles default to the first tab's, then to the package name; `icon` names a `.svg`, `.png` or `.webp` file under `ui/` of at most 256 KB; `tab` picks the tab the shortcut opens. A declaration that does not hold up does not fail the load: the workbench has no shortcut, and its load hints and `.build/status.json` name the fix. `WorkbenchInfo.appCenter` carries the parsed declaration.
- `GET /api/projects/:projectId/app-center` lists the shortcuts (`AppCenterShortcut`): Agents in list order, by title within an Agent, with the icon's URL, the full-page path and a `broken` mark when the last load failed. It reads the manifests and each folder's load status only and compiles nothing. It lists this server's Agents only.
- `PATCH /api/projects/:projectId/agents/:agentId/workbenches/:id/app-center` `{ show }` rewrites only `penguin.appCenter.show` in the workbench's `package.json` (2-space JSON, other keys kept), reloads it and records the edit as a version. A `package.json` that is not a JSON object is answered 409 `workbench_manifest_invalid`.
- The Workbenches tab of Agent settings gained a **Show in the App Center** switch on each row of a local Agent, committed on click, and an **App Center** pill on a row that is on.
- With no shortcut, the page explains what a workbench is and offers **Create with AI**, which opens a conversation with the `web-design` and `penguin-plugin` Skills asking the agent for a workbench in the App Center.
- The `penguin-support` plugin's Support workbench declared `appCenter: { show: true, icon: "ui/icon.svg" }` with a new icon, and its `penguin.version` moved to `2026.11.04.1`. An installed copy on `penguin_support` reports one plugin update; it appears in the App Center once updated.
- The `penguin-plugin` Skill (`2026.11.04.2`) gained an "App Center" section on the manifest key.
- The registry of external apps, health probes, `[app_center]` origin block, `penguin app` CLI and `app-center` Skill of [#595](https://github.com/Prism-Shadow/penguin-harness/pull/595) were not adopted.
- `rfcs/PRFC-0020-agent-workbench.md` moved to v1.1.0 with an "App Center" section.
