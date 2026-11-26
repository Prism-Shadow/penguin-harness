# A workbench that fails to load offers Fix with AI and Report a problem

- **Date:** 2026-11-26
- **Type:** feature
- **Scope:** `web`

[中文版](2026-11-26-workbench-fail-actions.zh.md)

Wherever the Web App shows that a workbench's files did not load, it now offers two actions as well as Reload. Design: penguin-harness-design [#617](https://github.com/Prism-Shadow/penguin-harness-design/pull/617).

## Details

- **Fix with AI** works like the plugin repair. It asks first, then opens a new chat for the default Agent in a temporary Workspace, with the repair prompt in the composer, unsent. The prompt names the workbench, its Agent and machine, its folder (`<app_data_dir>/agents/<agent>/agent_state/workbenches/<id>/`) and the load error verbatim. It explains that a load type-checks `index.ts` under options the host fixes, that saving a file loads it again and that `.build/status.json` records the result. It asks the Agent to say what it will change before changing anything. When the error comes from what the platform provides (Node or TypeScript declarations, host types, packaging), the Agent is told to say so, change nothing and suggest reporting it. A workbench on a connected machine is repaired on that machine, by its default Agent. With no Agent to take the repair, a toast says so.
- **Report a problem** opens the shared problem report. The report names the workbench and says whether it runs on a connected machine, and it ends with the load error, masked like every report.
- Where the actions appear:
  - The pane of an app with no page to show, in its App Center window. Reload is now the primary button there, with Fix with AI as the secondary button beside it. The same pane on the app's full page, which sits outside the app shell with no Project to open a chat in, offers Reload and Report a problem.
  - The App Center's "View error" dialog.
  - The More menu of an Agent settings workbench row, while its load has failed.
  - The toast after an import whose load failed, which offers Report a problem.
