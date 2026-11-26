# Install the Support and Self-Evolution workbenches on their owning Agents

- **Date:** 2026-11-24
- **Type:** fix
- **Scope:** `core`, `web`, `ui-gallery`
- **PR:** [#1812](https://github.com/Prism-Shadow/penguin-harness/pull/1812)

[中文版](2026-11-24-preset-workbench-owners.zh.md)

New Projects install the Self-Evolution Workbench on the default Agent. The default Project installs the Support workbench on PenguinHarness Support. The App Center shows their Agent workbench controls, including hiding and removal. Plugin cards for removable workbenches omit the built-in badge. Adding the Self-Evolution Workbench to the home screen uses its App Center icon.

Opening a new conversation from a standalone workbench keeps the draft in the workbench’s Project, with that Project’s model selection.
