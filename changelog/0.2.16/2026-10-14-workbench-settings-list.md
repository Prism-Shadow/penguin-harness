# Unified lists in Agent settings

- **Date:** 2026-10-14
- **Type:** fix
- **Scope:** `ui`, `web`
- **PR:** [#1133](https://github.com/Prism-Shadow/penguin-harness/pull/1133)

[中文](./2026-10-14-workbench-settings-list.zh.md)

Workbenches and Skills in Agent settings share the UI package's list frame, rows, metadata and icon actions. Workbench settings no longer show a Browse plugins shortcut. Row actions wrap on narrow screens, and empty lists use the same empty state.

An anvil now identifies workbenches in the settings list, Agent counts and Session source marks, with drawings for all three icon themes.

The Agent chooser uses the UI package’s compact searchable dialog: one row per Agent, inline Skill and Workbench counts, details on hover and a bounded scroll area. Arrow keys and Enter select from filtered results.
