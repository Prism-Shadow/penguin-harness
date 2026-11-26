# A workbench can open a Session that only talks with the deny-all approval mode

- **Date:** 2026-11-17
- **Type:** feature
- **Scope:** `server`, `plugins`, `docs`
- **PR:** [#1588](https://github.com/Prism-Shadow/penguin-harness/pull/1588)

[中文版](2026-11-17-workbench-session-approval.zh.md)

A workbench may now choose an existing approval mode, `deny-all`, for a Session that only talks. `host.createSession({ approvalMode: "deny-all" })` opens a Session in which every tool call is denied. Without the option a workbench Session is `allow-all`, as before.

## Details

- `WorkbenchHost.createSession` takes an optional `approvalMode`: `"allow-all"` (the default) or `"deny-all"`, both existing Session approval modes. Any other value is refused with an error that names it, since a mode that asks a person would wait for nobody.
- In a `deny-all` Session the model reads the usual denial line for each tool call and answers in text. The Session's row records the mode, and a person who opens the Session in the Web App can change it there.
- The harness README written into each workbench's `.harness/`, the `penguin-plugin` Skill (`2026.11.17.2`) and the workbench section of the Skills docs describe the option.
