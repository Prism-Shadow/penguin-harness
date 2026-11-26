# Tooltips wrap long unbreakable text inside the panel

- **Date:** 2026-11-26
- **Type:** fix
- **Scope:** `ui`
- **PR:** [#1893](https://github.com/Prism-Shadow/penguin-harness/pull/1893)

[中文版](2026-11-26-tooltip-wrap-long-words.zh.md)

The shared tooltip now breaks a run with no break opportunity, such as a file path, at the panel's edge for every kind, instead of letting it run past the rounded panel. The tooltip gallery board gains a long-path example.
