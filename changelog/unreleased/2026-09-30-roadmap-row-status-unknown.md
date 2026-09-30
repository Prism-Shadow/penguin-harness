# A roadmap row keeps a pill when the proposals list is missing

- **Date:** 2026-09-30
- **Type:** fix
- **Scope:** `web`
- **PR:** [Myriad-Dreamin/penguin-harness#132](https://github.com/Myriad-Dreamin/penguin-harness/pull/132)

[中文版](2026-09-30-roadmap-row-status-unknown.zh.md)

In a roadmap room's column, an item linked to a proposal takes its status pill from the organization's proposals list. When that list had not loaded — a failed read, a dropped machine link — or did not hold the proposal, the row showed its number and title with no pill at all, so a single failed read emptied the status of every linked row at once. Such a row now shows a grey **status unknown** pill, with a tooltip saying the status appears once the list has it; the proposal's own status replaces it as soon as the list loads.
